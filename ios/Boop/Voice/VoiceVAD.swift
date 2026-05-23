import Foundation
import AVFoundation

struct VoiceVADConfig {
    var silenceDuration: TimeInterval = 1.4
    var minUtteranceMs: Double = 350
    var maxUtteranceMs: Double = 30_000
    var noiseFloorWindowSec: TimeInterval = 2.0
    var activeThresholdDB: Double = 6
}

enum VoiceVADEvent: Equatable {
    case startedUtterance
    case committedUtterance(durationMs: Double)
    case rejectedTooShort
    case forceCommitted
}

final class VoiceVAD {
    private let config: VoiceVADConfig
    private var noiseFloorDB: Double = -60
    private var floorSamples: [Double] = []
    private var floorWindowStart: TimeInterval?
    private var utteranceStart: TimeInterval?
    private var lastVoiceAt: TimeInterval?

    init(config: VoiceVADConfig = .init()) { self.config = config }

    func observe(rmsDB: Double, at: TimeInterval) -> VoiceVADEvent? {
        if floorWindowStart == nil { floorWindowStart = at }
        if at - (floorWindowStart ?? at) < config.noiseFloorWindowSec && utteranceStart == nil {
            floorSamples.append(rmsDB)
            if floorSamples.count > 30 { floorSamples.removeFirst() }
            noiseFloorDB = floorSamples.reduce(0, +) / Double(max(1, floorSamples.count))
            return nil
        }

        let isVoice = rmsDB > noiseFloorDB + config.activeThresholdDB
        if isVoice {
            if utteranceStart == nil { utteranceStart = at; return .startedUtterance }
            lastVoiceAt = at
            // max-utterance safety net
            if let start = utteranceStart, (at - start) * 1000 >= config.maxUtteranceMs {
                let event = VoiceVADEvent.forceCommitted
                resetUtterance()
                return event
            }
            return nil
        }

        guard let start = utteranceStart else { return nil }
        let silenceFor = at - (lastVoiceAt ?? start)
        if silenceFor >= config.silenceDuration {
            let ms = (at - start - silenceFor) * 1000
            if ms < config.minUtteranceMs {
                resetUtterance()
                return .rejectedTooShort
            }
            let event = VoiceVADEvent.committedUtterance(durationMs: ms)
            resetUtterance()
            return event
        }
        return nil
    }

    private func resetUtterance() {
        utteranceStart = nil
        lastVoiceAt = nil
    }
}

/// Computes RMS power (dB) from a PCM float buffer.
func rmsDB(buffer: AVAudioPCMBuffer) -> Double {
    guard let channelData = buffer.floatChannelData?[0] else { return -120 }
    let frameCount = Int(buffer.frameLength)
    var sumSquares: Double = 0
    for i in 0..<frameCount {
        let s = Double(channelData[i])
        sumSquares += s * s
    }
    let mean = sumSquares / Double(max(1, frameCount))
    guard mean > 0 else { return -120 }
    return 20 * log10(sqrt(mean))
}
