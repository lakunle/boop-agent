import XCTest
@testable import Boop

final class VoiceVADTests: XCTestCase {
    func test_commitsAfterSilence() {
        let vad = VoiceVAD(config: .init(silenceDuration: 1.0, minUtteranceMs: 100))
        // 2s of noise-floor calibration silence
        for i in 0..<20 { _ = vad.observe(rmsDB: -60, at: Double(i) * 0.1) }
        // 500ms of voice
        var startedAt: Int? = nil
        for i in 20..<25 {
            if let e = vad.observe(rmsDB: -40, at: Double(i) * 0.1), e == .startedUtterance { startedAt = i }
        }
        XCTAssertNotNil(startedAt)
        // 1.1s of silence — should commit
        var committed = false
        for i in 25..<37 {
            if case .committedUtterance? = vad.observe(rmsDB: -60, at: Double(i) * 0.1) {
                committed = true
                break
            }
        }
        XCTAssertTrue(committed)
    }

    func test_rejectsShortBursts() {
        let vad = VoiceVAD(config: .init(silenceDuration: 1.0, minUtteranceMs: 500))
        for i in 0..<20 { _ = vad.observe(rmsDB: -60, at: Double(i) * 0.1) }
        _ = vad.observe(rmsDB: -40, at: 2.0)  // 100ms burst (single sample)
        var rejected = false
        for i in 21..<33 {
            if vad.observe(rmsDB: -60, at: Double(i) * 0.1) == .rejectedTooShort {
                rejected = true
                break
            }
        }
        XCTAssertTrue(rejected)
    }
}
