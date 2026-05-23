import SwiftUI
import Observation
import AVFoundation

enum VoiceState: Equatable {
    case permissionPending
    case permissionDenied
    case listening
    case thinking
    case speaking
    case paused
    case error(message: String)
}

@Observable
@MainActor
final class VoiceModeStore {
    var state: VoiceState = .permissionPending
    var transcript: String = ""
    var assistantText: String = ""
    var currentTurnId: String?
    var isMuted: Bool = false

    private let session = VoiceSession()
    private let audio = AudioQueue()
    private var sseTask: Task<Void, Never>?
    private let synthesizer = AVSpeechSynthesizer()

    private let client: BoopClient
    private let conversationId: String
    private let threadId: String

    init(client: BoopClient, conversationId: String, threadId: String) {
        self.client = client
        self.conversationId = conversationId
        self.threadId = threadId
    }

    func enter() async {
        guard state == .permissionPending else { return }
        do {
            try await session.activate()
            try await audio.attachToEngine()
            await audio.setOnFirstPlay { [weak self] in
                Task { @MainActor in
                    guard let self, self.state == .thinking else { return }
                    self.state = .speaking
                }
            }
            state = .listening
            try await session.startListening(
                partial: { [weak self] t in
                    Task { @MainActor in self?.transcript = t }
                },
                onCommit: { [weak self] t in
                    Task { @MainActor in await self?.commitTurn(text: t) }
                }
            )
            let conn = client.streamSSE(threadId: threadId)
            sseTask = Task { [weak self] in await self?.consumeSSE(conn: conn) }
        } catch {
            await session.deactivate()  // release session even on partial init failure
            state = .error(message: error.localizedDescription)
        }
    }

    func exit() async {
        sseTask?.cancel(); sseTask = nil
        await audio.teardown()
        await session.deactivate()
        state = .permissionPending
        transcript = ""
        assistantText = ""
        currentTurnId = nil
        isMuted = false
    }

    func toggleMute() {
        isMuted.toggle()
        // NOTE: actual mic stop is a TODO; for now state mirrors isMuted.
        state = isMuted ? .paused : .listening
    }

    func skipSpeaking() async {
        guard state == .speaking else { return }
        await audio.flush()
        state = .listening
    }

    func handoffToKeyboard(draft: inout String) {
        draft = transcript
    }

    // MARK: - Private

    private func commitTurn(text: String) async {
        guard !text.isEmpty else { return }
        let turnId = UUID().uuidString
        currentTurnId = turnId
        state = .thinking
        do {
            _ = try await client.sendInbound(
                text: text,
                threadId: threadId,
                source: "voice",
                voiceTurnId: turnId
            )
        } catch {
            state = .error(message: "Couldn't reach boop — tap to retry")
        }
    }

    private func consumeSSE(conn: SSEConnection?) async {
        guard let conn else { return }
        for await event in conn.subscribe() {
            if Task.isCancelled { return }
            guard event.conversationId == conversationId else { continue }
            await apply(event)
        }
    }

    private func apply(_ event: StreamEvent) async {
        switch event {
        case .delta(_, let text, _):
            assistantText += text

        case .ttsChunk(_, let vid, let seq, let audio64, _):
            guard vid == currentTurnId else { return }
            if state == .thinking { state = .speaking }
            await audio.enqueue(seq: seq, audioBase64: audio64)

        case .ttsUseLocal(_, let vid, let text):
            guard vid == currentTurnId else { return }
            state = .speaking
            speakLocally(text: text)

        case .ttsDone(_, let vid):
            guard vid == currentTurnId else { return }
            await audio.markDone()
            await audio.drain()
            state = .listening

        case .ttsError(_, let vid, let reason):
            guard vid == currentTurnId else { return }
            state = .error(message: reason)

        default:
            break
        }
    }

    private func speakLocally(text: String) {
        let utter = AVSpeechUtterance(string: text)
        utter.voice = AVSpeechSynthesisVoice(language: "en-US")
        synthesizer.speak(utter)
    }
}
