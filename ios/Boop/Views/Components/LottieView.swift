import SwiftUI
import Lottie

/// SwiftUI wrapper around Lottie's `LottieAnimationView`. Bundles
/// the active-thread tint via a runtime color value provider, and
/// honours Reduce Motion by holding the animation at frame 0.
struct LottieOrbView: UIViewRepresentable {
    let name: String
    let tint: Color
    let loopMode: LottieLoopMode

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(name: String, tint: Color = .accentColor, loopMode: LottieLoopMode = .loop) {
        self.name = name
        self.tint = tint
        self.loopMode = loopMode
    }

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        let animationView = LottieAnimationView(name: name)
        animationView.contentMode = .scaleAspectFit
        animationView.loopMode = loopMode
        animationView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(animationView)
        NSLayoutConstraint.activate([
            animationView.topAnchor.constraint(equalTo: container.topAnchor),
            animationView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            animationView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            animationView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
        applyTint(animationView)
        if reduceMotion {
            animationView.currentProgress = 0
        } else {
            animationView.play()
        }
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        guard let animationView = container.subviews.first as? LottieAnimationView else { return }
        applyTint(animationView)
        if reduceMotion && animationView.isAnimationPlaying {
            animationView.pause()
            animationView.currentProgress = 0
        } else if !reduceMotion && !animationView.isAnimationPlaying {
            animationView.play()
        }
    }

    private func applyTint(_ view: LottieAnimationView) {
        let ui = UIColor(tint)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        let provider = ColorValueProvider(.init(r: Double(r), g: Double(g), b: Double(b), a: Double(a)))
        // Layer name must be "orb-fill" in the Lottie file. If a chosen
        // file uses a different name, edit this keypath.
        view.setValueProvider(provider, keypath: AnimationKeypath(keypath: "orb-fill.Fill 1.Color"))
    }
}
