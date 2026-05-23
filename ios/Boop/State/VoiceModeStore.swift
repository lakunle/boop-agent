import SwiftUI
import Observation

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

    // Wired to VoiceSession + AudioQueue in Task 18.
    func enter() { state = .permissionPending }
    func exit() {
        state = .permissionPending
        transcript = ""
        assistantText = ""
        currentTurnId = nil
        isMuted = false
    }
    func toggleMute() {
        isMuted.toggle()
        state = isMuted ? .paused : .listening
    }
    // TODO(T19): ChatStore does not expose a draft binding; wire handoff
    // once a shared draft field is available in ChatStore.
    func handoffToKeyboard(draft: inout String) {
        draft = transcript
        exit()
    }
}
