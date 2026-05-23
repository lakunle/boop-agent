import AVFoundation
import Foundation

/// Decodes base64 mp3 chunks (ElevenLabs Flash v2.5 default) and
/// plays them in order via AVAudioPlayerNode. Reorders out-of-order
/// chunks within a small jitter buffer. Tap-orb-to-skip flushes the
/// queue and resolves drain().
actor AudioQueue {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var pending: [Int: Data] = [:]      // seq -> mp3 bytes
    private var nextSeq: Int = 0
    private var isStarted: Bool = false
    private var drainContinuation: CheckedContinuation<Void, Never>?
    private var finalSeqEmitted: Bool = false
    private var firstPlayFired: Bool = false
    private var scheduledOutstanding: Int = 0

    var onFirstPlay: (@Sendable () -> Void)?

    func setOnFirstPlay(_ cb: @escaping @Sendable () -> Void) { onFirstPlay = cb }

    func attachToEngine() throws {
        guard !isStarted else { return }
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: nil)
        try engine.start()
        player.play()
        isStarted = true
    }

    func enqueue(seq: Int, audioBase64: String) async {
        guard let data = Data(base64Encoded: audioBase64) else { return }
        pending[seq] = data
        await drainSequential()
    }

    /// Called when the server signals tts_done; AudioQueue treats subsequent
    /// drain() as terminal: it resolves once all currently-scheduled chunks finish.
    func markDone() {
        finalSeqEmitted = true
        maybeResolveDrain()
    }

    /// Await full playback completion. Resolves when no chunks are outstanding
    /// AND markDone() has been called, OR immediately if no work is pending.
    func drain() async {
        if scheduledOutstanding == 0 && pending.isEmpty && finalSeqEmitted { return }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            drainContinuation = cont
            maybeResolveDrain()
        }
    }

    /// Cancel everything currently queued/playing (tap-orb-to-skip).
    func flush() {
        pending.removeAll()
        player.stop()
        player.reset()
        player.play()
        scheduledOutstanding = 0
        finalSeqEmitted = false
        firstPlayFired = false
        drainContinuation?.resume()
        drainContinuation = nil
    }

    /// Permanently tear down on voice-mode exit.
    func teardown() {
        player.stop()
        engine.stop()
        pending.removeAll()
        drainContinuation?.resume()
        drainContinuation = nil
        isStarted = false
        firstPlayFired = false
        scheduledOutstanding = 0
        finalSeqEmitted = false
        nextSeq = 0
    }

    private func drainSequential() async {
        while let data = pending.removeValue(forKey: nextSeq) {
            do {
                try await schedule(data: data)
            } catch {
                // Bad chunk — skip and keep playing the rest
            }
            nextSeq += 1
        }
        maybeResolveDrain()
    }

    private func maybeResolveDrain() {
        if scheduledOutstanding == 0 && pending.isEmpty && finalSeqEmitted {
            drainContinuation?.resume()
            drainContinuation = nil
        }
    }

    private func schedule(data: Data) async throws {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("tts-\(UUID().uuidString).mp3")
        try data.write(to: tmp)
        let file = try AVAudioFile(forReading: tmp)
        scheduledOutstanding += 1
        let firstScheduled = !firstPlayFired
        firstPlayFired = true
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            player.scheduleFile(file, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                try? FileManager.default.removeItem(at: tmp)
                Task { await self?.handleChunkPlayed() }
                cont.resume()
            }
            if firstScheduled, let cb = onFirstPlay {
                cb()
            }
        }
    }

    private func handleChunkPlayed() {
        if scheduledOutstanding > 0 { scheduledOutstanding -= 1 }
        maybeResolveDrain()
    }
}
