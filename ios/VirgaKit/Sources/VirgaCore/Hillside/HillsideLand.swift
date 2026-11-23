// Ports src/hillside/land.js (height, and createLand's mesh)
//
// The land under the sky: a height field of gentle rolls and six hills,
// and the mesh createLand builds of it, 190 rings out from the camera's
// foot (from 1 to 9,000, spaced geometrically) of 320 points each, with
// normals from the field's slope, and the triangle list between the
// rings. Positions and normals are Float32, as the web's Float32Array
// holds them. Plain Swift, held to the web by
// ios/parity/cases/hillside.land.js.

import Foundation

public struct HillsideMesh: Sendable {
  /// x, y, z per vertex.
  public var positions: [Float]
  public var normals: [Float]
  /// Three per triangle.
  public var indices: [UInt32]
  public var vertexCount: Int { positions.count / 3 }
}

public enum HillsideLand {
  public static let rings = 190
  public static let segments = 320
  public static let innerRadius: Double = 1
  public static let outerRadius: Double = 9000

  static func bump(_ u: Double, _ v: Double) -> Double { exp(-(u * u + v * v)) }

  /// `height(x, z)`: the land's height at a point.
  public static func height(_ x: Double, _ z: Double) -> Double {
    var h = 2.5 * sin(x * 0.012 + 1.1) * cos(z * 0.01 + 0.3) + 1.2 * sin((x + z) * 0.021)
    h += 62 * bump((x + 90) / 270, (z + 430) / 210)
    h += 34 * bump((x - 430) / 260, (z + 780) / 220)
    h += 95 * bump((x - 1500) / 800, (z + 2900) / 600)
    h += 80 * bump((x + 1700) / 1000, (z + 3400) / 700)
    h += 130 * bump((x - 300) / 1800, (z + 5600) / 1000)
    h += 70 * bump((x - 2800) / 900, (z + 2100) / 500)
    return h
  }

  /// createLand's geometry.
  public static func mesh(rings: Int = rings, segments: Int = segments) -> HillsideMesh {
    var pos = [Float](repeating: 0, count: rings * segments * 3)
    var nrm = [Float](repeating: 0, count: rings * segments * 3)
    for i in 0..<rings {
      let r = innerRadius * pow(outerRadius / innerRadius, Double(i) / Double(rings - 1))
      let e = max(0.25, r * 0.004)
      for j in 0..<segments {
        let a = Double(j) / Double(segments) * Double.pi * 2
        let x = sin(a) * r
        let z = -cos(a) * r
        let k = (i * segments + j) * 3
        pos[k] = Float(x)
        pos[k + 1] = Float(height(x, z))
        pos[k + 2] = Float(z)
        let dx = (height(x + e, z) - height(x - e, z)) / (2 * e)
        let dz = (height(x, z + e) - height(x, z - e)) / (2 * e)
        let l = (dx * dx + 1 + dz * dz).squareRoot()
        nrm[k] = Float(-dx / l)
        nrm[k + 1] = Float(1 / l)
        nrm[k + 2] = Float(-dz / l)
      }
    }
    var idx: [UInt32] = []
    idx.reserveCapacity((rings - 1) * segments * 6)
    for i in 0..<(rings - 1) {
      for j in 0..<segments {
        let a = UInt32(i * segments + j)
        let b = UInt32(i * segments + (j + 1) % segments)
        let c = a + UInt32(segments)
        let d = b + UInt32(segments)
        idx += [a, b, c, b, d, c]
      }
    }
    return HillsideMesh(positions: pos, normals: nrm, indices: idx)
  }
}
