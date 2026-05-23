import SwiftUI

struct VoicePermissionsCard: View {
    let denied: Bool
    let onAllow: () async -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "waveform")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(.white)
                .padding(.bottom, 4)
            VStack(spacing: 8) {
                Text("Voice mode")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                Text(denied
                    ? "Mic or speech recognition is off for Boop. Open Settings to enable."
                    : "Boop hears you on-device. Transcription never leaves your phone.")
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }
            VStack(spacing: 10) {
                Button {
                    if denied {
                        VoicePermissions.openSettings()
                    } else {
                        Task { await onAllow() }
                    }
                } label: {
                    Text(denied ? "Open Settings" : "Allow")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(.white)
                }
                Button("Not now", action: onCancel)
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .padding(24)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding(24)
    }
}
