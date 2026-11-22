// Ports src/hillside/scene.js (its parity cases)
//
// scene.js's module-level constants and helpers, and createHillside run
// over a recording stand-in for WebGL through scripts of what a page does
// (resize, frames at given times, a change of sky, the pointer, the page
// out of view and back, the tab hidden, the intro, the drawing lost): each
// step's pictures drawn, the last picture's camera, light and clouds, the
// frame callbacks left waiting and the pixel ratio, against
// HillsideSceneState doing the same.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport

@Suite struct HillsideSceneParity {
  static func triple(_ c: HillsideColor) -> JSONValue { .array([.number(c.r), .number(c.g), .number(c.b)]) }
  static func triple(_ v: HillsideVector) -> JSONValue { .array([.number(v.x), .number(v.y), .number(v.z)]) }

  @Test func palettes() throws {
    let c = try Parity.cases("hillside.scene", fn: "palettes")[0]
    let written = c.output["palettes"]?.objectValue ?? [:]
    #expect(written.count == SkyPhase.allCases.count)
    for phase in SkyPhase.allCases {
      let p = HillsideScene.palette(phase)
      guard let web = written[phase.rawValue] else {
        Issue.record("no palette for \(phase)")
        continue
      }
      for key in HillsideColorKey.allCases {
        // The hex as written, and the colour as three reads it.
        let hex = web[key.rawValue]?.stringValue ?? ""
        #expect(HillsideColor(hex: hex) == p.color(key), "\(phase).\(key): \(hex)")
        let d = Parity.diff(Self.triple(p.color(key)), c.output["rgb"]?[phase.rawValue]?[key.rawValue] ?? .null)
        #expect(d == nil, "\(phase).\(key): \(d ?? "")")
      }
      let rest: JSONValue = ["sun": Self.triple(p.sun), "disc": .number(p.disc), "stars": .number(p.stars)]
      let expected: JSONValue = ["sun": web["sun"] ?? .null, "disc": web["disc"] ?? .null, "stars": web["stars"] ?? .null]
      let d = Parity.diff(rest, expected)
      #expect(d == nil, "\(phase): \(d ?? "")")
    }
  }

  @Test func constants() throws {
    let c = try Parity.cases("hillside.scene", fn: "constants")[0]
    let actual: JSONValue = [
      "TURN": .number(HillsideScene.turn), "DEG": .number(HillsideScene.deg),
      "COLOR_KEYS": .array(HillsideColorKey.allCases.map { .string($0.rawValue) }),
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(d ?? "")")
  }

  @Test func phaseOf() throws {
    for c in try Parity.cases("hillside.scene", fn: "phaseOf") {
      let d = Parity.diff(.string(HillsideScene.phaseOf(c["name"].stringValue).rawValue), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func easing() throws {
    for c in try Parity.cases("hillside.scene", fn: "easing") {
      let t = c["t"].doubleValue ?? 0
      let actual: JSONValue = [
        "smooth": .number(HillsideScene.smooth(t)), "easeOut": .number(HillsideScene.easeOut(t)),
        "clamp": .number(HillsideScene.clamp(t, 0, 1)), "lerp": .number(HillsideScene.lerp(-110, 30, t)),
      ]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  /// The batch's first `count` instances, an attribute at a time.
  static func sums(_ batch: HillsideCloudBatch) -> JSONValue {
    func sum(_ offset: Int, _ size: Int) -> Double {
      var s = 0.0
      for i in 0..<batch.count {
        for k in 0..<size { s += Double(batch.instances[i * HillsideCloudBatch.stride + offset + k]) }
      }
      return s
    }
    return ["pos": .number(sum(0, 3)), "rad": .number(sum(3, 1)), "data": .number(sum(4, 4)), "fx": .number(sum(8, 4)), "shape": .number(sum(12, 4))]
  }

  /// What the web's stand-in renderer records of a picture.
  static func picture(_ s: HillsideSceneState) -> JSONValue {
    let cam = s.camera
    let camera: JSONValue = [
      "position": triple(cam.position), "rotation": triple(cam.rotation), "fov": .number(cam.fov),
      "aspect": .number(cam.aspect), "view": .array(cam.matrixWorldInverse.elements.map { .number($0) }),
      "projection": .array(cam.projection().elements.map { .number($0) }),
    ]
    let sky: JSONValue = [
      "top": triple(s.color(.top)), "mid": triple(s.color(.mid)), "low": triple(s.color(.low)), "hor": triple(s.color(.hor)),
      "haze": triple(s.color(.haze)), "sunCol": triple(s.color(.sunCol)), "sunDir": triple(s.sunDir),
      "disc": .number(s.disc), "stars": .number(s.stars), "span": .number(s.span),
    ]
    let land: JSONValue = ["lit": triple(s.color(.lit)), "mid": triple(s.color(.mid2)), "shade": triple(s.color(.shade))]
    let clouds: JSONValue = [
      "lit": triple(s.color(.cloudLit)), "shadow": triple(s.color(.cloudShadow)), "rim": triple(s.color(.cloudRim)),
      "fog": triple(s.color(.cloudFog)), "billow": .number(s.calm ? 0 : 1), "sunView": triple(s.clouds.sunView),
      "count": .number(Double(s.clouds.count)), "sums": sums(s.clouds),
    ]
    return [
      "time": .number(s.clock), "windOff": .array([.number(s.windOff.x), .number(s.windOff.y)]), "camera": camera,
      "sky": sky, "land": land, "clouds": clouds,
    ]
  }

  @Test func createHillside() throws {
    for c in try Parity.cases("hillside.scene", fn: "createHillside") {
      let o = c["options"]
      var s = HillsideSceneState(
        HillsideSceneOptions(
          calm: o["calm"]?.boolValue ?? false, phase: o["phase"]?.stringValue, depth: o["depth"]?.doubleValue ?? 1,
          soft: o["soft"]?.boolValue ?? false, devicePixelRatio: o["devicePixelRatio"]?.doubleValue ?? 1))
      let steps = c.output.arrayValue ?? []
      let script = c["script"].arrayValue ?? []
      #expect(steps.count == script.count + 1, "\(c): \(steps.count) steps for \(script.count) in the script")
      // The first step is createHillside's own: the pixel ratio it sets.
      let opening = steps.first?["ratios"]?[0]?.doubleValue
      #expect(opening == s.ratio, "\(c): opens at \(s.ratio), not \(opening ?? -1)")
      for (index, op) in script.enumerated() where index + 1 < steps.count {
        let expected = steps[index + 1]
        let draws = s.drawCount
        let ratioChanges = s.ratioChanges
        let num = { (key: String) in op[key]?.doubleValue ?? 0 }
        switch op["op"]?.stringValue ?? "" {
        case "resize": s.resize(width: num("w"), height: num("h"), crest: num("crest"))
        case "frames":
          for i in 0..<(op["count"]?.intValue ?? 0) { s.frame(now: num("start") + Double(i) * num("step")) }
        case "phase": s.setPhase(op["name"]?.stringValue, instant: op["instant"]?.boolValue ?? false)
        case "active": s.setActive(op["on"]?.boolValue ?? false)
        case "shown": s.setShown(op["on"]?.boolValue ?? false)
        case "pointer":
          s.pointerMoved(type: op["type"]?.stringValue ?? "", x: num("x"), y: num("y"), width: num("width"), height: num("height"))
        case "intro": s.intro()
        case "lost": s.contextLost()
        case "dispose": s.dispose()
        default: Issue.record("\(c): unknown step \(op)")
        }
        let label = "\(c) step \(index) (\(op["op"]?.stringValue ?? ""))"
        let drawn = s.drawCount - draws
        #expect(Double(drawn) == expected["draws"]?.doubleValue, "\(label): \(drawn) pictures, not \(expected["draws"] ?? .null)")
        let queued = (s.tickQueued ? 1 : 0) + (s.stillQueued ? 1 : 0)
        #expect(Double(queued) == expected["queued"]?.doubleValue, "\(label): \(queued) callbacks waiting")
        let ratios = expected["ratios"]?.arrayValue ?? []
        #expect(s.ratioChanges - ratioChanges == ratios.count, "\(label): the ratio changed \(s.ratioChanges - ratioChanges) times")
        if let last = ratios.last?.doubleValue {
          #expect(Parity.diff(.number(s.ratio), .number(last)) == nil, "\(label): ratio \(s.ratio), not \(last)")
        }
        #expect((s.drawCount > 0) == (expected["ready"]?.boolValue ?? false), "\(label): ready")
        #expect(s.isLost == (expected["lost"]?.boolValue ?? false), "\(label): lost")
        if drawn > 0, let web = expected["picture"] {
          let d = Parity.diff(Self.picture(s), web)
          #expect(d == nil, "\(label): \(d ?? "")")
        }
      }
    }
  }
}
