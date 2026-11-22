// Ports src/hillside/Hillside.jsx (the canvas)
//
// The canvas a hillside is drawn on: an MTKView that draws only when told
// (its driver says when the scene has a new picture), at the scene's own
// resolution (`setRatio`, the pace check's), clear until its first
// picture, and hidden from VoiceOver as the web's aria-hidden box is. It tells its driver when it
// enters or leaves a window, whether its page has it in view, and whether
// its window's scene is active; while it is in a window, a hovering
// pointer anywhere in that window leans the view.

#if canImport(UIKit)
import MetalKit
import SwiftUI
import UIKit
import VirgaCore

final class HillsideCanvasView: MTKView, UIGestureRecognizerDelegate {
  weak var driver: HillsideDriver?
  /// The page has it in view.
  var inView = true
  /// Its window's scene is in front and active.
  var sceneActive = true
  private var renderer: HillsideCanvasRenderer?
  private var hover: UIHoverGestureRecognizer?
  private var ratio: Double?
  /// The part of the scene's frame it shows, and the band's wash.
  var viewOffset: HillsideMatrix.ViewOffset? {
    didSet { renderer?.viewOffset = viewOffset }
  }
  var band: [Float] = [] {
    didSet { renderer?.band = band }
  }

  init() {
    super.init(frame: .zero, device: nil)
    isPaused = true
    enableSetNeedsDisplay = false
    // The drawable follows the scene's ratio, not the screen's (layoutSubviews).
    autoResizeDrawable = false
    framebufferOnly = true
    // Clear until its first picture, so the page's own sky shows through;
    // every picture it draws is opaque.
    isOpaque = false
    layer.isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    colorPixelFormat = HillsideGPU.colorFormat
    clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
    if let layer = layer as? CAMetalLayer { layer.maximumDrawableCount = 2 }
  }

  required init(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  var hasDrawn: Bool { renderer?.hasDrawn ?? false }

  /// The GPU is ready: draw with it, the land too or not.
  func connect(gpu: HillsideGPU, mode: HillsideCanvasRenderer.Mode) {
    guard renderer == nil || renderer?.mode != mode else { return }
    device = gpu.device
    depthStencilPixelFormat = mode == .hill ? HillsideGPU.depthFormat : .invalid
    let made = HillsideCanvasRenderer(gpu: gpu, mode: mode)
    made.viewOffset = viewOffset
    made.band = band
    renderer = made
    delegate = made
    fitDrawable()
  }

  /// The scene's pixels per point.
  func setRatio(_ value: Double) {
    ratio = value
    fitDrawable()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    fitDrawable()
    // laid out at last: the picture it couldn't draw while it had no size
    if !hasDrawn { driver?.viewsChanged() }
  }

  /// The drawable: the view's size at the scene's ratio.
  private func fitDrawable() {
    let scale = CGFloat(ratio ?? Double(traitCollection.displayScale))
    let size = CGSize(width: max(1, (bounds.width * scale).rounded()), height: max(1, (bounds.height * scale).rounded()))
    if drawableSize != size { drawableSize = size }
  }

  /// Draws the scene as it stands, now.
  func render(_ state: HillsideSceneState) {
    guard let renderer, window != nil, bounds.width > 0, bounds.height > 0 else { return }
    if ratio == nil { setRatio(state.ratio) }
    renderer.state = state
    draw()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if let hover, hover.view !== window {
      hover.view?.removeGestureRecognizer(hover)
      self.hover = nil
    }
    if let window, hover == nil, !(driver?.calm ?? true) {
      let made = UIHoverGestureRecognizer(target: self, action: #selector(hovered(_:)))
      made.cancelsTouchesInView = false
      made.delaysTouchesBegan = false
      made.delaysTouchesEnded = false
      made.delegate = self
      window.addGestureRecognizer(made)
      hover = made
    }
    driver?.viewsChanged()
  }

  @objc private func hovered(_ recognizer: UIHoverGestureRecognizer) {
    guard let window, recognizer.state == .began || recognizer.state == .changed else { return }
    // A pencil held over the screen isn't a mouse.
    if recognizer.zOffset > 0 { return }
    driver?.pointerMoved(recognizer.location(in: window), in: window.bounds.size)
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }
}

/// The scene's frame: the canvas's size and the crest in its terms.
struct HillsideFit: Equatable {
  var width: Double
  var height: Double
  var crest: Double
}

/// The canvas in SwiftUI.
struct HillsideCanvas: UIViewRepresentable {
  let driver: HillsideDriver
  var inView: Bool
  var sceneActive: Bool
  var viewOffset: HillsideMatrix.ViewOffset? = nil
  var band: [Float] = []
  var fit: HillsideFit

  func makeUIView(context: Context) -> HillsideCanvasView {
    let view = HillsideCanvasView()
    view.driver = driver
    return view
  }

  func updateUIView(_ view: HillsideCanvasView, context: Context) {
    if view.driver !== driver {
      view.driver?.detach(view)
      view.driver = driver
    }
    view.inView = inView
    view.sceneActive = sceneActive
    if view.viewOffset != viewOffset { view.viewOffset = viewOffset }
    if view.band != band { view.band = band }
    driver.fit(width: fit.width, height: fit.height, crest: fit.crest)
    driver.attach(view)
  }

  static func dismantleUIView(_ view: HillsideCanvasView, coordinator: ()) {
    view.driver?.detach(view)
  }
}
#endif
