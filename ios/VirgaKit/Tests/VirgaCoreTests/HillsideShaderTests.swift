// The shaders' structs against the Swift side's packing: Metal reads the
// uniforms as the struct declares them, so the packing must lay the same
// members out in the same order (every member a float4, a float4x4 or an
// array of float4, so there is no padding to get wrong). Metal itself only
// compiles the source on an Apple device or simulator; VirgaUITests'
// HillsideMetalTests does that in CI.

import Foundation
import Testing
import VirgaCore

@Suite struct HillsideShaderLayout {
  /// The members of `struct name { … };` in the shader source, with the floats each takes.
  static func members(of name: String) -> [(name: String, floats: Int)] {
    let source = HillsideShaders.source
    guard let start = source.range(of: "struct \(name) {"), let end = source.range(of: "};", range: start.upperBound..<source.endIndex)
    else { return [] }
    let body = source[start.upperBound..<end.lowerBound]
    var out: [(String, Int)] = []
    for line in body.split(separator: "\n") {
      let parts = line.trimmingCharacters(in: .whitespaces).dropLast().split(separator: " ")
      guard parts.count == 2 else { continue }
      let type = String(parts[0])
      var member = String(parts[1])
      var count = 1
      if let open = member.firstIndex(of: "["), let close = member.firstIndex(of: "]") {
        count = Int(member[member.index(after: open)..<close]) ?? 1
        member = String(member[..<open])
      }
      let floats = type == "float4x4" ? 16 : type == "float4" ? 4 : 0
      out.append((member, floats * count))
    }
    return out
  }

  @Test func theUniformsAreTheStructsMembers() {
    let declared = Self.members(of: "HillUniforms")
    #expect(declared.map(\.name) == HillsideUniforms.fields.map(\.name))
    #expect(declared.map(\.floats) == HillsideUniforms.fields.map(\.floats))
    #expect(!declared.contains { $0.floats == 0 }, "a member that isn't a float4 or float4x4")
  }

  @Test func theBandIsTheStructsMembers() {
    let declared = Self.members(of: "HillBand")
    #expect(declared.map(\.name) == HillsideBandUniforms.fields.map(\.name))
    #expect(declared.map(\.floats) == HillsideBandUniforms.fields.map(\.floats))
  }

  @Test func packingFillsEveryMember() {
    var state = HillsideSceneState(HillsideSceneOptions(calm: false, phase: "dusk", depth: 0.55, soft: false, devicePixelRatio: 3))
    state.resize(width: 420, height: 1130, crest: 0.95)
    let packed = HillsideUniforms.pack(state, projection: state.camera.projection(depth: .metal))
    #expect(packed.count == HillsideUniforms.floatCount)
    #expect(HillsideUniforms.floatCount == 116)
    // params: time, disc, span, stars, at their place after the matrices and eighteen float4s
    let params = 32 + 4 * 18
    #expect(packed[params + 2] == Float(state.span))
    #expect(packed[params + 1] == Float(state.disc))
    let stops = [
      HillsideBandUniforms.Stop(red: 0.7, green: 0.8, blue: 1, at: 0), HillsideBandUniforms.Stop(red: 0.9, green: 0.9, blue: 1, at: 0.43),
      HillsideBandUniforms.Stop(red: 1, green: 1, blue: 1, at: 1),
    ]
    let band = HillsideBandUniforms.pack(wash: stops, maskMidAt: 0.43, night: true)
    #expect(band.count == HillsideBandUniforms.floatCount)
    // the mask's count of stops, and the dark theme's opacity
    #expect(band[16 + 4 + 3] == 3)
    #expect(band[16 + 12 + 2] == Float(0.45))
  }

  @Test func everyFunctionTheRendererAsksFor() {
    for name in [
      "hill_sky_vertex", "hill_sky_fragment", "hill_land_vertex", "hill_land_fragment", "hill_puff_vertex", "hill_puff_fragment",
      "hill_band_vertex", "hill_band_fragment",
    ] {
      #expect(HillsideShaders.source.contains(" \(name)("), "no \(name)")
    }
  }
}
