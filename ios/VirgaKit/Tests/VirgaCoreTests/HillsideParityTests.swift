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
