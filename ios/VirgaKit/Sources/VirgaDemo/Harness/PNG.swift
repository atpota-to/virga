// Ports harness/png.js
//
// A real PNG, made without a canvas, so the link-card image the fake card
// service hands out can be fetched, decoded and shrunk by the same code a
// real one goes through. Uncompressed (stored deflate blocks): bigger than
// it needs to be, which is the point; the composer has to shrink it under
// the thumbnail limit.
//
// Byte for byte the web's: pixel values are stored as a Uint8Array stores
// them (wrapped, NaN as 0), the hills are drawn with V8's sin
// (Support/JSMath.swift), and colours rounded as Math.round rounds.

import Foundation
import VirgaCore

public enum PNG {
  static let crcTable: [UInt32] = (0..<256).map { n in
    var c = UInt32(n)
    for _ in 0..<8 { c = c & 1 != 0 ? 0xedb8_8320 ^ (c >> 1) : c >> 1 }
    return c
  }

  static func crc32(_ bytes: [UInt8]) -> UInt32 {
    var crc: UInt32 = 0xffff_ffff
    for b in bytes { crc = crcTable[Int((crc ^ UInt32(b)) & 0xff)] ^ (crc >> 8) }
    return crc ^ 0xffff_ffff
  }

  static func adler32(_ bytes: [UInt8]) -> UInt32 {
    var a: UInt32 = 1
    var b: UInt32 = 0
    for byte in bytes {
      a = (a + UInt32(byte)) % 65521
      b = (b + a) % 65521
    }
    return b << 16 | a
  }

  static func u32(_ n: UInt32) -> [UInt8] {
    [UInt8(n >> 24 & 255), UInt8(n >> 16 & 255), UInt8(n >> 8 & 255), UInt8(n & 255)]
  }

  static func chunk(_ type: String, _ data: [UInt8]) -> [UInt8] {
    let body = Array(type.utf8) + data
    return u32(UInt32(data.count)) + body + u32(crc32(body))
  }

  /// zlib with stored (uncompressed) deflate blocks.
  static func zlibStore(_ raw: [UInt8]) -> [UInt8] {
    let blocks = Swift.max(1, (raw.count + 65534) / 65535)
    var out: [UInt8] = [0x78, 0x01]
    out.reserveCapacity(2 + raw.count + blocks * 5 + 4)
    for i in 0..<blocks {
      let part = raw[Swift.min(raw.count, i * 65535)..<Swift.min(raw.count, (i + 1) * 65535)]
      let length = UInt32(part.count)
      out.append(i == blocks - 1 ? 1 : 0)
      out.append(UInt8(length & 255))
      out.append(UInt8(truncatingIfNeeded: length >> 8))
      out.append(UInt8(~length & 255))
      out.append(UInt8(~length >> 8 & 255))
      out.append(contentsOf: part)
    }
    out.append(contentsOf: u32(adler32(raw)))
    return out
  }

  /// An RGB PNG of `width` × `height`, each pixel from `pixel(x, y)`, its
  /// red, green and blue as numbers a Uint8Array stores (wrapped modulo 256,
  /// fractions cut, NaN as 0).
  public static func encodePng(
    _ width: Int, _ height: Int, _ pixel: (Int, Int) -> (Double, Double, Double)
  ) -> [UInt8] {
    let stride = width * 3 + 1
    var raw = [UInt8](repeating: 0, count: stride * height)
    for y in 0..<height {
      raw[y * stride] = 0  // filter: none
      for x in 0..<width {
        let (r, g, b) = pixel(x, y)
        let i = y * stride + 1 + x * 3
        raw[i] = JSMath.toUint8(r)
        raw[i + 1] = JSMath.toUint8(g)
        raw[i + 2] = JSMath.toUint8(b)
      }
    }
    let header = u32(UInt32(width)) + u32(UInt32(height)) + [8, 2, 0, 0, 0]
    return [137, 80, 78, 71, 13, 10, 26, 10]
      + chunk("IHDR", header)
      + chunk("IDAT", zlibStore(raw))
      + chunk("IEND", [])
  }

  /// A link card's picture: a sky and two hills, in colours from `seed`.
  public static func cardImage(_ seed: Double, width: Int = 600, height: Int = 315) -> [UInt8] {
    let hue = seed.truncatingRemainder(dividingBy: 360)
    func rgb(_ h: Double, _ s: Double, _ l: Double) -> (Double, Double, Double) {
      func k(_ n: Double) -> Double { (n + h / 30).truncatingRemainder(dividingBy: 12) }
      let a = s * JSMath.min(l, 1 - l)
      func f(_ n: Double) -> Double {
        (255 * (l - a * JSMath.max(-1, JSMath.min(JSMath.min(k(n) - 3, 9 - k(n)), 1)))).jsRounded
      }
      return (f(0), f(8), f(4))
    }
    let sky = rgb(hue, 0.5, 0.82)
    let far = rgb((hue + 30).truncatingRemainder(dividingBy: 360), 0.3, 0.6)
    let near = rgb((hue + 60).truncatingRemainder(dividingBy: 360), 0.35, 0.42)
    let h = Double(height)
    return encodePng(width, height) { x, y in
      let hillFar = h * 0.55 + JSMath.sin(Double(x) / 70 + hue) * h * 0.08
      let hillNear = h * 0.72 + JSMath.sin(Double(x) / 45 + hue / 2) * h * 0.06
      if Double(y) > hillNear { return near }
      if Double(y) > hillFar { return far }
      return sky
    }
  }
}
