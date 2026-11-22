// Ports src/hillside/Hillside.jsx (its effect: starting the scene, fitting it, and what it is told)
// Ports src/hillside/scene.js (the frame loop's requestAnimationFrame, the visibility and the pointer)
//
// What runs a hillside: Hillside.jsx's effect, with the scene's state
// (VirgaCore's HillsideSceneState) in place of createHillside's closure.
// Until the GPU is ready the page's wishes are kept (the sky, whether it
// is shown and in view, the intro, the size); then the scene starts as
// Hillside.jsx starts it (in view or not, the intro, then fit), and from
// there each wish goes straight to it.
//
// The frame callbacks the scene asks for are a CADisplayLink's, paused
// whenever none is queued, asking for 30 frames a second, or 60 while the
// view is on the move (the scene's own pace still picks which to draw).
// Whenever the scene draws a picture, every view showing it draws it.
//
// Its views are the canvases (HillsideCanvasView) on screen. It is shown
// (the page isn't hidden) while any of them is in an active scene, and in
// view while any of them is; a hovering pointer anywhere in their window
// leans the view (the web's window-wide pointermove, a mouse's or a
// trackpad's, never a finger's or a pencil's).
//
// The live sky's driver is shared by every page's band (LiveSkyDrivers), as
// the web's shell keeps one LiveSky across its pages: the clouds drift on
// from one page to the next instead of starting again.

#if canImport(UIKit)
import Foundation
import Observation
import QuartzCore
import UIKit
import VirgaCore

@MainActor
@Observable
final class HillsideDriver {
  /// The scene's picture is up in a view (else the flat picture shows).
  private(set) var showsPicture = false

  @ObservationIgnored let calm: Bool
  @ObservationIgnored let depth: Double
  @ObservationIgnored let soft: Bool
  /// Whether its views draw the land (a hill), or only sky and clouds (the band).
  @ObservationIgnored let drawsLand: Bool
  @ObservationIgnored private(set) var state: HillsideSceneState?
  @ObservationIgnored private(set) var gpu: HillsideGPU?
  @ObservationIgnored private var views: [WeakCanvas] = []
  @ObservationIgnored private var link: CADisplayLink?
  @ObservationIgnored private var linkRate: Float = 0
  @ObservationIgnored private var drawnCount = 0
  @ObservationIgnored private var ratioChanges = 0
  @ObservationIgnored private var started = false

  // What the page has asked for (Hillside.jsx's `want`).
  @ObservationIgnored private var phase: SkyPhase
  @ObservationIgnored private var active = true
  @ObservationIgnored private var inView = true
  @ObservationIgnored private var shown = true
  @ObservationIgnored private var wantsIntro = false
  @ObservationIgnored private var size: (width: Double, height: Double, crest: Double)?

  init(phase: SkyPhase, calm: Bool, depth: Double, soft: Bool, drawsLand: Bool, intro: Bool = false) {
    self.phase = phase
    self.calm = calm
    self.depth = depth
    self.soft = soft
    self.drawsLand = drawsLand
    wantsIntro = intro
    HillsideGPULoader.load { [weak self] gpu in
      guard let self else { return }
      guard let gpu else { return }
      if self.drawsLand {
        HillsideGPULoader.loadLand(gpu) { [weak self] in self?.start(gpu) }
      } else {
        self.start(gpu)
      }
    }
  }

  /// The pixels per point of the screen it is drawn on.
  private var displayScale: Double {
    let scale = views.lazy.compactMap { $0.view?.traitCollection.displayScale }.first { $0 > 0 }
    return Double(scale ?? 2)
  }

  /// Hillside.jsx's start(): the scene, told whether it is in view and
  /// whether to come down from the sky, then fitted.
  private func start(_ gpu: HillsideGPU) {
    guard !started else { return }
    started = true
    self.gpu = gpu
    for entry in views { entry.view?.connect(gpu: gpu, mode: drawsLand ? .hill : .band) }
    var s = HillsideSceneState(
      HillsideSceneOptions(calm: calm, phase: phase.rawValue, depth: depth, soft: soft, devicePixelRatio: displayScale))
    s.setShown(shown)
    s.setActive(active && inView)
    if wantsIntro { s.intro() }
    if let size { s.resize(width: size.width, height: size.height, crest: size.crest) }
    state = s
    settle()
  }

  // MARK: What the page asks

  func setPhase(_ next: SkyPhase) {
    guard next != phase else { return }
    phase = next
    state?.setPhase(next)
    settle()
  }

  /// Hillside's `active`: whether the page has it uncovered.
  func setActive(_ on: Bool) {
    guard on != active else { return }
    active = on
    state?.setActive(active && inView)
    settle()
  }

  /// `fit()`: the canvas's size, and how far down it the crest sits.
  func fit(width: Double, height: Double, crest: Double) {
    if let size, size.width == width, size.height == height, size.crest == crest { return }
    size = (width, height, crest)
    state?.resize(width: width, height: height, crest: crest)
    settle()
  }

  // MARK: Its views

  func attach(_ view: HillsideCanvasView) {
    views.removeAll { $0.view == nil }
    if !views.contains(where: { $0.view === view }) { views.append(WeakCanvas(view: view)) }
    if let gpu { view.connect(gpu: gpu, mode: drawsLand ? .hill : .band) }
    viewsChanged()
  }

  func detach(_ view: HillsideCanvasView) {
    views.removeAll { $0.view == nil || $0.view === view }
    viewsChanged()
  }

  /// A view came or went, moved window, or its page's scene or scroll changed.
  func viewsChanged() {
    let live = views.compactMap(\.view).filter { $0.window != nil }
    let nowShown = live.contains { $0.sceneActive }
    let nowInView = live.contains { $0.inView && $0.sceneActive }
    if nowShown != shown {
      shown = nowShown
      state?.setShown(shown)
    }
    if nowInView != inView {
      inView = nowInView
      state?.setActive(active && inView)
    }
    // A view that hasn't drawn the picture yet (new, or back in a window) draws it now.
    if let state, state.drawCount > 0 {
      for view in live where !view.hasDrawn { view.render(state) }
    }
    settle()
  }

  var hasViews: Bool { views.contains { $0.view != nil } }

  /// The pointer at `point` in a window of `size`.
  func pointerMoved(_ point: CGPoint, in size: CGSize) {
    guard size.width > 0, size.height > 0 else { return }
    state?.pointerMoved(type: "mouse", x: Double(point.x), y: Double(point.y), width: Double(size.width), height: Double(size.height))
  }

  /// Gone for good: nothing more is drawn.
  func dispose() {
    state?.dispose()
    link?.invalidate()
    link = nil
  }

  // MARK: Drawing

  fileprivate func step(_ link: CADisplayLink) {
    guard state != nil else { return }
    state?.frame(now: link.timestamp * 1000)
    settle()
  }

  /// After anything the scene was told: draw what it drew, keep the views'
  /// resolution to its pace check, and run the display link while it
  /// wants frames.
  private func settle() {
    guard let state else { return }
    if state.ratioChanges != ratioChanges {
      ratioChanges = state.ratioChanges
      for entry in views { entry.view?.setRatio(state.ratio) }
    }
    if state.drawCount != drawnCount {
      drawnCount = state.drawCount
      for view in views.compactMap(\.view) where view.window != nil { view.render(state) }
    }
    // Told on the next turn of the run loop, not in the middle of SwiftUI's
    // update (a canvas is attached and draws from updateUIView).
    let drawn = !state.isLost && views.contains { $0.view?.hasDrawn == true }
    if drawn != showsPicture {
      DispatchQueue.main.async { [weak self] in
        MainActor.assumeIsolated {
          guard let self, self.showsPicture != drawn else { return }
          self.showsPicture = drawn
        }
      }
    }
    runLink(state.framesQueued && views.contains { $0.view?.window != nil }, busy: state.busy)
  }

  private func runLink(_ on: Bool, busy: Bool) {
    if on && link == nil {
      let target = HillsideLinkTarget()
      target.driver = self
      let made = CADisplayLink(target: target, selector: #selector(HillsideLinkTarget.step(_:)))
      made.add(to: .main, forMode: .common)
      link = made
    }
    guard let link else { return }
    link.isPaused = !on
    let rate: Float = busy ? 60 : 30
    if rate != linkRate {
      linkRate = rate
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 60, preferred: rate)
    }
  }
}

/// The display link's target, holding the driver weakly (a link keeps its target).
private final class HillsideLinkTarget: NSObject {
  weak var driver: HillsideDriver?

  @objc func step(_ link: CADisplayLink) {
    MainActor.assumeIsolated {
      if let driver {
        driver.step(link)
      } else {
        link.invalidate()
      }
    }
  }
}

private struct WeakCanvas {
  weak var view: HillsideCanvasView?
}

/// The live sky's drivers: one for the app (one for Reduce Motion, one
/// without), shared by every page's band, let go a little after the last
/// band has gone.
@MainActor
enum LiveSkyDrivers {
  private static var drivers: [Bool: HillsideDriver] = [:]

  static func driver(phase: SkyPhase, calm: Bool) -> HillsideDriver {
    if let found = drivers[calm] { return found }
    let made = HillsideDriver(phase: phase, calm: calm, depth: LiveSky.depth, soft: false, drawsLand: false)
    drivers[calm] = made
    return made
  }

  /// A band went: if none is left after a moment, the driver goes too.
  static func released(_ driver: HillsideDriver) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      MainActor.assumeIsolated {
        guard !driver.hasViews else { return }
        for (calm, held) in drivers where held === driver {
          drivers[calm] = nil
          held.dispose()
        }
      }
    }
  }
}
#endif
