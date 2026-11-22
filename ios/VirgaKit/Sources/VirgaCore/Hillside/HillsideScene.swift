// Ports src/hillside/scene.js (PALETTES, phaseOf, TURN, COLOR_KEYS and its helpers)
//
// The hillside's light: four skies, each a palette (the sky from overhead
// to the horizon, the sun and where it comes from, whether its disc shows,
// how many stars, the clouds' lit side, shadow, rim and fog, the grass in
// light, half-light and shade, and the haze). Day is the picture: deep
// blue overhead, paler to the horizon, bright white clouds lit from behind
// you and a vivid green hill. Dawn is a warm, low sun just behind the far
// hills; dusk the sun going down to the left, the sky above it already
// violet; night a deep blue with a paler band low down, the land a shape
// more than a colour, and a few stars. A change of sky takes TURN seconds.
//
// The values are scene.js's own module-level constants, which it doesn't
// export: ios/parity/cases/hillside.scene.js reads them from its source and
// records them, and HillsideSceneParityTests holds these to them.
// createHillside's closure (the camera, the turning, the intro, the lean,
// the frame loop) is HillsideSceneState (HillsideScene+State.swift).

import Foundation

/// One sky's colours and light: a value of scene.js's PALETTES.
public struct HillsidePalette: Hashable, Sendable {
  public var top: HillsideColor
  public var mid: HillsideColor
  public var low: HillsideColor
  public var hor: HillsideColor
  public var sunCol: HillsideColor
  /// Where the light comes from (not yet normalized).
  public var sun: HillsideVector
  /// Whether the sun's disc is drawn (0 or 1).
  public var disc: Double
  /// How much of the stars shows.
  public var stars: Double
  public var cloudLit: HillsideColor
  public var cloudShadow: HillsideColor
  public var cloudRim: HillsideColor
  public var cloudFog: HillsideColor
  public var lit: HillsideColor
  public var mid2: HillsideColor
  public var shade: HillsideColor
  public var haze: HillsideColor

  /// The colour under one of COLOR_KEYS.
  public func color(_ key: HillsideColorKey) -> HillsideColor {
    switch key {
    case .top: return top
    case .mid: return mid
    case .low: return low
    case .hor: return hor
    case .sunCol: return sunCol
    case .cloudLit: return cloudLit
    case .cloudShadow: return cloudShadow
    case .cloudRim: return cloudRim
    case .cloudFog: return cloudFog
    case .lit: return lit
    case .mid2: return mid2
    case .shade: return shade
    case .haze: return haze
    }
  }
}

/// COLOR_KEYS: the colours a change of sky eases, in scene.js's order.
public enum HillsideColorKey: String, CaseIterable, Hashable, Sendable {
  case top, mid, low, hor, sunCol, cloudLit, cloudShadow, cloudRim, cloudFog, lit, mid2, shade, haze
}

public enum HillsideScene {
  /// `DEG`.
  public static let deg = Double.pi / 180
  /// `TURN`: how long a change of sky takes, in seconds.
  public static let turn = 3.4
  /// How long the intro takes to bring the view down, in seconds (draw's
  /// `dt / 3.4`).
  public static let introSeconds = 3.4
  /// `EYE`: how high you stand above the grass.
  public static let eye = 6.5
  /// `WIND`: the wind's speed.
  public static let wind: Double = 22
  /// The camera's field and range: `new THREE.PerspectiveCamera(50, 1, 1, 40000)`.
  public static let near: Double = 1
  public static let far: Double = 40000
  /// The wind's way across the land: `new THREE.Vector2(1, -0.18).normalize()`.
  public static let windDir = HillsideVector(1, -0.18).normalized2

  public static func clamp(_ v: Double, _ a: Double, _ b: Double) -> Double { max(a, min(b, v)) }
  public static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

  /// scene.js's `smooth(t)`.
  public static func smooth(_ t: Double) -> Double {
    let x = clamp(t, 0, 1)
    return x * x * (3 - 2 * x)
  }

  /// `easeOut(t)`.
  public static func easeOut(_ t: Double) -> Double {
    1 - pow(1 - clamp(t, 0, 1), 3)
  }

  /// `phaseOf(name)`: the skies the scene can show; anything else is day.
  public static func phaseOf(_ name: String?) -> SkyPhase {
    guard let name else { return .day }
    for phase in SkyPhase.allCases where phase.rawValue.jsEquals(name) { return phase }
    return .day
  }

  /// `PALETTES`.
  public static func palette(_ phase: SkyPhase) -> HillsidePalette {
    switch phase {
    case .day:
      return HillsidePalette(
        top: HillsideColor(hex: "#1c54cc"), mid: HillsideColor(hex: "#3a7fe2"), low: HillsideColor(hex: "#8bbaf0"),
        hor: HillsideColor(hex: "#d4e7f8"), sunCol: HillsideColor(hex: "#fff1d2"), sun: HillsideVector(-0.62, 0.6, 0.4),
        disc: 0, stars: 0, cloudLit: HillsideColor(hex: "#ffffff"), cloudShadow: HillsideColor(hex: "#a9bee6"),
        cloudRim: HillsideColor(hex: "#fff4e4"), cloudFog: HillsideColor(hex: "#cde1f6"), lit: HillsideColor(hex: "#86c93a"),
        mid2: HillsideColor(hex: "#43a026"), shade: HillsideColor(hex: "#1d5c16"), haze: HillsideColor(hex: "#a9c9e9"))
    case .dawn:
      return HillsidePalette(
        top: HillsideColor(hex: "#3b5aa8"), mid: HillsideColor(hex: "#7890cf"), low: HillsideColor(hex: "#e7b7a6"),
        hor: HillsideColor(hex: "#ffd59e"), sunCol: HillsideColor(hex: "#ffbf6e"), sun: HillsideVector(0.6, 0.035, -0.8),
        disc: 1, stars: 0, cloudLit: HillsideColor(hex: "#ffe0c4"), cloudShadow: HillsideColor(hex: "#8d8bbd"),
        cloudRim: HillsideColor(hex: "#ffad62"), cloudFog: HillsideColor(hex: "#f2cdb0"), lit: HillsideColor(hex: "#9cb04a"),
        mid2: HillsideColor(hex: "#557c2c"), shade: HillsideColor(hex: "#22431e"), haze: HillsideColor(hex: "#e4c2aa"))
    case .dusk:
      return HillsidePalette(
        top: HillsideColor(hex: "#262a66"), mid: HillsideColor(hex: "#5d4a8f"), low: HillsideColor(hex: "#c9796b"),
        hor: HillsideColor(hex: "#ffb070"), sunCol: HillsideColor(hex: "#ff8f4a"), sun: HillsideVector(-0.6, 0.03, -0.8),
        disc: 1, stars: 0.25, cloudLit: HillsideColor(hex: "#ffc2a0"), cloudShadow: HillsideColor(hex: "#54477e"),
        cloudRim: HillsideColor(hex: "#ff8748"), cloudFog: HillsideColor(hex: "#c98f86"), lit: HillsideColor(hex: "#7c8440"),
        mid2: HillsideColor(hex: "#3c5429"), shade: HillsideColor(hex: "#172b1e"), haze: HillsideColor(hex: "#b98a86"))
    case .night:
      return HillsidePalette(
        top: HillsideColor(hex: "#050a1d"), mid: HillsideColor(hex: "#0c1838"), low: HillsideColor(hex: "#182c55"),
        hor: HillsideColor(hex: "#2a4470"), sunCol: HillsideColor(hex: "#31486f"), sun: HillsideVector(-0.35, 0.55, 0.45),
        disc: 0, stars: 1, cloudLit: HillsideColor(hex: "#3d4e74"), cloudShadow: HillsideColor(hex: "#131b33"),
        cloudRim: HillsideColor(hex: "#5a6d96"), cloudFog: HillsideColor(hex: "#1d2f54"), lit: HillsideColor(hex: "#24463a"),
        mid2: HillsideColor(hex: "#143026"), shade: HillsideColor(hex: "#081712"), haze: HillsideColor(hex: "#1f3358"))
    }
  }
}

/// The scene's PerspectiveCamera, as the scene places it: where it stands,
/// which way it looks, its field and its matrices.
public struct HillsideCamera: Hashable, Sendable {
  public var fov: Double = 50
  public var aspect: Double = 1
  public var near = HillsideScene.near
  public var far = HillsideScene.far
  public var position = HillsideVector.zero
  /// `rotation` (x pitch, y yaw, z 0), in the order 'YXZ'.
  public var rotation = HillsideVector.zero
  public var quaternion = HillsideQuaternion.identity
  public var matrixWorld = HillsideMatrix.identity
  /// The view matrix.
  public var matrixWorldInverse = HillsideMatrix.identity

  public init() {}

  /// `position.set(…)`, `rotation.set(x, y, 0, 'YXZ')`, `updateMatrixWorld()`.
  public mutating func place(_ at: HillsideVector, pitch: Double, yaw: Double) {
    position = at
    rotation = HillsideVector(pitch, yaw, 0)
    quaternion = HillsideQuaternion.fromEulerYXZ(pitch, yaw, 0)
    matrixWorld = HillsideMatrix.compose(position, quaternion)
    matrixWorldInverse = matrixWorld.inverted
  }

  /// `getWorldDirection()`: the way it looks, −z of its world matrix.
  public var worldDirection: HillsideVector {
    let e = matrixWorld.elements
    let d = HillsideVector(e[8], e[9], e[10]).normalized
    return HillsideVector(-d.x, -d.y, -d.z)
  }

  /// `projectionMatrix`, for a frame whose z runs as `depth` says, or for
  /// part of the frame.
  public func projection(depth: HillsideMatrix.DepthRange = .webGL, viewOffset: HillsideMatrix.ViewOffset? = nil) -> HillsideMatrix {
    HillsideMatrix.perspective(fov: fov, aspect: aspect, near: near, far: far, depth: depth, viewOffset: viewOffset)
  }
}

extension HillsideScene {
  /// The sky's dome: `new THREE.SphereGeometry(30000, 48, 24)` (seen from
  /// inside; its normals aren't needed).
  public static let skyRadius: Double = 30000

  public static func skySphere(radius: Double = skyRadius, widthSegments: Int = 48, heightSegments: Int = 24) -> HillsideMesh {
    var positions: [Float] = []
    positions.reserveCapacity((widthSegments + 1) * (heightSegments + 1) * 3)
    for iy in 0...heightSegments {
      let v = Double(iy) / Double(heightSegments)
      let theta = v * Double.pi
      let y = radius * cos(theta)
      let ringRadius = (radius * radius - y * y).squareRoot()
      for ix in 0...widthSegments {
        let u = Double(ix) / Double(widthSegments)
        let phi = u * (Double.pi * 2)
        positions += [Float(-ringRadius * cos(phi)), Float(y), Float(ringRadius * sin(phi))]
      }
    }
    var indices: [UInt32] = []
    let row = widthSegments + 1
    for iy in 0..<heightSegments {
      for ix in 0..<widthSegments {
        let a = UInt32(iy * row + ix + 1)
        let b = UInt32(iy * row + ix)
        let c = UInt32((iy + 1) * row + ix)
        let d = UInt32((iy + 1) * row + ix + 1)
        if iy != 0 { indices += [a, b, d] }
        if iy != heightSegments - 1 { indices += [b, c, d] }
      }
    }
    return HillsideMesh(positions: positions, normals: [], indices: indices)
  }
}
