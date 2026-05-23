import SwiftUI

struct VoiceModeSheet: View {
    @Bindable var store: VoiceModeStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let threadTint: Color
    let threadName: String
    let onKeyboardHandoff: () -> Void

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 24) {
                header
                Spacer()
                orb
                subtitle
                Spacer()
                controls
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 32)

            if store.state == .permissionPending || store.state == .permissionDenied {
                VoicePermissionsCard(
                    denied: store.state == .permissionDenied,
                    onAllow: { await requestPermissions() },
                    onCancel: { dismiss() }
                )
            }
        }
        .preferredColorScheme(.dark)
        .task { await checkOrPromptPermissions() }
        .onDisappear { Task { await store.exit() } }
    }

    private func checkOrPromptPermissions() async {
        let status = VoicePermissions.current()
        switch status {
        case .granted:
            await store.enter()
        case .denied:
            store.state = .permissionDenied
        case .notDetermined:
            store.state = .permissionPending
        }
    }

    private func requestPermissions() async {
        let status = await VoicePermissions.request()
        if status == .granted {
            await store.enter()
        } else {
            store.state = .permissionDenied
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 8) {
                Circle().fill(threadTint).frame(width: 8, height: 8)
                Text("\(threadName) · Voice")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 32, height: 32)
                    .background(Color.gray.opacity(0.18), in: Circle())
            }
            .accessibilityIdentifier("voice.exit")
        }
    }

    @ViewBuilder
    private var orb: some View {
        if reduceMotion {
            staticOrb
        } else {
            animatedOrb
        }
    }

    @ViewBuilder
    private var animatedOrb: some View {
        switch store.state {
        case .listening:
            LottieOrbView(name: "listening", tint: threadTint)
                .frame(width: 160, height: 160)
                .accessibilityIdentifier("voice.orb")
        case .thinking:
            LottieOrbView(name: "thinking", tint: threadTint)
                .frame(width: 160, height: 160)
                .accessibilityIdentifier("voice.orb")
        case .speaking:
            LottieOrbView(name: "speaking", tint: threadTint)
                .frame(width: 160, height: 160)
                .onTapGesture { Task { await store.skipSpeaking() } }
                .accessibilityIdentifier("voice.orb")
        case .paused:
            Circle().fill(Color.gray.opacity(0.2))
                .overlay(
                    Image(systemName: "pause.fill")
                        .foregroundStyle(.white)
                        .font(.system(size: 32))
                )
                .frame(width: 160, height: 160)
                .accessibilityIdentifier("voice.orb")
        case .error:
            Circle().fill(Color.red.opacity(0.2))
                .overlay(
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.system(size: 32))
                )
                .frame(width: 160, height: 160)
                .accessibilityIdentifier("voice.orb")
        case .permissionPending, .permissionDenied:
            Color.clear.frame(width: 160, height: 160)
                .accessibilityIdentifier("voice.orb")
        }
    }

    private var staticOrb: some View {
        Image(systemName: staticSymbol)
            .font(.system(size: 88, weight: .light))
            .foregroundStyle(threadTint)
            .frame(width: 160, height: 160)
            .accessibilityIdentifier("voice.orb")
    }

    private var staticSymbol: String {
        switch store.state {
        case .listening: return "waveform"
        case .thinking: return "clock"
        case .speaking: return "speaker.wave.2.fill"
        case .paused: return "mic.slash"
        case .error: return "exclamationmark.triangle.fill"
        case .permissionPending, .permissionDenied: return "waveform"
        }
    }

    private var subtitle: some View {
        VStack(spacing: 4) {
            Text(stateLabel)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .tracking(1)
            Text(store.transcript.isEmpty ? " " : "\u{201C}\(store.transcript)\u{201D}")
                .font(.system(size: 17, weight: .regular).italic())
                .foregroundStyle(.white)
                .frame(minHeight: 24)
                .accessibilityIdentifier("voice.transcript")
        }
    }

    private var controls: some View {
        HStack(spacing: 32) {
            circleButton(systemName: store.isMuted ? "mic.slash.fill" : "mic.fill") {
                store.toggleMute()
            }
            .accessibilityIdentifier("voice.mute")
            .accessibilityLabel(store.isMuted ? "Unmute" : "Mute")

            circleButton(systemName: "xmark", ring: .red) {
                Task { await store.exit() }
                dismiss()
            }
            .accessibilityIdentifier("voice.exit.large")
            .accessibilityLabel("Exit voice mode")

            circleButton(systemName: "keyboard") {
                onKeyboardHandoff()
                Task { await store.exit() }
                dismiss()
            }
            .accessibilityIdentifier("voice.keyboard")
            .accessibilityLabel("Switch to keyboard")
        }
    }

    private func circleButton(systemName: String, ring: Color = .clear, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(ring == .clear ? .white : ring)
                .frame(width: 56, height: 56)
                .background(Color.gray.opacity(0.18), in: Circle())
                .overlay(Circle().stroke(ring, lineWidth: ring == .clear ? 0 : 2))
        }
    }

    private var stateLabel: String {
        switch store.state {
        case .permissionPending: return "PERMISSIONS"
        case .permissionDenied: return "PERMISSION DENIED"
        case .listening: return "LISTENING"
        case .thinking: return "THINKING"
        case .speaking: return "SPEAKING"
        case .paused: return "PAUSED"
        case .error: return "ERROR"
        }
    }
}
