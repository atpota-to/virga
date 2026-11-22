// Ports src/hillside/scene.js (the three.js arithmetic it leans on)
//
// The few pieces of three.js the hillside's scene does its sums with, kept
// to three's own order of operations (Vector3, Quaternion, a camera's
// Euler 'YXZ' turned into a quaternion and composed into a matrix, the
// matrix's inverse, a perspective projection with an optional view offset)
// so the Swift scene works out the same camera and light as the web's to
// the last bit or so. Plain Swift in Doubles, no simd; Metal gets Floats
// from these at the last moment. Matrices are column-major, as three's
// `elements` are.

import Foundation

/// A Vector3 (or Vector2, with z left at 0).
public struct HillsideVector: Hashable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double

  public init(_ x: Double, _ y: Double, _ z: Double = 0) {
    self.x = x
    self.y = y
    self.z = z
  }

  public static let zero = HillsideVector(0, 0, 0)

  public var length: Double { (x * x + y * y + z * z).squareRoot() }

  /// `normalize()`: divided by the length, or by 1 when it is 0.
  public var normalized: HillsideVector {
    let l = length
    let s = 1 / (l == 0 ? 1 : l)
    return HillsideVector(x * s, y * s, z * s)
  }

  /// A Vector2's `normalize()` (z ignored).
  public var normalized2: HillsideVector {
    let l = (x * x + y * y).squareRoot()
    let s = 1 / (l == 0 ? 1 : l)
    return HillsideVector(x * s, y * s, 0)
  }

  public func dot(_ v: HillsideVector) -> Double { x * v.x + y * v.y + z * v.z }

  /// `applyQuaternion(q)`.
  public func applying(_ q: HillsideQuaternion) -> HillsideVector {
    let tx = 2 * (q.y * z - q.z * y)
    let ty = 2 * (q.z * x - q.x * z)
    let tz = 2 * (q.x * y - q.y * x)
    return HillsideVector(
      x + q.w * tx + q.y * tz - q.z * ty,
      y + q.w * ty + q.z * tx - q.x * tz,
      z + q.w * tz + q.x * ty - q.y * tx)
  }

  /// `transformDirection(m)`: the upper 3×3 of `m` applied, normalized.
  public func transformDirection(_ m: HillsideMatrix) -> HillsideVector {
    let e = m.elements
    return HillsideVector(
      e[0] * x + e[4] * y + e[8] * z,
      e[1] * x + e[5] * y + e[9] * z,
      e[2] * x + e[6] * y + e[10] * z
    ).normalized
  }
}

public struct HillsideQuaternion: Hashable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double
  public var w: Double

  public init(_ x: Double, _ y: Double, _ z: Double, _ w: Double) {
    self.x = x
    self.y = y
    self.z = z
    self.w = w
  }

  public static let identity = HillsideQuaternion(0, 0, 0, 1)

  func dot(_ q: HillsideQuaternion) -> Double { x * q.x + y * q.y + z * q.z + w * q.w }

  var normalized: HillsideQuaternion {
    var l = (x * x + y * y + z * z + w * w).squareRoot()
    if l == 0 { return .identity }
    l = 1 / l
    return HillsideQuaternion(x * l, y * l, z * l, w * l)
  }

  /// `setFromUnitVectors(from, to)`: the rotation taking one unit vector
  /// onto the other.
  public static func fromUnitVectors(_ from: HillsideVector, _ to: HillsideVector) -> HillsideQuaternion {
    var r = from.dot(to) + 1
    let q: HillsideQuaternion
    if r < 1e-8 {
      // opposite directions
      r = 0
      if abs(from.x) > abs(from.z) {
        q = HillsideQuaternion(-from.y, from.x, 0, r)
      } else {
        q = HillsideQuaternion(0, -from.z, from.y, r)
      }
    } else {
      q = HillsideQuaternion(from.y * to.z - from.z * to.y, from.z * to.x - from.x * to.z, from.x * to.y - from.y * to.x, r)
    }
    return q.normalized
  }

  /// `slerp(qb, t)`: the short way round from this to `qb`.
  public func slerp(_ qb: HillsideQuaternion, _ t: Double) -> HillsideQuaternion {
    var bx = qb.x
    var by = qb.y
    var bz = qb.z
    var bw = qb.w
    var dot = self.dot(qb)
    if dot < 0 {
      bx = -bx
      by = -by
      bz = -bz
      bw = -bw
      dot = -dot
    }
    var s = 1 - t
    var t = t
    if dot < 0.9995 {
      let theta = acos(dot)
      let sine = sin(theta)
      s = sin(s * theta) / sine
      t = sin(t * theta) / sine
      return HillsideQuaternion(x * s + bx * t, y * s + by * t, z * s + bz * t, w * s + bw * t)
    }
    // for small angles, lerp then normalize
    return HillsideQuaternion(x * s + bx * t, y * s + by * t, z * s + bz * t, w * s + bw * t).normalized
  }

  /// `setFromEuler(new Euler(x, y, z, 'YXZ'))`.
  public static func fromEulerYXZ(_ ex: Double, _ ey: Double, _ ez: Double) -> HillsideQuaternion {
    let c1 = cos(ex / 2)
    let c2 = cos(ey / 2)
    let c3 = cos(ez / 2)
    let s1 = sin(ex / 2)
    let s2 = sin(ey / 2)
    let s3 = sin(ez / 2)
    return HillsideQuaternion(
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 - s1 * s2 * c3,
      c1 * c2 * c3 + s1 * s2 * s3)
  }
}

/// A Matrix4, column-major.
public struct HillsideMatrix: Hashable, Sendable {
  public var elements: [Double]

  public init(elements: [Double]) {
    self.elements = elements
  }

  public static let identity = HillsideMatrix(elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

  /// `compose(position, quaternion, scale 1)`.
  public static func compose(_ p: HillsideVector, _ q: HillsideQuaternion) -> HillsideMatrix {
    let x2 = q.x + q.x
    let y2 = q.y + q.y
    let z2 = q.z + q.z
    let xx = q.x * x2
    let xy = q.x * y2
    let xz = q.x * z2
    let yy = q.y * y2
    let yz = q.y * z2
    let zz = q.z * z2
    let wx = q.w * x2
    let wy = q.w * y2
    let wz = q.w * z2
    return HillsideMatrix(elements: [
      1 - (yy + zz), xy + wz, xz - wy, 0,
      xy - wz, 1 - (xx + zz), yz + wx, 0,
      xz + wy, yz - wx, 1 - (xx + yy), 0,
      p.x, p.y, p.z, 1,
    ])
  }

  /// `invert()` (gl-matrix's, as three has it).
  public var inverted: HillsideMatrix {
    let te = elements
    let n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3]
    let n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7]
    let n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11]
    let n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15]
    let t1 = n11 * n22 - n21 * n12
    let t2 = n11 * n32 - n31 * n12
    let t3 = n11 * n42 - n41 * n12
    let t4 = n21 * n32 - n31 * n22
    let t5 = n21 * n42 - n41 * n22
    let t6 = n31 * n42 - n41 * n32
    let t7 = n13 * n24 - n23 * n14
    let t8 = n13 * n34 - n33 * n14
    let t9 = n13 * n44 - n43 * n14
    let t10 = n23 * n34 - n33 * n24
    let t11 = n23 * n44 - n43 * n24
    let t12 = n33 * n44 - n43 * n34
    let det1 = t1 * t12 - t2 * t11 + t3 * t10
    let det = det1 + t4 * t9 - t5 * t8 + t6 * t7
    if det == 0 { return HillsideMatrix(elements: [Double](repeating: 0, count: 16)) }
    let d = 1 / det
    var out = [Double](repeating: 0, count: 16)
    out[0] = (n22 * t12 - n32 * t11 + n42 * t10) * d
    out[1] = (n31 * t11 - n21 * t12 - n41 * t10) * d
    out[2] = (n24 * t6 - n34 * t5 + n44 * t4) * d
    out[3] = (n33 * t5 - n23 * t6 - n43 * t4) * d
    out[4] = (n32 * t9 - n12 * t12 - n42 * t8) * d
    out[5] = (n11 * t12 - n31 * t9 + n41 * t8) * d
    out[6] = (n34 * t3 - n14 * t6 - n44 * t2) * d
    out[7] = (n13 * t6 - n33 * t3 + n43 * t2) * d
    out[8] = (n12 * t11 - n22 * t9 + n42 * t7) * d
    out[9] = (n21 * t9 - n11 * t11 - n41 * t7) * d
    out[10] = (n14 * t5 - n24 * t3 + n44 * t1) * d
    out[11] = (n23 * t3 - n13 * t5 - n43 * t1) * d
    out[12] = (n22 * t8 - n12 * t10 - n32 * t7) * d
    out[13] = (n11 * t10 - n21 * t8 + n31 * t7) * d
    out[14] = (n24 * t2 - n14 * t4 - n34 * t1) * d
    out[15] = (n13 * t4 - n23 * t2 + n33 * t1) * d
    return HillsideMatrix(elements: out)
  }

  /// Where the frame's z runs from: WebGL's −1 to 1, or Metal's 0 to 1.
  public enum DepthRange: Sendable {
    case webGL, metal
  }

  /// A part of a bigger frame, as `camera.setViewOffset(fullWidth,
  /// fullHeight, x, y, width, height)` asks for.
  public struct ViewOffset: Hashable, Sendable {
    public var fullWidth: Double
    public var fullHeight: Double
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(fullWidth: Double, fullHeight: Double, x: Double, y: Double, width: Double, height: Double) {
      self.fullWidth = fullWidth
      self.fullHeight = fullHeight
      self.x = x
      self.y = y
      self.width = width
      self.height = height
    }
  }

  /// A PerspectiveCamera's `updateProjectionMatrix()` (zoom 1, no film
  /// offset): `fov` in degrees.
  public static func perspective(
    fov: Double, aspect: Double, near: Double, far: Double, depth: DepthRange = .webGL, viewOffset: ViewOffset? = nil
  ) -> HillsideMatrix {
    var top = near * tan(HillsideScene.deg * 0.5 * fov)
    var height = 2 * top
    var width = aspect * height
    var left = -0.5 * width
    if let view = viewOffset {
      left += view.x * width / view.fullWidth
      top -= view.y * height / view.fullHeight
      width *= view.width / view.fullWidth
      height *= view.height / view.fullHeight
    }
    let right = left + width
    let bottom = top - height
    let x = 2 * near / (right - left)
    let y = 2 * near / (top - bottom)
    let a = (right + left) / (right - left)
    let b = (top + bottom) / (top - bottom)
    let c: Double
    let d: Double
    switch depth {
    case .webGL:
      c = -(far + near) / (far - near)
      d = (-2 * far * near) / (far - near)
    case .metal:
      c = -far / (far - near)
      d = (-far * near) / (far - near)
    }
    return HillsideMatrix(elements: [x, 0, 0, 0, 0, y, 0, 0, a, b, c, -1, 0, 0, d, 0])
  }
}

/// A three.js Color: r, g and b from 0 to 1, written as the stylesheet's
/// hex with no colour management (scene.js turns it off).
public struct HillsideColor: Hashable, Sendable {
  public var r: Double
  public var g: Double
  public var b: Double

  public init(r: Double, g: Double, b: Double) {
    self.r = r
    self.g = g
    self.b = b
  }

  /// `new THREE.Color()`: white.
  public static let white = HillsideColor(r: 1, g: 1, b: 1)

  /// `#rrggbb`, as `color.set('#rrggbb')` reads it.
  public init(hex: String) {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    let value = Int(digits, radix: 16) ?? 0
    r = Double(value >> 16 & 255) / 255
    g = Double(value >> 8 & 255) / 255
    b = Double(value & 255) / 255
  }

  /// `lerp(color, alpha)`.
  public func lerp(_ to: HillsideColor, _ alpha: Double) -> HillsideColor {
    HillsideColor(r: r + (to.r - r) * alpha, g: g + (to.g - g) * alpha, b: b + (to.b - b) * alpha)
  }
}

/// `Math.hypot`, as V8 works it out (each value over the largest, squared
/// and summed with Kahan's compensation), so it agrees with the web's to
/// the bit.
public func hillsideHypot(_ values: Double...) -> Double {
  var max = 0.0
  var nan = false
  for value in values {
    if value.isNaN {
      nan = true
    } else if abs(value) > max {
      max = abs(value)
    }
  }
  if max == .infinity { return .infinity }
  if nan { return .nan }
  if max == 0 { return 0 }
  var sum = 0.0
  var compensation = 0.0
  for value in values {
    let n = abs(value) / max
    let summand = n * n - compensation
    let preliminary = sum + summand
    compensation = (preliminary - sum) - summand
    sum = preliminary
  }
  return sum.squareRoot() * max
}
