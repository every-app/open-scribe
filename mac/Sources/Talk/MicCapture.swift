@preconcurrency import AVFoundation
import TalkCore

/// The microphone through AVAudioEngine, delivered as PCM16 24 kHz mono chunks. Never asks for
/// permission itself: the caller checks first (a prompt from inside capture code is the kind
/// that gets lost).
final class MicCapture: @unchecked Sendable {
  private let engine = AVAudioEngine()
  private var converter: AudioConverter24k?
  private let onAudio: @Sendable (Data) -> Void
  private var configObserver: NSObjectProtocol?
  private let onInterrupted: @Sendable (String?) -> Void

  /// `onInterrupted` gets a sentence when the mic stops and can't be restarted, nil when it's back.
  init(onAudio: @escaping @Sendable (Data) -> Void, onInterrupted: @escaping @Sendable (String?) -> Void = { _ in }) {
    self.onAudio = onAudio
    self.onInterrupted = onInterrupted
  }

  func start() throws {
    try startEngine()
    // The engine stops itself when the input device changes (AirPods plugged in, the default mic
    // switched mid-meeting). Start again on the new device, in its format.
    configObserver = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
    ) { [weak self] _ in self?.restart() }
  }

  private func restart() {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    do {
      try startEngine()
      onInterrupted(nil)
    } catch {
      onInterrupted("The microphone stopped: \(error.localizedDescription)")
    }
  }

  private func startEngine() throws {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw CaptureError("No microphone is available.") }
    converter = AudioConverter24k(inputRate: format.sampleRate)
    // ~100 ms buffers; the tap's thread does the conversion, which is cheap.
    let size = AVAudioFrameCount(format.sampleRate / 10)
    input.installTap(onBus: 0, bufferSize: size, format: format) { [weak self] buffer, _ in
      self?.handle(buffer)
    }
    engine.prepare()
    try engine.start()
  }

  func stop() {
    if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
    configObserver = nil
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
  }

  private func handle(_ buffer: AVAudioPCMBuffer) {
    guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return }
    let frames = Int(buffer.frameLength)
    let count = Int(buffer.format.channelCount)
    var mono = [Float](repeating: 0, count: frames)
    if buffer.format.isInterleaved {
      mono = PCM16.downmix(interleaved: UnsafeBufferPointer(start: channels[0], count: frames * count), channels: count)
    } else {
      for ch in 0..<count {
        let p = channels[ch]
        for i in 0..<frames { mono[i] += p[i] }
      }
      if count > 1 {
        let scale = 1 / Float(count)
        for i in 0..<frames { mono[i] *= scale }
      }
    }
    guard let data = converter?.convert(mono: mono), !data.isEmpty else { return }
    onAudio(data)
  }
}

struct CaptureError: Error, LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}
