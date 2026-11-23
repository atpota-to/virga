// Ports src/hillside/clouds.js and src/hillside/land.js (their parity cases)

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport

@Suite struct HillsideCloudsParity {
  @Test func mulberry() throws {
    for c in try Parity.cases("hillside.clouds", fn: "mulberry") {
      var r = HillsideRandom(seed: c["seed"].doubleValue ?? 0)
      let actual = JSONValue.array((0..<12).map { _ in .number(r.next()) })
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func makeNoise() throws {
    for c in try Parity.cases("hillside.clouds", fn: "makeNoise") {
      let size = c["size"].intValue ?? 0
      let data = HillsideClouds.makeNoise(size, seed: c["seed"].doubleValue ?? 7)
      let gray = (0..<(size * size)).map { JSONValue.number(Double(data[$0 * 4])) }
      let actual: JSONValue = [
        "gray": .array(gray), "extra": .array([data[1], data[2], data[3]].map { .number(Double($0)) }),
      ]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
    for c in try Parity.cases("hillside.clouds", fn: "makeNoiseSampled") {
      let size = c["size"].intValue ?? 0
      let step = c["step"].intValue ?? 1
      let data = HillsideClouds.makeNoise(size, seed: c["seed"].doubleValue ?? 7)
      var sample: [JSONValue] = []
      var sum = 0.0
      for i in 0..<(size * size) {
        sum += Double(data[i * 4])
        if i % step == 0 { sample.append(.number(Double(data[i * 4]))) }
      }
      let actual: JSONValue = ["sample": .array(sample), "sum": .number(sum)]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }
}

@Suite struct HillsideLandParity {
  @Test func height() throws {
    for c in try Parity.cases("hillside.land", fn: "height") {
      let actual = HillsideLand.height(c["x"].doubleValue ?? 0, c["z"].doubleValue ?? 0)
      let d = Parity.diff(.number(actual), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func mesh() throws {
    let c = try Parity.cases("hillside.land", fn: "mesh")[0]
    let mesh = HillsideLand.mesh()
    func floats(_ list: [Float], _ v: Int) -> JSONValue {
      .array((0..<3).map { JSONValue.number(Double(list[v * 3 + $0])) })
    }
    let vertices: [JSONValue] = (c.output["vertices"]?.arrayValue ?? []).map { entry in
      let v = entry["v"]?.intValue ?? 0
      return ["v": .number(Double(v)), "position": floats(mesh.positions, v), "normal": floats(mesh.normals, v)]
    }
    let triangles: [JSONValue] = [0, 1, 319, 320, 9000, 60000, 60479].map { t in
      .array((0..<3).map { JSONValue.number(Double(mesh.indices[t * 3 + $0])) })
    }
    let actual: JSONValue = [
      "vertexCount": .number(Double(mesh.vertexCount)), "indexCount": .number(Double(mesh.indices.count)),
      "vertices": .array(vertices), "triangles": .array(triangles),
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(d ?? "")")
  }
}

/// clouds.js's cloud kinds, generators, makeCloud and layout, and the batch.
@Suite struct HillsideCloudKindsParity {
  static func kind(_ value: JSONValue?) -> HillsideCloudKind {
    HillsideCloudKind(rawValue: value?.stringValue ?? "") ?? .cumulus
  }

  static func params(_ value: JSONValue?) -> HillsideCloudParams {
    HillsideCloudParams(
      size: value?["size"]?.doubleValue ?? 0, height: value?["height"]?.doubleValue ?? 0,
      fluff: value?["fluff"]?.doubleValue ?? 0, count: value?["count"]?.doubleValue ?? 0)
  }

  static func vector(_ value: JSONValue?) -> HillsideVector {
    let a = value?.arrayValue ?? []
    return HillsideVector(a.first?.doubleValue ?? 0, a.count > 1 ? a[1].doubleValue ?? 0 : 0, a.count > 2 ? a[2].doubleValue ?? 0 : 0)
  }

  /// One puff's fields, as the web's object has them (a field it lacks, absent).
  typealias Fields = [(String, Double?)]

  static func fields(_ p: HillsideRawPuff) -> Fields {
    [("x", p.x), ("y", p.y), ("z", p.z), ("r", p.r), ("sh", p.sh), ("st", p.st), ("ax", p.ax), ("ay", p.ay), ("az", p.az), ("seed", nil)]
  }

  static func fields(_ p: HillsidePuff) -> Fields {
    [("x", p.x), ("y", p.y), ("z", p.z), ("r", p.r), ("sh", p.sh), ("st", p.st), ("ax", p.ax), ("ay", p.ay), ("az", p.az), ("seed", p.seed)]
  }

  /// The generator's `heap(puffs, every)`.
  static func heap(_ puffs: [Fields], every: Int) -> JSONValue {
    var sums: [String: JSONValue] = [:]
    var missing: [String: JSONValue] = [:]
    let names = ["x", "y", "z", "r", "sh", "st", "ax", "ay", "az", "seed"]
    for (index, name) in names.enumerated() {
      var sum = 0.0
      var absent = 0.0
      for p in puffs {
        if let v = p[index].1 { sum += v } else { absent += 1 }
      }
      sums[name] = .number(sum)
      missing[name] = .number(absent)
    }
    var sample: [JSONValue] = []
    for (i, p) in puffs.enumerated() where i % every == 0 || i == puffs.count - 1 {
      var row: [String: JSONValue] = ["i": .number(Double(i))]
      for (name, v) in p { if let v { row[name] = .number(v) } }
      sample.append(.object(row))
    }
    return ["count": .number(Double(puffs.count)), "sums": .object(sums), "missing": .object(missing), "sample": .array(sample)]
  }

  static func cloud(_ c: HillsideCloud, every: Int) -> JSONValue {
    [
      "kind": .string(c.kind.rawValue), "size": .number(c.size), "rotY": .number(c.rotY),
      "pos": .array([.number(c.pos.x), .number(c.pos.y), .number(c.pos.z)]), "top": .number(c.top),
      "alpha": .number(c.alpha), "ero": .number(c.ero), "puffs": heap(c.puffs.map(fields), every: every),
    ]
  }

  @Test func types() throws {
    let c = try Parity.cases("hillside.clouds", fn: "types")[0]
    for kind in HillsideCloudKind.allCases {
      let t = kind.traits
      let actual: JSONValue = ["base": .number(t.base), "alpha": .number(t.alpha), "ero": .number(t.ero), "drift": .number(t.drift)]
      let d = Parity.diff(actual, c.output[kind.rawValue] ?? .null)
      #expect(d == nil, "\(kind): \(d ?? "")")
    }
    #expect(c.output.objectValue?.count == HillsideCloudKind.allCases.count)
  }

  @Test func generators() throws {
    for c in try Parity.cases("hillside.clouds", fn: "gen") {
      let puffs = HillsideClouds.generate(Self.kind(c["kind"]), seed: c["seed"].doubleValue ?? 0, Self.params(c["P"]))
      let d = Parity.diff(Self.heap(puffs.map(Self.fields), every: 9), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func makeCloud() throws {
    for c in try Parity.cases("hillside.clouds", fn: "makeCloud") {
      let made = HillsideClouds.makeCloud(
        Self.kind(c["kind"]), seed: c["seed"].doubleValue ?? 0, Self.params(c["P"]), pos: Self.vector(c["pos"]),
        rotY: c["rotY"].doubleValue ?? 0)
      let d = Parity.diff(Self.cloud(made, every: 11), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func layout() throws {
    for c in try Parity.cases("hillside.clouds", fn: "layout") {
      let clouds = HillsideClouds.layout(c["seed"].doubleValue ?? 0)
      let d = Parity.diff(.array(clouds.map { Self.cloud($0, every: 1000) }), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  /// The batch's instances in the web's attributes: aPos (3), aRad (1), aData, aFx and aShape (4 each).
  static let attributes: [(offset: Int, size: Int)] = [(0, 3), (3, 1), (4, 4), (8, 4), (12, 4)]

  static func attribute(_ batch: HillsideCloudBatch, _ a: Int, _ i: Int) -> [JSONValue] {
    let (offset, size) = attributes[a]
    return (0..<size).map { .number(Double(batch.instances[i * HillsideCloudBatch.stride + offset + $0])) }
  }

  /// Every attribute of the first `count` instances summed, an attribute at a time, as the generator sums them.
  static func sum(_ batch: HillsideCloudBatch) -> Double {
    var sum = 0.0
    for (offset, size) in attributes {
      for i in 0..<batch.count {
        for k in 0..<size { sum += Double(batch.instances[i * HillsideCloudBatch.stride + offset + k]) }
      }
    }
    return sum
  }

  @Test func update() throws {
    for c in try Parity.cases("hillside.clouds", fn: "update") {
      var camera = HillsideCamera()
      camera.place(
        Self.vector(c["camera"]["position"]), pitch: c["camera"]["pitch"]?.doubleValue ?? 0,
        yaw: c["camera"]["yaw"]?.doubleValue ?? 0)
      let sun = Self.vector(c["sun"])
      var batch = HillsideCloudBatch()
      let steps = c["steps"].arrayValue ?? []
      let expected = c.output.arrayValue ?? []
      #expect(steps.count == expected.count)
      for (index, step) in steps.enumerated() where index < expected.count {
        batch.update(dt: step["dt"]?.doubleValue ?? 0, wind: step["wind"]?.doubleValue ?? 0, camera: camera, sunDir: sun)
        var rows: [JSONValue] = []
        for i in stride(from: 0, to: batch.count, by: 97) {
          rows.append([
            "i": .number(Double(i)), "pos": .array(Self.attribute(batch, 0, i)), "rad": Self.attribute(batch, 1, i)[0],
            "data": .array(Self.attribute(batch, 2, i)), "fx": .array(Self.attribute(batch, 3, i)),
            "shape": .array(Self.attribute(batch, 4, i)),
          ])
        }
        let actual: JSONValue = [
          "count": .number(Double(batch.count)),
          "sunView": .array([.number(batch.sunView.x), .number(batch.sunView.y), .number(batch.sunView.z)]),
          "sum": .number(Self.sum(batch)), "rows": .array(rows),
        ]
        let d = Parity.diff(actual, expected[index])
        #expect(d == nil, "\(c) step \(index): \(d ?? "")")
      }
    }
  }
}
