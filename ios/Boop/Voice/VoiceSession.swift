import AVFoundation
import Foundation

/// Owns the AVAudioSession + AVAudioEngine for the lifetime of one
/// voice-mode sheet. SFSpeech + VAD layered on in Task 15.
actor VoiceSession {
    private let engine = AVAudioEngine()
    private var isActive = false
    private var sessionInterruptObs: NSObjectProtocol?
    private var sessionRouteChangeObs: NSObjectProtocol?

    var onInterrupted: (() -> Void)?
    var onRouteChanged: ((AVAudioSession.RouteChangeReason) -> Void)?

    func setOnInterrupted(_ handler: @escaping () -> Void) { onInterrupted = handler }
    func setOnRouteChanged(_ handler: @escaping (AVAudioSession.RouteChangeReason) -> Void) { onRouteChanged = handler }

    func activate() throws {
        guard !isActive else { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat,
            options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
        try session.setActive(true, options: [.notifyOthersOnDeactivation])
        installObservers(on: session)
        isActive = true
    }

    func deactivate() {
        guard isActive else { return }
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        if let obs = sessionInterruptObs { NotificationCenter.default.removeObserver(obs) }
        if let obs = sessionRouteChangeObs { NotificationCenter.default.removeObserver(obs) }
        sessionInterruptObs = nil
        sessionRouteChangeObs = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        isActive = false
    }

    private func installObservers(on session: AVAudioSession) {
        let nc = NotificationCenter.default
        sessionInterruptObs = nc.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            guard let info = note.userInfo,
                  let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
            if type == .began { Task { await self?.handleInterruption() } }
        }
        sessionRouteChangeObs = nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
            guard let info = note.userInfo,
                  let reasonRaw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) else { return }
            Task { await self?.handleRouteChange(reason) }
        }
    }

    private func handleInterruption() { onInterrupted?() }
    private func handleRouteChange(_ reason: AVAudioSession.RouteChangeReason) { onRouteChanged?(reason) }

    // Exposed for Task 15 to install a tap.
    var inputFormat: AVAudioFormat { engine.inputNode.outputFormat(forBus: 0) }

    func installInputTap(bufferSize: AVAudioFrameCount = 1024,
                          block: @escaping @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void) throws {
        engine.inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: nil, block: block)
        try engine.start()
    }
}
