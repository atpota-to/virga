// Ports src/hillside/clouds.js (mulberry, makeNoise)
//
// The clouds' and the land's noise: mulberry32's random numbers, and the
// tiling value noise makeNoise bakes into a texture (five octaves of a
// smoothed lattice, stretched to 0–255, gray in r, g and b with alpha
// 255). The bytes are what the web's DataTexture holds, so a Metal texture
// made of them reads the same. Plain Swift, held to the web by
// ios/parity/cases/hillside.clouds.js.

import Foundation

/// mulberry32: the web's seeded generator, a number in [0, 1) each call.
public struct HillsideRandom: Sendable {
  var a: Int32

  /// `mulberry(seed)`: the seed is read as a 32-bit integer (`a |= 0`).
  public init(seed: Double) {
    a = HillsideClouds.toInt32(seed)
  }

  public mutating func next() -> Double {
    a = a &+ 0x6d2b_79f5
    let au = UInt32(bitPattern: a)
    var t = Int32(bitPattern: au ^ (au >> 15)) &* (1 | a)
    let tu = UInt32(bitPattern: t)
    t = (t &+ (Int32(bitPattern: tu ^ (tu >> 7)) &* (61 | t))) ^ t
    let out = UInt32(bitPattern: t)
    return Double(out ^ (out >> 14)) / 4_294_967_296
  }
}

public enum HillsideClouds {
  /// `makeNoise`'s octaves: `[period, weight]`.
  public static let octaves: [(period: Int, weight: Double)] = [(4, 0.42), (8, 0.28), (16, 0.16), (32, 0.09), (64, 0.05)]

  /// JavaScript's ToInt32.
  static func toInt32(_ value: Double) -> Int32 {
    guard value.isFinite else { return 0 }
    let truncated = value.rounded(.towardZero)
    let wrapped = truncated.truncatingRemainder(dividingBy: 4_294_967_296)
    let unsigned = wrapped < 0 ? wrapped + 4_294_967_296 : wrapped
    return Int32(bitPattern: UInt32(unsigned))
  }

  /// `makeNoise(size, seed).image.data`: `size × size` RGBA bytes.
  public static func makeNoise(_ size: Int, seed: Double = 7) -> [UInt8] {
    var rand = HillsideRandom(seed: seed)
    // Float32Array grids, filled in order.
    let grids: [[Float]] = octaves.map { o in (0..<(o.period * o.period)).map { _ in Float(rand.next()) } }
    let sum = octaves.reduce(0) { $0 + $1.weight }
    var tmp = [Float](repeating: 0, count: size * size)
    var lo = 1e9
    var hi = -1e9
    for y in 0..<size {
      for x in 0..<size {
        var v = 0.0
        for k in octaves.indices {
          let p = octaves[k].period
          let g = grids[k]
          let fx = Double(x) / Double(size) * Double(p)
          let fy = Double(y) / Double(size) * Double(p)
          let ix = fx.rounded(.down)
          let iy = fy.rounded(.down)
          var tx = fx - ix
          var ty = fy - iy
          tx = tx * tx * (3 - 2 * tx)
          ty = ty * ty * (3 - 2 * ty)
          let x0 = Int(ix) % p
          let x1 = (Int(ix) + 1) % p
          let y0 = Int(iy) % p
          let y1 = (Int(iy) + 1) % p
          let a = Double(g[y0 * p + x0])
          let b = Double(g[y0 * p + x1])
          let c = Double(g[y1 * p + x0])
          let d = Double(g[y1 * p + x1])
          v += octaves[k].weight * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty)
        }
        v /= sum
        tmp[y * size + x] = Float(v)
        lo = min(lo, v)
        hi = max(hi, v)
      }
    }
    var data = [UInt8](repeating: 255, count: size * size * 4)
    for i in 0..<(size * size) {
      // Math.round: halves go up.
      let scaled = (Double(tmp[i]) - lo) / (hi - lo) * 255
      let v = UInt8(clamping: Int((scaled + 0.5).rounded(.down)))
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
    }
    return data
  }
}
