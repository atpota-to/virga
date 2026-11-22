// browser-image-compression's compress loop (Images.compress), over a
// render whose byte count is worked out from the side and the quality, as
// the library walks it: the cap on the longer side, the one render that
// can be the answer, then up to ten more at 0.95 the quality (0.85 for
// PNG), smaller only when the first was over budget and the resolution
// isn't kept, and the last one the answer even when still over.

import Foundation
import Testing
@testable import VirgaPosting

/// A render that weighs `side² × quality × perPixel` bytes, recording each call.
final class FakeRender {
  var calls: [(side: Int, quality: Double)] = []
  let perPixel: Double
  var failAt: Int?

  init(perPixel: Double) { self.perPixel = perPixel }

  func render(_ side: Int, _ quality: Double) -> Data? {
    calls.append((side, quality))
    if let failAt, calls.count == failAt { return nil }
    let bytes = Double(side) * Double(side) * quality * perPixel
    return Data(count: Int(bytes))
  }
}

@Suite struct ImagesCompressBehaviour {
  static let mb: Double = 1_048_576

  /// What prepareImage asks for a file of `size` bytes, under the post budget.
  static func options(size: Double) -> ImageCompressOptions {
    Images.compressOptions(size: size, budget: Images.imageBudget)
  }

  @Test func aRenderWithinBudgetAndNoLargerIsTheAnswer() {
    let fake = FakeRender(perPixel: 0.01)
    let original: Double = 100_000
    let out = Images.compress(longSide: 2000, originalSize: original, options: Self.options(size: original), png: false) {
      fake.render($0, $1)
    }
    #expect(fake.calls.count == 1)
    #expect(fake.calls.first?.side == 2000)
    #expect(fake.calls.first?.quality == 1.0)
    #expect(out?.count == 40_000)
  }

  @Test func theLongerSideIsCappedEvenWhenTheResolutionIsKept() {
    // A 1.5 MB scan 12000 pixels long: under budget, so alwaysKeepResolution.
    let fake = FakeRender(perPixel: 0.001)
    let original: Double = 1_500_000
    let options = Self.options(size: original)
    #expect(options.alwaysKeepResolution)
    _ = Images.compress(longSide: 12_000, originalSize: original, options: options, png: false) { fake.render($0, $1) }
    #expect(fake.calls.first?.side == 4000)
    #expect(fake.calls.allSatisfy { $0.side == 4000 })
  }

  @Test func aSmallImageKeepsItsSizeAndQualityFallsBy095TenTimesAtMost() {
    // A small flat chart: every JPEG render is larger than the PNG it came from.
    let fake = FakeRender(perPixel: 0.05)
    let original: Double = 48_000
    let out = Images.compress(longSide: 2400, originalSize: original, options: Self.options(size: original), png: false) {
      fake.render($0, $1)
    }
    #expect(fake.calls.count == 1 + Images.maxIteration)
    #expect(fake.calls.allSatisfy { $0.side == 2400 })
    var quality: Double = 1.0
    for call in fake.calls {
      #expect(abs(call.quality - quality) < 1e-12, "\(call.quality) vs \(quality)")
      quality *= 0.95
    }
    // The last render is the answer though it is still larger than the original.
    let last = fake.calls.last!
    let expected = Int(Double(last.side) * Double(last.side) * last.quality * 0.05)
    #expect(out?.count == expected)
    #expect(Double(out?.count ?? 0) > original)
    let lowest: Double = 0.95 * 0.95 * 0.95 * 0.95 * 0.95 * 0.95 * 0.95 * 0.95 * 0.95 * 0.95
    #expect(abs(last.quality - lowest) < 1e-12)
  }

  @Test func itStopsOnceARenderFits() {
    // Larger than the original at 1.0 and 0.95, not at 0.9025.
    let original: Double = 1_000_000
    let fake = FakeRender(perPixel: 1.0)
    let side = 1040
    // 1040² = 1,081,600: ×1.0 and ×0.95 (1,027,520) are over, ×0.9025 (976,144) isn't.
    _ = Images.compress(longSide: side, originalSize: original, options: Self.options(size: original), png: false) {
      fake.render($0, $1)
    }
    #expect(fake.calls.count == 3)
  }

  @Test func anImageOverBudgetShrinksBy095AndStartsAt08() {
    let original: Double = 6 * Self.mb
    let options = Self.options(size: original)
    #expect(!options.alwaysKeepResolution)
    #expect(options.initialQuality == 0.8)
    let fake = FakeRender(perPixel: 0.25)
    // 4000² × 0.8 × 0.25 = 3.2 MB: over the 1.9 MB budget.
    let out = Images.compress(longSide: 6000, originalSize: original, options: options, png: false) { fake.render($0, $1) }
    #expect(fake.calls.first?.side == 4000)
    var side = 4000
    var quality: Double = 0.8
    for call in fake.calls {
      #expect(call.side == side)
      #expect(abs(call.quality - quality) < 1e-12)
      side = Int(Double(side) * 0.95)
      quality *= 0.95
    }
    let budget = Images.imageBudget.maxSizeMB * Self.mb
    #expect(Double(out?.count ?? 0) <= budget)
    #expect(fake.calls.count < 1 + Images.maxIteration)
  }

  @Test func theLastRenderIsTheAnswerEvenOverBudget() {
    let original: Double = 30 * Self.mb
    let fake = FakeRender(perPixel: 1.0)
    let out = Images.compress(longSide: 8000, originalSize: original, options: Self.options(size: original), png: false) {
      fake.render($0, $1)
    }
    #expect(fake.calls.count == 1 + Images.maxIteration)
    // 4000 × 0.95, truncated each time, ten times.
    #expect(fake.calls.last?.side == 2393)
    let budget = Images.imageBudget.maxSizeMB * Self.mb
    #expect(Double(out?.count ?? 0) > budget)
  }

  @Test func aPngLosesQualityBy085() {
    let fake = FakeRender(perPixel: 0.05)
    let original: Double = 48_000
    _ = Images.compress(longSide: 2400, originalSize: original, options: Self.options(size: original), png: true) {
      fake.render($0, $1)
    }
    #expect(fake.calls.count >= 2)
    #expect(abs(fake.calls[1].quality - 0.85) < 1e-12)
  }

  @Test func aRenderThatFailsEndsWithNothing() {
    let fake = FakeRender(perPixel: 0.05)
    fake.failAt = 3
    let original: Double = 48_000
    let out = Images.compress(longSide: 2400, originalSize: original, options: Self.options(size: original), png: false) {
      fake.render($0, $1)
    }
    #expect(out == nil)
    #expect(fake.calls.count == 3)
  }
}
