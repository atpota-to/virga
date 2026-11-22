// Ports src/posting/lib/images.js (browser-image-compression's compress loop, which prepareImage runs)
//
// browser-image-compression 2.0.2's `compress` (lib/image-compression.js),
// over an encoder's single render, so VirgaUI's ImageIOEncoder walks the
// loop the web's library walks. The picture is drawn at most
// `maxWidthOrHeight` on its longer side (handleMaxWidthOrHeight caps it
// whatever `alwaysKeepResolution` says) at `initialQuality`, and that render
// is the answer when it is within `maxSizeMB` and no larger than the
// original file. Otherwise up to `maxIteration` renders follow, each at the
// quality times 0.95 (0.85 for PNG) and, only when the first render was
// over budget and `alwaysKeepResolution` is off, 0.95 of the size. The last
// render is the answer even when it is still over: prepareImage's own check
// decides whether it is refused.

import Foundation

extension Images {
  /// browser-image-compression's default `maxIteration`.
  public static let maxIteration = 10

  /// The bytes browser-image-compression's compress would settle on.
  /// `longSide` is the picture's longer side in pixels, `originalSize` the
  /// original file's byte count, `png` whether the output is PNG. `render`
  /// draws the picture at most `maxSide` pixels on its longer side and
  /// encodes it at `quality` (0 to 1); nil when it can't, which ends the
  /// work with nothing.
  public static func compress(
    longSide: Int, originalSize: Double, options: ImageCompressOptions, png: Bool,
    render: (_ maxSide: Int, _ quality: Double) -> Data?
  ) -> Data? {
    // `options.maxSizeMB || Infinity`, `options.initialQuality || 1.0`.
    let maxSizeByte = options.maxSizeMB > 0 ? options.maxSizeMB * mb : .infinity
    var quality = options.initialQuality > 0 ? options.initialQuality : 1.0
    // handleMaxWidthOrHeight: the longer side is capped, always.
    var side = Swift.max(1, Swift.min(longSide, options.maxWidthOrHeight))
    guard var current = render(side, quality) else { return nil }
    let origExceedMaxSize = Double(current.count) > maxSizeByte
    let sizeBecomeLarger = Double(current.count) > originalSize
    if !origExceedMaxSize && !sizeBecomeLarger { return current }
    let shouldReduceResolution = !options.alwaysKeepResolution && origExceedMaxSize
    var remainingTrials = maxIteration
    while remainingTrials > 0 && (Double(current.count) > maxSizeByte || Double(current.count) > originalSize) {
      remainingTrials -= 1
      // A canvas's width and height are whole pixels: the 0.95 is truncated.
      if shouldReduceResolution { side = Swift.max(1, Int(Double(side) * 0.95)) }
      quality *= png ? 0.85 : 0.95
      guard let next = render(side, quality) else { return nil }
      current = next
    }
    return current
  }
}
