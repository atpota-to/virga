// Ports src/hillside/scene.js (the renderer: the sky, the land and the clouds, in that order)
// Ports src/hillside/land.js (createLand's mesh, uploaded)
// Ports src/hillside/clouds.js (makeNoise's texture and the batch, uploaded)
//
// The hillside in Metal. HillsideGPU is made once for the app, off the main
// thread: the device, the shaders compiled from VirgaCore's
// HillsideShaders.source at run time, makeNoise's bytes as a mipmapped
// texture (one channel: the web's r, g and b are the same), the sky's dome
// and, the first time a hill is drawn, the land's mesh (two floats short of
// 1.5 MB with 16-bit indices; the live sky never asks for it, since its
// band never reaches the hill). Without a device, or when the shaders
// don't compile, it is nil, the reason goes to the log with the prefix
// "[Virga hillside]", and the flat picture stays.
//
// HillsideCanvasRenderer draws one view's picture of the scene's state, in
// three.js's order: the sky's dome with no depth test, the land (a hill's
// view only), then the clouds' puffs back to front, blended
// premultiplied, tested against the land but not writing depth. A hill's
// view draws straight into its drawable; the live sky's band draws the
// scene into a texture of its own and then lays it on the page's wash
// (the band pass in the shaders). Each view has one picture in flight at
// most, so one buffer of puffs and two drawables are enough (the screen
// shows one while the next is drawn, and nothing waits for a drawable);
// a picture that comes while the last is still on the GPU is skipped,
// never waited for.

#if canImport(UIKit)
import Foundation
import Metal
import MetalKit
import QuartzCore
import VirgaCore

/// Why the hillside isn't drawn, said where the device's console and CI's
/// log can show it.
enum HillsideLog {
  static func say(_ text: String) {
    NSLog("[Virga hillside] %@", text)
  }
}

final class HillsideGPU: @unchecked Sendable {
  static let colorFormat = MTLPixelFormat.bgra8Unorm
  static let depthFormat = MTLPixelFormat.depth32Float
  static let noiseSize = 256

  struct Mesh {
    let vertices: MTLBuffer
    let indices: MTLBuffer
    let count: Int
  }

  let device: MTLDevice
  let queue: MTLCommandQueue
  let noise: MTLTexture
  let sampler: MTLSamplerState
  let sky: Mesh
  /// The sky and the puffs, into a colour target alone (the band's scene)
  /// or beside the depth the land writes (a hill's view).
  let skyPipeline: MTLRenderPipelineState
  let skyDepthPipeline: MTLRenderPipelineState
  let landPipeline: MTLRenderPipelineState
  let puffPipeline: MTLRenderPipelineState
  let puffDepthPipeline: MTLRenderPipelineState
  let bandPipeline: MTLRenderPipelineState
  let skyDepth: MTLDepthStencilState
  let landDepth: MTLDepthStencilState
  let puffDepth: MTLDepthStencilState

  private let landLock = NSLock()
  private var landMesh: Mesh?

  private init(
    device: MTLDevice, queue: MTLCommandQueue, noise: MTLTexture, sampler: MTLSamplerState, sky: Mesh,
    pipelines: [MTLRenderPipelineState], depths: [MTLDepthStencilState]
  ) {
    self.device = device
    self.queue = queue
    self.noise = noise
    self.sampler = sampler
    self.sky = sky
    skyPipeline = pipelines[0]
    skyDepthPipeline = pipelines[1]
    landPipeline = pipelines[2]
    puffPipeline = pipelines[3]
    puffDepthPipeline = pipelines[4]
    bandPipeline = pipelines[5]
    skyDepth = depths[0]
    landDepth = depths[1]
    puffDepth = depths[2]
  }

  /// The land's mesh, once it has been made.
  var land: Mesh? {
    landLock.lock()
    defer { landLock.unlock() }
    return landMesh
  }

  /// Makes the land's mesh (slow: call off the main thread).
  func makeLand() {
    if land != nil { return }
    let mesh = HillsideLand.mesh()
    var interleaved = [Float](repeating: 0, count: mesh.vertexCount * 6)
    for v in 0..<mesh.vertexCount {
      for k in 0..<3 {
        interleaved[v * 6 + k] = mesh.positions[v * 3 + k]
        interleaved[v * 6 + 3 + k] = mesh.normals[v * 3 + k]
      }
    }
    let indices = mesh.indices.map { UInt16(truncatingIfNeeded: $0) }
    guard
      let vertices = interleaved.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }),
      let indexBuffer = indices.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) })
    else {
      HillsideLog.say("the land's buffers couldn't be made")
      return
    }
    landLock.lock()
    landMesh = Mesh(vertices: vertices, indices: indexBuffer, count: indices.count)
    landLock.unlock()
  }

  /// The device, the shaders, the noise and the sky, or nil (and why, in the log).
  static func make() -> HillsideGPU? {
    guard let device = MTLCreateSystemDefaultDevice() else {
      HillsideLog.say("no Metal device: the flat picture stands in")
      return nil
    }
    guard let queue = device.makeCommandQueue() else {
      HillsideLog.say("no command queue: the flat picture stands in")
      return nil
    }
    let library: MTLLibrary
    do {
      library = try device.makeLibrary(source: HillsideShaders.source, options: MTLCompileOptions())
    } catch {
      HillsideLog.say("the shaders didn't compile: \(error)")
      return nil
    }
    func function(_ name: String) -> MTLFunction? {
      let found = library.makeFunction(name: name)
      if found == nil { HillsideLog.say("the shaders have no \(name)") }
      return found
    }
    guard let skyVertex = function("hill_sky_vertex"), let skyFragment = function("hill_sky_fragment"),
      let landVertex = function("hill_land_vertex"), let landFragment = function("hill_land_fragment"),
      let puffVertex = function("hill_puff_vertex"), let puffFragment = function("hill_puff_fragment"),
      let bandVertex = function("hill_band_vertex"), let bandFragment = function("hill_band_fragment")
    else { return nil }

    func pipeline(_ label: String, _ vertex: MTLFunction, _ fragment: MTLFunction, depth: Bool, blended: Bool) -> MTLRenderPipelineState? {
      let d = MTLRenderPipelineDescriptor()
      d.label = label
      d.vertexFunction = vertex
      d.fragmentFunction = fragment
      d.colorAttachments[0].pixelFormat = colorFormat
      if blended {
        // premultiplied: ONE, ONE_MINUS_SRC_ALPHA for colour and alpha
        let c = d.colorAttachments[0]!
        c.isBlendingEnabled = true
        c.rgbBlendOperation = .add
        c.alphaBlendOperation = .add
        c.sourceRGBBlendFactor = .one
        c.destinationRGBBlendFactor = .oneMinusSourceAlpha
        c.sourceAlphaBlendFactor = .one
        c.destinationAlphaBlendFactor = .oneMinusSourceAlpha
      }
      d.depthAttachmentPixelFormat = depth ? depthFormat : .invalid
      do {
        return try device.makeRenderPipelineState(descriptor: d)
      } catch {
        HillsideLog.say("the \(label) pipeline couldn't be made: \(error)")
        return nil
      }
    }
    guard let sky = pipeline("sky", skyVertex, skyFragment, depth: false, blended: false),
      let skyDepth = pipeline("sky beside the land", skyVertex, skyFragment, depth: true, blended: false),
      let land = pipeline("land", landVertex, landFragment, depth: true, blended: false),
      let puffs = pipeline("puffs", puffVertex, puffFragment, depth: false, blended: true),
      let puffsDepth = pipeline("puffs over the land", puffVertex, puffFragment, depth: true, blended: true),
      let band = pipeline("band", bandVertex, bandFragment, depth: false, blended: false)
    else { return nil }

    func depthState(_ compare: MTLCompareFunction, writes: Bool) -> MTLDepthStencilState? {
      let d = MTLDepthStencilDescriptor()
      d.depthCompareFunction = compare
      d.isDepthWriteEnabled = writes
      return device.makeDepthStencilState(descriptor: d)
    }
    guard let skyTest = depthState(.always, writes: false), let landTest = depthState(.lessEqual, writes: true),
      let puffTest = depthState(.lessEqual, writes: false)
    else {
      HillsideLog.say("the depth tests couldn't be made")
      return nil
    }

    guard let noise = makeNoiseTexture(device: device, queue: queue) else {
      HillsideLog.say("the noise texture couldn't be made")
      return nil
    }
    let s = MTLSamplerDescriptor()
    s.sAddressMode = .repeat
    s.tAddressMode = .repeat
    s.minFilter = .linear
    s.magFilter = .linear
    s.mipFilter = .linear
    s.maxAnisotropy = 4
    guard let sampler = device.makeSamplerState(descriptor: s) else {
      HillsideLog.say("the noise's sampler couldn't be made")
      return nil
    }

    let dome = HillsideScene.skySphere()
    let domeIndices = dome.indices.map { UInt16(truncatingIfNeeded: $0) }
    guard
      let domeVertices = dome.positions.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }),
      let domeIndexBuffer = domeIndices.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) })
    else {
      HillsideLog.say("the sky's buffers couldn't be made")
      return nil
    }
    return HillsideGPU(
      device: device, queue: queue, noise: noise, sampler: sampler,
      sky: Mesh(vertices: domeVertices, indices: domeIndexBuffer, count: domeIndices.count),
      pipelines: [sky, skyDepth, land, puffs, puffsDepth, band], depths: [skyTest, landTest, puffTest])
  }

  /// makeNoise(256)'s red channel as a private, mipmapped texture, copied
  /// in through a buffer (the Simulator wants textures private).
  private static func makeNoiseTexture(device: MTLDevice, queue: MTLCommandQueue) -> MTLTexture? {
    let size = noiseSize
    let rgba = HillsideClouds.makeNoise(size)
    var gray = [UInt8](repeating: 0, count: size * size)
    for i in 0..<(size * size) { gray[i] = rgba[i * 4] }
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm, width: size, height: size, mipmapped: true)
    // (render target too: some GPUs make mipmaps by drawing them)
    d.usage = [.shaderRead, .renderTarget]
    d.storageMode = .private
    guard let texture = device.makeTexture(descriptor: d),
      let staging = gray.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }),
      let commands = queue.makeCommandBuffer(), let blit = commands.makeBlitCommandEncoder()
    else { return nil }
    blit.copy(
      from: staging, sourceOffset: 0, sourceBytesPerRow: size, sourceBytesPerImage: size * size,
      sourceSize: MTLSize(width: size, height: size, depth: 1), to: texture, destinationSlice: 0, destinationLevel: 0,
      destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
    blit.generateMipmaps(for: texture)
    blit.endEncoding()
    commands.commit()
    commands.waitUntilCompleted()
    return texture
  }
}

/// The app's one HillsideGPU, made off the main thread the first time a
/// hillside asks, and the land's mesh the first time a hill does.
@MainActor
enum HillsideGPULoader {
  private static var finished = false
  private static var gpu: HillsideGPU?
  private static var waiting: [(HillsideGPU?) -> Void] = []
  private static var landWaiting: [() -> Void] = []

  static func load(_ then: @escaping (HillsideGPU?) -> Void) {
    if finished {
      then(gpu)
      return
    }
    waiting.append(then)
    guard waiting.count == 1 else { return }
    DispatchQueue.global(qos: .userInitiated).async {
      let made = HillsideGPU.make()
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          finished = true
          gpu = made
          let all = waiting
          waiting = []
          for each in all { each(made) }
        }
      }
    }
  }

  static func loadLand(_ gpu: HillsideGPU, _ then: @escaping () -> Void) {
    if gpu.land != nil {
      then()
      return
    }
    landWaiting.append(then)
    guard landWaiting.count == 1 else { return }
    DispatchQueue.global(qos: .userInitiated).async {
      gpu.makeLand()
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          let all = landWaiting
          landWaiting = []
          for each in all { each() }
        }
      }
    }
  }
}

/// One view's drawing of the scene.
final class HillsideCanvasRenderer: NSObject, MTKViewDelegate {
  enum Mode: Equatable {
    /// The whole scene, the land too, straight into the view.
    case hill
    /// The sky and clouds of the part of the scene the band shows, laid on
    /// the page's wash.
    case band
  }

  let gpu: HillsideGPU
  let mode: Mode
  /// What to draw: the scene as it stands.
  var state: HillsideSceneState?
  /// The part of the scene's frame this view shows (the band's), or nil for all of it.
  var viewOffset: HillsideMatrix.ViewOffset?
  /// The band's wash and mask (HillsideBandUniforms).
  var band: [Float] = []
  /// Whether a picture has been sent to the screen.
  private(set) var hasDrawn = false

  private var puffs: MTLBuffer?
  private let inFlight = DispatchSemaphore(value: 1)
  private var sceneTexture: MTLTexture?

  init(gpu: HillsideGPU, mode: Mode) {
    self.gpu = gpu
    self.mode = mode
    super.init()
  }

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  /// Out of a window: the band's scene goes, and the next picture is drawn
  /// afresh when it is back.
  func letGo() {
    sceneTexture = nil
    hasDrawn = false
  }

  func draw(in view: MTKView) {
    guard let state, state.drawCount > 0 else { return }
    guard inFlight.wait(timeout: .now()) == .success else { return }
    var committed = false
    defer { if !committed { inFlight.signal() } }
    guard let pass = view.currentRenderPassDescriptor, let drawable = view.currentDrawable,
      let commands = gpu.queue.makeCommandBuffer(), encode(state, into: pass, target: drawable.texture, commands: commands)
    else { return }
    let semaphore = inFlight
    commands.addCompletedHandler { @Sendable _ in semaphore.signal() }
    commands.present(drawable)
    commands.commit()
    committed = true
    hasDrawn = true
  }

  /// Encodes a picture of `state` into `pass`, whose colour target is
  /// `target` (and, for a hill, whose depth target is set). False when it
  /// can't be drawn yet (no land, no band, nothing made).
  func encode(_ state: HillsideSceneState, into pass: MTLRenderPassDescriptor, target: MTLTexture, commands: MTLCommandBuffer) -> Bool {
    if mode == .band && band.count != HillsideBandUniforms.floatCount { return false }
    guard let puffs = puffBuffer(for: state) else { return false }
    let uniforms = HillsideUniforms.pack(state, projection: state.camera.projection(depth: .metal, viewOffset: viewOffset))
    switch mode {
    case .hill:
      guard let land = gpu.land, let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return false }
      encodeScene(encoder, uniforms: uniforms, puffs: puffs, count: state.clouds.count, land: land)
      encoder.endEncoding()
    case .band:
      guard let scene = sceneTexture(width: target.width, height: target.height) else { return false }
      let scenePass = MTLRenderPassDescriptor()
      scenePass.colorAttachments[0].texture = scene
      scenePass.colorAttachments[0].loadAction = .clear
      scenePass.colorAttachments[0].storeAction = .store
      scenePass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
      guard let sceneEncoder = commands.makeRenderCommandEncoder(descriptor: scenePass) else { return false }
      encodeScene(sceneEncoder, uniforms: uniforms, puffs: puffs, count: state.clouds.count, land: nil)
      sceneEncoder.endEncoding()
      guard let bandEncoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return false }
      bandEncoder.setRenderPipelineState(gpu.bandPipeline)
      band.withUnsafeBytes { bandEncoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0) }
      bandEncoder.setFragmentTexture(scene, index: 0)
      bandEncoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      bandEncoder.endEncoding()
    }
    return true
  }

  /// The view's buffer of puffs, filled with the batch.
  private func puffBuffer(for state: HillsideSceneState) -> MTLBuffer? {
    let length = max(1, state.clouds.capacity) * HillsideCloudBatch.stride * MemoryLayout<Float>.stride
    if puffs == nil || (puffs?.length ?? 0) < length {
      puffs = gpu.device.makeBuffer(length: length, options: .storageModeShared)
    }
    guard let buffer = puffs else { return nil }
    let floats = min(state.clouds.count * HillsideCloudBatch.stride, state.clouds.instances.count)
    state.clouds.instances.withUnsafeBytes { raw in
      if let base = raw.baseAddress, floats > 0 {
        buffer.contents().copyMemory(from: base, byteCount: min(floats * MemoryLayout<Float>.stride, buffer.length))
      }
    }
    return buffer
  }

  /// The band's scene, as big as its drawable.
  private func sceneTexture(width: Int, height: Int) -> MTLTexture? {
    if let sceneTexture, sceneTexture.width == width, sceneTexture.height == height { return sceneTexture }
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: HillsideGPU.colorFormat, width: width, height: height, mipmapped: false)
    d.usage = [.renderTarget, .shaderRead]
    d.storageMode = .private
    sceneTexture = gpu.device.makeTexture(descriptor: d)
    return sceneTexture
  }

  private func encodeScene(_ encoder: MTLRenderCommandEncoder, uniforms: [Float], puffs: MTLBuffer, count: Int, land: HillsideGPU.Mesh?) {
    let depth = land != nil
    uniforms.withUnsafeBytes { raw in
      encoder.setVertexBytes(raw.baseAddress!, length: raw.count, index: 1)
      encoder.setFragmentBytes(raw.baseAddress!, length: raw.count, index: 1)
    }
    encoder.setFragmentTexture(gpu.noise, index: 0)
    encoder.setFragmentSamplerState(gpu.sampler, index: 0)
    encoder.setCullMode(.none)
    // the sky's dome, behind everything
    encoder.setRenderPipelineState(depth ? gpu.skyDepthPipeline : gpu.skyPipeline)
    if depth { encoder.setDepthStencilState(gpu.skyDepth) }
    encoder.setVertexBuffer(gpu.sky.vertices, offset: 0, index: 0)
    encoder.drawIndexedPrimitives(
      type: .triangle, indexCount: gpu.sky.count, indexType: .uint16, indexBuffer: gpu.sky.indices, indexBufferOffset: 0)
    // the land
    if let land {
      encoder.setRenderPipelineState(gpu.landPipeline)
      encoder.setDepthStencilState(gpu.landDepth)
      encoder.setVertexBuffer(land.vertices, offset: 0, index: 0)
      encoder.drawIndexedPrimitives(type: .triangle, indexCount: land.count, indexType: .uint16, indexBuffer: land.indices, indexBufferOffset: 0)
    }
    // the clouds, back to front
    guard count > 0 else { return }
    encoder.setRenderPipelineState(depth ? gpu.puffDepthPipeline : gpu.puffPipeline)
    if depth { encoder.setDepthStencilState(gpu.puffDepth) }
    encoder.setVertexBuffer(puffs, offset: 0, index: 0)
    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: count)
  }
}
#endif
