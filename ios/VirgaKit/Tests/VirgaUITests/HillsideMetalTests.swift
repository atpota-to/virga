// The hillside's Metal, on the simulator's GPU: the shaders compile from
// their source at run time (a mistake in them shows nowhere else before a
// device draws them), every pipeline is made, and a picture of the live
// sky's band and of the whole hill is drawn offscreen and read back: the
// band is the wash with the scene laid on it, the hill has sky above its
// crest and grass below. If the shaders don't compile, the reason is in
// the test's log after "[Virga hillside]".

#if canImport(UIKit)
import Metal
import VirgaCore
import XCTest

@testable import VirgaUI

final class HillsideMetalTests: XCTestCase {
  private func gpu() throws -> HillsideGPU {
    guard MTLCreateSystemDefaultDevice() != nil else { throw XCTSkip("no Metal device here") }
    return try XCTUnwrap(HillsideGPU.make(), "the hillside's GPU couldn't be made: see the log's [Virga hillside] line")
  }

  /// Draws `state` through a renderer into a texture `width` × `height`
  /// and reads it back as BGRA bytes.
  private func picture(
    _ gpu: HillsideGPU, _ renderer: HillsideCanvasRenderer, _ state: HillsideSceneState, width: Int, height: Int, depth: Bool
  ) throws -> [UInt8] {
    let device = gpu.device
    let colour = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: HillsideGPU.colorFormat, width: width, height: height, mipmapped: false)
    colour.usage = [.renderTarget, .shaderRead]
    colour.storageMode = .private
    let target = try XCTUnwrap(device.makeTexture(descriptor: colour))
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = target
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 1, green: 0, blue: 1, alpha: 1)
    if depth {
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: HillsideGPU.depthFormat, width: width, height: height, mipmapped: false)
      d.usage = .renderTarget
      d.storageMode = .private
      pass.depthAttachment.texture = try XCTUnwrap(device.makeTexture(descriptor: d))
      pass.depthAttachment.loadAction = .clear
      pass.depthAttachment.storeAction = .dontCare
      pass.depthAttachment.clearDepth = 1
    }
    let commands = try XCTUnwrap(gpu.queue.makeCommandBuffer())
    XCTAssertTrue(renderer.encode(state, into: pass, target: target, commands: commands), "the picture couldn't be encoded")
    let bytes = width * height * 4
    let readback = try XCTUnwrap(device.makeBuffer(length: bytes, options: .storageModeShared))
    let blit = try XCTUnwrap(commands.makeBlitCommandEncoder())
    blit.copy(
      from: target, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
      sourceSize: MTLSize(width: width, height: height, depth: 1), to: readback, destinationOffset: 0,
      destinationBytesPerRow: width * 4, destinationBytesPerImage: bytes)
    blit.endEncoding()
    commands.commit()
    commands.waitUntilCompleted()
    XCTAssertNil(commands.error, "the GPU failed: \(String(describing: commands.error))")
    let pointer = readback.contents().bindMemory(to: UInt8.self, capacity: bytes)
    return Array(UnsafeBufferPointer(start: pointer, count: bytes))
  }

  /// The pixel at x, y as (red, green, blue).
  private func pixel(_ bytes: [UInt8], width: Int, x: Int, y: Int) -> (r: Int, g: Int, b: Int) {
    let i = (y * width + x) * 4
    return (Int(bytes[i + 2]), Int(bytes[i + 1]), Int(bytes[i]))
  }

  func testTheLiveSkysBandIsTheWashWithTheSceneOnIt() throws {
    let gpu = try gpu()
    let width = 390
    let height = 420
    let canvas = HillsideStyle.liveSkyCanvas(width: Double(width))
    for phase in SkyPhase.allCases {
      var state = HillsideSceneState(HillsideSceneOptions(calm: false, phase: phase.rawValue, depth: 0.55, soft: false, devicePixelRatio: 1))
      state.resize(width: canvas.width, height: canvas.height, crest: canvas.crest)
      let renderer = HillsideCanvasRenderer(gpu: gpu, mode: .band)
      renderer.viewOffset = HillsideMatrix.ViewOffset(
        fullWidth: canvas.width, fullHeight: canvas.height, x: canvas.bleed, y: canvas.bleed, width: Double(width), height: Double(height))
      // a day's wash: light blue to white
      let wash = [
        HillsideBandUniforms.Stop(red: 0.725, green: 0.835, blue: 1, at: 0), HillsideBandUniforms.Stop(red: 0.882, green: 0.929, blue: 1, at: 0.4),
        HillsideBandUniforms.Stop(red: 1, green: 1, blue: 1, at: 1),
      ]
      renderer.band = HillsideBandUniforms.pack(wash: wash, maskMidAt: 0.4, night: phase == .night)
      let bytes = try picture(gpu, renderer, state, width: width, height: height, depth: false)
      // nothing left of the clear colour, and screen only ever lightens the wash
      for (x, y) in [(5, 2), (195, 100), (380, 300), (200, 419)] {
        let p = pixel(bytes, width: width, x: x, y: y)
        XCTAssertFalse(p.r == 255 && p.g == 0 && p.b == 255, "\(phase): (\(x), \(y)) wasn't drawn")
        XCTAssertGreaterThanOrEqual(p.b, 250, "\(phase): (\(x), \(y)) is darker than the wash: \(p)")
      }
      // the foot of the band is the page's ground
      let foot = pixel(bytes, width: width, x: 200, y: height - 1)
      XCTAssertGreaterThanOrEqual(foot.r, 250, "\(phase): the band's foot is \(foot)")
    }
  }

  func testTheHillHasSkyAboveItsCrestAndGrassBelow() throws {
    let gpu = try gpu()
    gpu.makeLand()
    XCTAssertNotNil(gpu.land, "the land's mesh wasn't made")
    let width = 300
    let height = 400
    var state = HillsideSceneState(HillsideSceneOptions(calm: true, phase: "day", depth: 1, soft: true, devicePixelRatio: 1))
    state.resize(width: Double(width), height: Double(height), crest: 0.5)
    let renderer = HillsideCanvasRenderer(gpu: gpu, mode: .hill)
    let bytes = try picture(gpu, renderer, state, width: width, height: height, depth: true)
    // most of the top is blue (a cloud's sunlit rim may not be), most of the foot green
    let top = [30, 90, 150, 210, 270].map { pixel(bytes, width: width, x: $0, y: 12) }
    XCTAssertGreaterThanOrEqual(top.filter { $0.b > $0.r }.count, 3, "the sky at the top is \(top)")
    let foot = [30, 90, 150, 210, 270].map { pixel(bytes, width: width, x: $0, y: 388) }
    XCTAssertGreaterThanOrEqual(foot.filter { $0.g > $0.b }.count, 3, "the grass at the foot is \(foot)")
    // and at night, with its stars, and at dawn, with the sun's disc
    for phase in ["night", "dawn"] {
      state.setPhase(phase, instant: true)
      state.frame(now: 1000)
      _ = try picture(gpu, renderer, state, width: width, height: height, depth: true)
    }
  }
}
#endif

#if canImport(UIKit)
/// The demo's -VirgaDemoSky and -VirgaDemoLiveSky, stored as the web's
/// preferences are, for the live sky's UI tests.
@MainActor
final class LiveSkyDemoPreferencesTests: XCTestCase {
  func testNoArgumentsStoreNothing() {
    XCTAssertNil(AppModel.demoPreferences(sky: nil, liveSky: false))
  }

  func testTheSkyAndTheLiveSkyAreStored() throws {
    let json = try XCTUnwrap(AppModel.demoPreferences(sky: "night", liveSky: true))
    let prefs = Preferences.readPreferences(raw: json)
    XCTAssertEqual(prefs.sky, .night)
    XCTAssertTrue(prefs.liveSky)
    XCTAssertEqual(Preferences.readPreferences(raw: AppModel.demoPreferences(sky: "noon", liveSky: true)).sky, .clock)
  }
}
#endif
