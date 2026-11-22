// Ports src/hillside/clouds.js (createClouds: the batch, its drift and its staging)
//
// Every puff of every cloud in one instanced batch, sorted back to front
// each frame. The wind carries the clouds sideways across the view at their
// own pace by kind, round the back to come in again from the other side,
// fading out near the edge where they wrap. Each frame `update` moves the
// clouds, stages the puffs of the ones that show (where each is in the
// world, how big, its light and shade, its alpha and seed, its edge's
// erosion, the axis it is stretched along), and sorts them by how far
// along the camera's view each is. The staged numbers are Float32, as the
// web's Float32Arrays hold them; `instances` is what the GPU reads, sixteen
// floats a puff (the web's aPos and aRad, aData, aFx, aShape).

import Foundation

public struct HillsideCloudBatch: Sendable {
  /// How far round from straight ahead a cloud can drift before it wraps
  /// to the other side, and where it starts to fade.
  public static let edge = 1.25
  public static let fade = 1.05
  /// The puffs' storm colour, fog and its reach.
  public static let storm = HillsideColor(hex: "#7d86b0")
  public static let fogNear: Double = 2500
  public static let fogFar: Double = 16000
  public static let fogMax = 0.62
  /// Floats a puff takes in `instances`.
  public static let stride = 16

  public private(set) var clouds: [HillsideCloud]
  /// Every puff of every cloud: the batch's size.
  public let capacity: Int
  /// The puffs staged by the last update, sorted back to front: per puff
  /// x, y, z, radius; light, shade, alpha, seed; 0, 0, erosion, 0; the
  /// axis's x, y, z and the stretch along it.
  public private(set) var instances: [Float]
  /// How many puffs the last update staged.
  public private(set) var count = 0
  /// The sun as the camera sees it.
  public private(set) var sunView = HillsideVector.zero

  private var staged: [Float]
  private var depth: [Float]

  public init(clouds: [HillsideCloud] = HillsideClouds.layout()) {
    self.clouds = clouds
    let capacity = clouds.reduce(0) { $0 + $1.puffs.count }
    self.capacity = capacity
    instances = [Float](repeating: 0, count: capacity * Self.stride)
    staged = [Float](repeating: 0, count: capacity * Self.stride)
    depth = [Float](repeating: 0, count: capacity)
  }

  /// `update(dt, wind)`, with the camera as the scene has just placed it.
  public mutating func update(dt: Double, wind: Double, camera: HillsideCamera, sunDir: HillsideVector) {
    let fwd = camera.worldDirection
    let cam = camera.position
    var n = 0
    for index in clouds.indices {
      let traits = clouds[index].kind.traits
      let pos = clouds[index].pos
      let d = hillsideHypot(pos.x, pos.z)
      var ang = atan2(pos.x, -pos.z) + (wind * traits.drift * dt) / d
      if ang > Self.edge {
        ang -= Self.edge * 2
      } else if ang < -Self.edge {
        ang += Self.edge * 2
      }
      clouds[index].pos.x = sin(ang) * d
      clouds[index].pos.z = -cos(ang) * d
      let ca = clouds[index].alpha * (1 - HillsideClouds.smooth(Self.fade, Self.edge, abs(ang)))
      if ca > 0.003 { n = stage(clouds[index], ca: ca, n: n, sun: sunDir, cam: cam, fwd: fwd) }
    }
    // Back to front; ties keep the order they were staged in, as the web's
    // stable sort does.
    var order = Array(0..<n)
    let depths = depth
    order.sort { a, b in
      let da = depths[a]
      let db = depths[b]
      return da != db ? da > db : a < b
    }
    let s = Self.stride
    for (i, j) in order.enumerated() {
      for k in 0..<s { instances[i * s + k] = staged[j * s + k] }
    }
    count = n
    sunView = sunDir.transformDirection(camera.matrixWorldInverse)
  }

  private mutating func stage(
    _ c: HillsideCloud, ca: Double, n start: Int, sun: HillsideVector, cam: HillsideVector, fwd: HillsideVector
  ) -> Int {
    var n = start
    let s = c.size
    let cs = cos(c.rotY)
    let sn = sin(c.rotY)
    let bx = c.pos.x
    let by = c.pos.y
    let bz = c.pos.z
    let my = by + c.top * s * 0.45
    let k = Self.stride
    for p in c.puffs {
      let lx = p.x * s
      let ly = p.y * s
      let lz = p.z * s
      let wx = bx + lx * cs + lz * sn
      let wy = by + ly
      let wz = bz - lx * sn + lz * cs
      let ox = wx - bx
      let oy = wy - my
      let oz = wz - bz
      let measured = hillsideHypot(ox, oy, oz)
      let ol = measured == 0 || measured.isNaN ? 1 : measured
      let side = (ox * sun.x + oy * sun.y + oz * sun.z) / ol
      // (A puff may carry its own `hl`; none of the generators gives one.)
      let h = min(max(p.y / c.top, 0), 1)
      let axisLength = hillsideHypot(p.ax, p.ay, p.az)
      let al = axisLength == 0 || axisLength.isNaN ? 1 : axisLength
      let base = n * k
      staged[base] = Float(wx)
      staged[base + 1] = Float(wy)
      staged[base + 2] = Float(wz)
      staged[base + 3] = Float(p.r * s)
      staged[base + 4] = Float(0.1 + 0.5 * h + 0.45 * (0.5 + 0.5 * side))
      staged[base + 5] = Float(min(max(p.sh, 0), 0.92))
      staged[base + 6] = Float(ca)
      staged[base + 7] = Float(p.seed)
      staged[base + 8] = 0
      staged[base + 9] = 0
      staged[base + 10] = Float(c.ero)
      staged[base + 11] = 0
      staged[base + 12] = Float((p.ax * cs + p.az * sn) / al)
      staged[base + 13] = Float(p.ay / al)
      staged[base + 14] = Float((p.az * cs - p.ax * sn) / al)
      staged[base + 15] = Float(p.st)
      let dx = (wx - cam.x) * fwd.x
      let dy = (wy - cam.y) * fwd.y
      let dz = (wz - cam.z) * fwd.z
      depth[n] = Float(dx + dy + dz)
      n += 1
    }
    return n
  }
}
