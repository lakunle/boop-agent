import AVFoundation
import Speech
import UIKit

enum VoicePermissionState {
    case notDetermined, granted, denied
}

enum VoicePermissions {
    static func current() -> VoicePermissionState {
        let mic = AVAudioApplication.shared.recordPermission
        let speech = SFSpeechRecognizer.authorizationStatus()
        if mic == .denied || speech == .denied || speech == .restricted { return .denied }
        if mic == .granted && speech == .authorized { return .granted }
        return .notDetermined
    }

    static func request() async -> VoicePermissionState {
        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard micGranted else { return .denied }
        let speechStatus = await withCheckedContinuation { (cont: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { status in cont.resume(returning: status) }
        }
        return speechStatus == .authorized ? .granted : .denied
    }

    static func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}
