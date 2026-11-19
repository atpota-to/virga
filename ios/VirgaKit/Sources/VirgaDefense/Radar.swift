// Ports src/defense/radar.js
//
// Where each mark on the radar goes, and what a scan puts on it.
//
// You are at the centre. A band is a ring: protected innermost, then
// connected, then peripheral, and everyone with no connection in the wide
// outer ring, notable accounts among them. A sector is a slice of the
// circle: what an account did to the post (its loudest engagement).
//
// Inside its ring and sector, an account's place comes from a hash of its
// DID, so it sits in the same spot every time the radar is drawn. All
// distances are fractions of the circle's radius; angles are on screen (0
// to the right, growing clockwise, since y grows downward). The strangers
// aren't drawn one by one: they are texture, a dot for each up to a cap,
// shared out between the sectors by count. Pure; the view (VirgaUI's
// Radar) draws what this places.

import Foundation
import VirgaCore

/// A ring of the radar. Notable accounts and strangers share the outer one.
public enum Ring: String, Codable, Hashable, Sendable, CaseIterable, CodingKeyRepresentable {
  case protected = "PROTECTED"
  case connected = "CONNECTED"
  case peripheral = "PERIPHERAL"
  case outer = "OUTER"
}

/// A slice of the circle: where it starts and ends, and its middle.
public struct SectorSlice: Codable, Hashable, Sendable {
  public var start: Double
  public var end: Double
  public var mid: Double
}

/// An account to place: its id (a DID), its band, its sector (an index into
/// the slices), and, for a scan, its row, which rides along for the callout.
public struct RadarPoint: Codable, Hashable, Sendable {
  public var id: String
  public var band: Band
  public var sector: Int
  public var row: ScanRow?

  public init(id: String, band: Band, sector: Int, row: ScanRow? = nil) {
    self.id = id
    self.band = band
    self.sector = sector
    self.row = row
  }
}

/// A placed account: the point, its ring, and where it is (x and y from -1
/// to 1, its distance from the centre and its angle).
public struct PlacedPoint: Codable, Hashable, Sendable {
  public var id: String
  public var band: Band
  public var sector: Int
  public var row: ScanRow?
  public var ring: Ring
  public var x: Double
  public var y: Double
  public var r: Double
  public var angle: Double
}

/// One dot of the strangers' texture.
public struct TextureDot: Codable, Hashable, Sendable {
  public var sector: Int
  public var x: Double
  public var y: Double
  public var r: Double
  public var angle: Double
}

/// A slice a scan is cut into, and the words for it.
public struct ScanSector: Codable, Hashable, Sendable {
  public var key: String
  public var name: String
  public var verb: String
}

/// A scan's slice as the radar draws it: how many engaged that way, and how
/// many of them are strangers.
public struct RadarSector: Codable, Hashable, Sendable {
  public var key: String
  public var name: String
  public var verb: String
  public var total: Int
  public var far: Int
}

/// A scan summary as the radar draws it.
public struct ScanRadar: Codable, Hashable, Sendable {
  public var sectors: [RadarSector]
  /// A mark for everyone who isn't a stranger.
  public var points: [RadarPoint]
  public var byBand: [Band: Int]
  public var total: Int
}

/// One band of the radar's table: its count in each slice, and in all.
public struct RadarTableRow: Codable, Hashable, Sendable {
  public var band: Band
  public var cells: [Int]
  public var total: Int
}

public enum Radar {
  /// RINGS: the inner and outer radius of each ring.
  public static let rings: [Ring: (inner: Double, outer: Double)] = [
    .protected: (0.04, 0.145),
    .connected: (0.2, 0.31),
    .peripheral: (0.37, 0.5),
    .outer: (0.58, 0.97),
  ]

  /// EDGES: where one ring ends and the next begins.
  public static let edges: [Ring: Double] = [.protected: 0.17, .connected: 0.34, .peripheral: 0.535, .outer: 1]

  /// The ring a band is drawn in.
  public static func ringOf(_ band: Band?) -> Ring {
    switch band {
    case .protected: return .protected
    case .connected: return .connected
    case .peripheral: return .peripheral
    default: return .outer
    }
  }

  /// The ring at a distance from the centre, or nil outside the circle.
  public static func ringAt(_ r: Double) -> Ring? {
    if r > edges[.outer]! { return nil }
    if r <= edges[.protected]! { return .protected }
    if r <= edges[.connected]! { return .connected }
    if r <= edges[.peripheral]! { return .peripheral }
    return .outer
  }

  /// Two numbers in [0, 1) from a string, the same every time: FNV-1a over
  /// its UTF-16 code units, then two rounds of mixing, as `Math.imul` does.
  public static func spots(_ text: String) -> (Double, Double) {
    var a: UInt32 = 0x811c_9dc5
    for unit in text.utf16 {
      a ^= UInt32(unit)
      a = a &* 0x0100_0193
    }
    let b = (a ^ (a >> 15)) &* 0x2c1b_3c6d
    let c = (b ^ (b >> 12)) &* 0x297a_2d39
    return (Double(b ^ (b >> 15)) / 4_294_967_296, Double(c ^ (c >> 15)) / 4_294_967_296)
  }

  /// The slices of the circle, clockwise from the top (at least one).
  public static func sectorAngles(_ n: Int) -> [SectorSlice] {
    let count = Swift.max(1, n)
    let span = (2 * Double.pi) / Double(count)
    return (0..<count).map { i in
      let start = -Double.pi / 2 + Double(i) * span
      return SectorSlice(start: start, end: start + span, mid: start + span / 2)
    }
  }

  /// The slice an angle falls in. (A NaN angle, which the web gives NaN
  /// for, is slice 0.)
  public static func sectorAt(_ angle: Double, _ n: Int) -> Int {
    let span = (2 * Double.pi) / Double(Swift.max(1, n))
    let turn = 2 * Double.pi
    let turned = ((angle + Double.pi / 2).truncatingRemainder(dividingBy: turn) + turn).truncatingRemainder(dividingBy: turn)
    let index = (turned / span).rounded(.down)
    guard index.isFinite else { return 0 }
    return Swift.min(n - 1, Int(index))
  }

  /// How far from a sector's edges marks stay, so a slice reads as a slice.
  static let edgeGap = 0.09

  static func spot(_ ring: Ring, _ slice: SectorSlice, _ u: Double, _ v: Double) -> (
    x: Double, y: Double, r: Double, angle: Double
  ) {
    let (lo, hi) = rings[ring]!
    let span = slice.end - slice.start
    // Fewer sectors than three leave no edge to keep away from.
    let gap = JSMath.min(edgeGap, span / 6)
    let angle = slice.start + gap + u * (span - 2 * gap)
    // Even over the ring's area, not bunched at its inner edge.
    let r = (lo * lo + v * (hi * hi - lo * lo)).squareRoot()
    return (r * cos(angle), r * sin(angle), r, angle)
  }

  /// Place accounts in their rings and slices.
  public static func place(_ points: [RadarPoint], _ sectorCount: Int) -> [PlacedPoint] {
    let slices = sectorAngles(sectorCount)
    return points.map { p in
      let ring = ringOf(p.band)
      let slice = slices[Swift.min(slices.count - 1, Swift.max(0, p.sector))]
      let (u, v) = spots(p.id)
      let s = spot(ring, slice, u, v)
      return PlacedPoint(
        id: p.id, band: p.band, sector: p.sector, row: p.row, ring: ring, x: s.x, y: s.y, r: s.r, angle: s.angle)
    }
  }

  /// The strangers, as texture: at most `max` small marks shared out
  /// between the sectors by how many strangers each holds. A sector with any
  /// gets at least one, so nothing that is there looks empty.
  public static func texture(_ counts: [Int], max: Int = 700) -> [TextureDot] {
    let total = counts.reduce(0, +)
    if total == 0 { return [] }
    let slices = sectorAngles(counts.count)
    let scale = JSMath.min(1, Double(max) / Double(total))
    var out: [TextureDot] = []
    for (sector, count) in counts.enumerated() {
      let n = count != 0 ? Swift.max(1, Int((Double(count) * scale).jsRounded)) : 0
      for i in 0..<Swift.max(0, n) {
        let (u, v) = spots("far:\(sector):\(i)")
        let s = spot(.outer, slices[sector], u, v)
        out.append(TextureDot(sector: sector, x: s.x, y: s.y, r: s.r, angle: s.angle))
      }
    }
    return out
  }

  /// The placed account nearest a point, within `within`, or nil. Of two
  /// at the same distance, the later.
  public static func nearest(_ placed: [PlacedPoint], _ x: Double, _ y: Double, _ within: Double) -> PlacedPoint? {
    var best: PlacedPoint?
    var bestD = within * within
    for p in placed {
      let d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)
      if d <= bestD {
        best = p
        bestD = d
      }
    }
    return best
  }

  /// The order the arrow keys walk the accounts in: ring by ring from the
  /// centre, and round each ring clockwise from the top.
  public static func walkOrder(_ placed: [PlacedPoint]) -> [PlacedPoint] {
    let rank: [Ring: Double] = [.protected: 0, .connected: 1, .peripheral: 2, .outer: 3]
    let turn = 2 * Double.pi
    func turned(_ p: PlacedPoint) -> Double {
      ((p.angle + Double.pi / 2).truncatingRemainder(dividingBy: turn) + turn).truncatingRemainder(dividingBy: turn)
    }
    return placed.jsSorted { a, b in
      let byRing = rank[a.ring]! - rank[b.ring]!
      return byRing != 0 ? byRing : turned(a) - turned(b)
    }
  }

  // MARK: A scan on the radar

  /// SCAN_SECTORS: the slices a scan is cut into, clockwise from the top,
  /// and the words for each. `other` is engagement from outside Bluesky's
  /// own kinds, and is only a slice when someone did that.
  public static let scanSectors: [ScanSector] = [
    ScanSector(key: "quote", name: "Quoted", verb: "quoted"),
    ScanSector(key: "reply", name: "Replied", verb: "replied in the thread"),
    ScanSector(key: "repost", name: "Reposted", verb: "reposted"),
    ScanSector(key: "like", name: "Liked", verb: "liked"),
    ScanSector(key: "other", name: "Other", verb: "linked to it from another app"),
  ]

  /// The slice a row's loudest engagement falls in.
  public static func sectorKey(_ kind: String?) -> String {
    guard let kind else { return "other" }
    for k in ["quote", "repost", "like"] where kind.jsEquals(k) { return k }
    if kind.jsEquals("reply") || kind.jsEquals("threadReply") { return "reply" }
    return "other"
  }

  /// A scan summary (score.js summarise) as the radar draws it: the slices,
  /// with how many engaged that way and how many of them are strangers, and
  /// a mark for everyone who isn't a stranger.
  public static func scanRadar(_ summary: ScanSummary?) -> ScanRadar {
    let rows = summary?.rows ?? []
    let keyed = rows.map { (row: $0, key: sectorKey($0.primary)) }
    let used = scanSectors.filter { s in s.key != "other" || keyed.contains { $0.key == "other" } }
    let index = Dictionary(uniqueKeysWithValues: used.enumerated().map { ($0.element.key, $0.offset) })
    let sectors = used.map { s in
      let mine = keyed.filter { $0.key == s.key }
      return RadarSector(
        key: s.key, name: s.name, verb: s.verb, total: mine.count, far: mine.filter { $0.row.band == .unknown }.count)
    }
    let points = keyed.filter { $0.row.band != .unknown }
      .map { RadarPoint(id: $0.row.did, band: $0.row.band, sector: index[$0.key]!, row: $0.row) }
    let byBand = Dictionary(uniqueKeysWithValues: Score.bands.map { band in (band, rows.filter { $0.band == band }.count) })
    return ScanRadar(sectors: sectors, points: points, byBand: byBand, total: rows.count)
  }

  /// The band × slice counts, for the radar's table.
  public static func radarTable(_ summary: ScanSummary?) -> [RadarTableRow] {
    let sectors = scanRadar(summary).sectors
    let rows = summary?.rows ?? []
    return Score.bands.map { band in
      RadarTableRow(
        band: band,
        cells: sectors.map { s in rows.filter { $0.band == band && sectorKey($0.primary) == s.key }.count },
        total: rows.filter { $0.band == band }.count)
    }
  }
}
