import SwiftUI

struct VoiceModeSheet: View {
    @Bindable var store: VoiceModeStore
    @Environment(\.dismiss) private var dismiss
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
        .onDisappear { store.exit() }
    }

    private func checkOrPromptPermissions() async {
        let status = VoicePermissions.current()
        switch status {
        case .granted: store.state = .listening
        case .denied: store.state = .permissionDenied
        case .notDetermined: store.state = .permissionPending
        }
    }

    private func requestPermissions() async {
        let status = await VoicePermissions.request()
        store.state = (status == .granted) ? .listening : .permissionDenied
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
        // Placeholder until Task 18 wires Lottie + state-driven animations.
        Circle()
            .fill(RadialGradient(
                colors: [threadTint, threadTint.opacity(0.4)],
                center: .center, startRadius: 20, endRadius: 90))
            .frame(width: 160, height: 160)
            .shadow(color: threadTint.opacity(0.4), radius: 60)
            .accessibilityIdentifier("voice.orb")
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
            circleButton(systemName: store.isMuted ? "mic.slash.fill" : "speaker.slash.fill") {
                store.toggleMute()
            }.accessibilityIdentifier("voice.mute")

            circleButton(systemName: "xmark", ring: .red) {
                dismiss()
            }.accessibilityIdentifier("voice.exit.large")

            circleButton(systemName: "keyboard") {
                onKeyboardHandoff()
                dismiss()
            }.accessibilityIdentifier("voice.keyboard")
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
