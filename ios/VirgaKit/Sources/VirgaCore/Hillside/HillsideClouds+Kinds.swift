// Ports src/hillside/clouds.js (TYPES, GEN, measureTop, makeCloud, layout)
//
// The sky of a fair day, the same one every visit: nine fat cumulus through
// the middle of the sky, sixteen little ones low over the far hills, five
// thin sheets of stratus along the horizon and five mares' tails of cirrus
// way up. Each cloud is a heap of puffs made by its kind's generator in the
// cloud's own space (about 12 units wide at size 1, its base at y = 0),
// every number drawn from clouds.js's seeded mulberry in the web's order,
// so the heaps are the web's puff for puff. Held to the web by
// ios/parity/cases/hillside.clouds.js, which reads these from clouds.js's
// own source (they aren't exported).

import Foundation

/// The three kinds of cloud.
public enum HillsideCloudKind: String, Codable, CaseIterable, Hashable, Sendable {
  case cumulus, stratus, cirrus

  /// `TYPES[kind]`: how many puffs at count 1, how opaque, how eroded
  /// their edges, how fast the wind takes it.
  public struct Traits: Hashable, Sendable {
    public var base: Double
    public var alpha: Double
    public var ero: Double
    public var drift: Double
  }

  public var traits: Traits {
    switch self {
    case .cumulus: return Traits(base: 160, alpha: 0.96, ero: 0.55, drift: 1)
    case .stratus: return Traits(base: 170, alpha: 0.8, ero: 0.45, drift: 0.7)
    case .cirrus: return Traits(base: 260, alpha: 0.34, ero: 0.95, drift: 1.6)
    }
  }
}

/// What a generator is given: `P`.
public struct HillsideCloudParams: Hashable, Sendable {
  public var size: Double
  public var height: Double
  public var fluff: Double
  public var count: Double

  public init(size: Double, height: Double, fluff: Double, count: Double) {
    self.size = size
    self.height = height
    self.fluff = fluff
    self.count = count
  }
}

/// A puff as a generator makes it: where, how big, its shade, and (some
/// kinds only) its stretch and the axis it is stretched along.
public struct HillsideRawPuff: Hashable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double
  public var r: Double
  public var sh: Double
  public var st: Double?
  public var ax: Double?
  public var ay: Double?
  public var az: Double?
}

/// A puff of a made cloud: makeCloud's, with the defaults filled in, the
/// radius grown for a cloud of fewer puffs, and a seed of its own.
public struct HillsidePuff: Hashable, Sendable {
  public var x: Double
  public var y: Double
  public var z: Double
  public var r: Double
  public var sh: Double
  public var st: Double
  public var ax: Double
  public var ay: Double
  public var az: Double
  public var seed: Double
}

/// `makeCloud`'s cloud. `pos` moves as the wind takes it; the rest stays.
public struct HillsideCloud: Hashable, Sendable {
  public var kind: HillsideCloudKind
  public var size: Double
  public var rotY: Double
  public var pos: HillsideVector
  public var puffs: [HillsidePuff]
  public var top: Double
  public var alpha: Double
  public var ero: Double
}

extension HillsideClouds {
  public static let tau = Double.pi * 2

  /// clouds.js's `smooth(e0, e1, x)`.
  public static func smooth(_ e0: Double, _ e1: Double, _ x: Double) -> Double {
    let t = min(max((x - e0) / (e1 - e0), 0), 1)
    return t * t * (3 - 2 * t)
  }

  /// `rngAt(seed, i)`: puff i's own generator, one number already spent.
  static func rngAt(_ seed: Double, _ i: Int) -> HillsideRandom {
    var r = HillsideRandom(seed: Double(toInt32(seed * 7919 + Double(i) * 104_729 + 17)))
    _ = r.next()
    return r
  }

  /// `GEN[kind](seed, P)`.
  public static func generate(_ kind: HillsideCloudKind, seed: Double, _ p: HillsideCloudParams) -> [HillsideRawPuff] {
    switch kind {
    case .cumulus: return cumulus(seed, p)
    case .stratus: return stratus(seed, p)
    case .cirrus: return cirrus(seed, p)
    }
  }

  struct Dome {
    var cx: Double
    var cz: Double
    var rad: Double
    var h: Double
    var w: Double
  }

  static func cumulus(_ seed: Double, _ p: HillsideCloudParams) -> [HillsideRawPuff] {
    var rand = HillsideRandom(seed: seed)
    let n = Int((HillsideCloudKind.cumulus.traits.base * p.count).jsRounded)
    var out: [HillsideRawPuff] = []
    out.reserveCapacity(max(0, n))
    let k = 3 + Int((rand.next() * 3).rounded(.down))
    var domes: [Dome] = []
    for j in 0..<k {
      let f = Double(j) / Double(k - 1) - 0.5
      let big = 1 - abs(f) * 0.9
      let rad = 1.9 + big * 1.9 + rand.next() * 0.8
      let cx = f * 8.5 + (rand.next() - 0.5) * 1.2
      let cz = (rand.next() - 0.5) * 2.6
      let h = rad * (0.95 + rand.next() * 0.5) * p.height
      domes.append(Dome(cx: cx, cz: cz, rad: rad, h: h, w: rad))
    }
    let wsum = domes.reduce(0.0) { $0 + $1.w }
    for i in 0..<max(0, n) {
      var r = rngAt(seed, i)
      if r.next() < 0.22 {
        // the base: wide, flattened puffs, so the bottom reads as one level line
        let x = (r.next() - 0.5) * 12.4
        let pr = (1.15 + r.next() * 0.7) * (0.75 + p.fluff * 0.5)
        let z = (r.next() - 0.5) * 4.8 * (1 - abs(x) / 9)
        out.append(HillsideRawPuff(x: x, y: pr * 0.3, z: z, r: pr, sh: 0.04, st: 0.42))
        continue
      }
      var pick = r.next() * wsum
      var d = domes[0]
      for q in domes {
        pick -= q.w
        if pick <= 0 {
          d = q
          break
        }
      }
      let u = r.next() * tau
      let v = pow(r.next(), 0.7)
      let s = (1 - v * v).squareRoot()
      let rad = pow(r.next(), 0.3)
      // most fill the dome; some are small, crisp florets right on its skin, the cauliflower look
      let floret = r.next() < 0.2
      let pr: Double
      if floret {
        pr = (0.5 + r.next() * 0.3) * (0.8 + p.fluff * 0.4)
      } else {
        pr = (0.8 + r.next() * 1.1) * (1 - rad * 0.25) * (0.7 + p.fluff * 0.6)
      }
      let reach = floret ? 1.08 : rad
      let x = d.cx + cos(u) * s * d.rad * 1.2 * reach
      let z = d.cz + sin(u) * s * d.rad * 0.95 * reach
      out.append(HillsideRawPuff(x: x, y: max(v * d.h * reach + 0.4, pr * 0.6), z: z, r: pr, sh: 0))
    }
    return out
  }

  static func stratus(_ seed: Double, _ p: HillsideCloudParams) -> [HillsideRawPuff] {
    var rand = HillsideRandom(seed: seed)
    let n = Int((HillsideCloudKind.stratus.traits.base * p.count).jsRounded)
    var out: [HillsideRawPuff] = []
    out.reserveCapacity(max(0, n))
    let w = 14 + rand.next() * 4
    let depth = 6.5 + rand.next() * 2.5
    let ph = rand.next() * tau
    for i in 0..<max(0, n) {
      var r = rngAt(seed, i)
      let g1 = r.next()
      let g2 = r.next()
      let g3 = r.next()
      let gx = (g1 + g2 + g3 - 1.5) / 1.5
      let z1 = r.next()
      let z2 = r.next()
      let gz = z1 + z2 - 1
      let edge = 1 - min(1, hillsideHypot(gx, gz * 0.8))
      let x = gx * w
      let z = gz * depth
      let swell = sin(x * 0.3 + ph) * 0.3 + sin(z * 0.55 + ph * 1.7) * 0.18
      let pr = (1.8 + r.next() * 1.2) * (0.75 + p.fluff * 0.5) * (0.55 + edge * 0.5)
      let lift = swell + (r.next() - 0.5) * 0.5
      let y = 0.8 + lift * p.height * (0.5 + edge * 0.7)
      let st = 0.3 + r.next() * 0.1
      out.append(HillsideRawPuff(x: x, y: y, z: z, r: pr, sh: 0.07 + (1 - edge) * 0.05, st: st))
    }
    return out
  }

  struct Strand {
    var x0: Double
    var z0: Double
    var y0: Double
    var len: Double
    var ang: Double
    var ph: Double
    var amp: Double
    var waves: Double
    var hook: Bool
    var lift: Double
  }

  static func cirrus(_ seed: Double, _ p: HillsideCloudParams) -> [HillsideRawPuff] {
    var rand = HillsideRandom(seed: seed)
    let n = Int((HillsideCloudKind.cirrus.traits.base * p.count).jsRounded)
    var out: [HillsideRawPuff] = []
    out.reserveCapacity(max(0, n))
    let count = 4 + Int((rand.next() * 3).rounded(.down))
    let flow = (rand.next() - 0.5) * 0.5
    var strands: [Strand] = []
    for j in 0..<count {
      let x0 = -9 + rand.next() * 3
      let z0 = (Double(j) / Double(count - 1) - 0.5) * 10 + (rand.next() - 0.5) * 2
      let y0 = (rand.next() - 0.5) * 1.2
      let len = 11 + rand.next() * 7
      let ang = flow + (rand.next() - 0.5) * 0.35
      let ph = rand.next() * tau
      let amp = 0.5 + rand.next() * 0.9
      let waves = 1 + rand.next() * 1.5
      let hook = rand.next() < 0.65
      let lift = 1 + rand.next() * 1.4
      strands.append(Strand(x0: x0, z0: z0, y0: y0, len: len, ang: ang, ph: ph, amp: amp, waves: waves, hook: hook, lift: lift))
    }
    // a point on a strand: a long, slow wave, most ending in a hook that curls
    // up and back, the "mares' tails"
    func at(_ s: Strand, _ t: Double) -> (Double, Double, Double) {
      let ca = cos(s.ang)
      let sa = sin(s.ang)
      let u = t * s.len
      let wig = sin(t * s.waves * Double.pi + s.ph) * s.amp
      var x = s.x0 + u * ca - wig * sa
      var z = s.z0 + u * sa + wig * ca
      var y = s.y0 + sin(t * 2.2 + s.ph) * 0.35
      if s.hook && t > 0.7 {
        let c = (t - 0.7) / 0.3
        y += c * c * s.lift * 0.6
        x -= c * c * 0.7 * ca
        z -= c * c * 0.7 * sa
      }
      return (x, y * p.height, z)
    }
    for i in 0..<max(0, n) {
      var r = rngAt(seed, i)
      let s = strands[Int((r.next() * Double(count)).rounded(.down))]
      let t = r.next()
      let point = at(s, t)
      let a = at(s, max(0, t - 0.02))
      let b = at(s, min(1, t + 0.02))
      var ax = b.0 - a.0
      var ay = b.1 - a.1
      var az = b.2 - a.2
      let measured = hillsideHypot(ax, ay, az)
      let al = measured == 0 || measured.isNaN ? 1 : measured
      ax /= al
      ay /= al
      az /= al
      let off = (r.next() - 0.5) * 1.1
      let head = s.hook && t > 0.86
      let pr = (0.3 + r.next() * 0.28) * (0.75 + p.fluff * 0.5) * (1 - abs(t - 0.5) * 0.5) * (head ? 1.35 : 1)
      let y = 1 + point.1 + (r.next() - 0.5) * 0.25
      let st = head ? 1.3 : 3.4 + r.next() * 2.2
      out.append(
        HillsideRawPuff(x: point.0 - az * off, y: y, z: point.2 + ax * off, r: pr, sh: 0, st: st, ax: ax, ay: ay, az: az))
    }
    return out
  }

  /// `measureTop(puffs)`: the highest a puff's top half reaches, at least 0.5.
  public static func measureTop(_ puffs: [HillsidePuff]) -> Double {
    var top = 0.5
    for p in puffs { top = max(top, p.y + p.r * 0.5) }
    return top
  }

  /// `makeCloud(kind, seed, P, pos, rotY)`.
  public static func makeCloud(
    _ kind: HillsideCloudKind, seed: Double, _ p: HillsideCloudParams, pos: HillsideVector, rotY: Double
  ) -> HillsideCloud {
    let traits = kind.traits
    let grow = 1 / p.count.squareRoot()
    var rand = HillsideRandom(seed: seed + 1)
    let puffs = generate(kind, seed: seed, p).map { g in
      HillsidePuff(
        x: g.x, y: g.y, z: g.z, r: g.r * grow, sh: g.sh, st: g.st ?? 1, ax: g.ax ?? 0, ay: g.ay ?? 1, az: g.az ?? 0,
        seed: rand.next())
    }
    return HillsideCloud(
      kind: kind, size: p.size, rotY: rotY, pos: pos, puffs: puffs, top: measureTop(puffs), alpha: traits.alpha,
      ero: traits.ero * (0.55 + p.fluff * 0.9))
  }

  /// The seed createClouds lays the sky out with.
  public static let layoutSeed: Double = 20061

  /// `layout(seed)`: the fair day's clouds. The camera looks down −z; one
  /// unit is a metre.
  public static func layout(_ seed: Double = layoutSeed) -> [HillsideCloud] {
    var rand = HillsideRandom(seed: seed)
    var out: [HillsideCloud] = []
    func add(_ kind: HillsideCloudKind, _ dist: Double, _ ang: Double, _ alt: Double, _ size: Double, _ count: Double) {
      let height = 0.8 + rand.next() * 0.5
      let fluff = 0.55 + rand.next() * 0.3
      let p = HillsideCloudParams(size: size, height: height, fluff: fluff, count: count)
      let pos = HillsideVector(sin(ang) * dist, alt, -cos(ang) * dist)
      let cloudSeed = Double(toInt32(rand.next() * 1e9))
      let rotY = rand.next() * tau
      out.append(makeCloud(kind, seed: cloudSeed, p, pos: pos, rotY: rotY))
    }
    // the big ones, in the middle of the sky
    for i in 0..<9 {
      let dist = 2800 + rand.next() * 3600
      let ang = (Double(i) / 9 - 0.5) * 2.4 + (rand.next() - 0.5) * 0.2
      let alt = 700 + rand.next() * 900
      let size = 55 + rand.next() * 35
      add(.cumulus, dist, ang, alt, size, 0.55)
    }
    // small ones low over the horizon, far off
    for i in 0..<16 {
      let dist = 9000 + rand.next() * 5000
      let ang = (Double(i) / 16 - 0.5) * 2.4 + (rand.next() - 0.5) * 0.12
      let alt = 500 + rand.next() * 600
      let size = 55 + rand.next() * 40
      add(.cumulus, dist, ang, alt, size, 0.3)
    }
    // a thin sheet or two along the horizon
    for i in 0..<5 {
      let dist = 15000 + rand.next() * 3000
      let ang = (Double(i) / 5 - 0.5) * 2.2
      let alt = 700 + rand.next() * 400
      let size = 120 + rand.next() * 60
      add(.stratus, dist, ang, alt, size, 0.3)
    }
    // mares' tails, way up and far off
    for i in 0..<5 {
      let dist = 8000 + rand.next() * 4000
      let ang = (Double(i) / 5 - 0.5) * 1.9 + (rand.next() - 0.5) * 0.3
      let alt = 4200 + rand.next() * 1600
      let size = 110 + rand.next() * 50
      add(.cirrus, dist, ang, alt, size, 0.8)
    }
    return out
  }
}
