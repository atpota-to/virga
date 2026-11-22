// Ports src/hillside/scene.js (createHillside: the light's turning, the view, the intro, the lean and the frame loop)
//
// Everything createHillside works out between one picture and the next,
// without the drawing: the colours eased from one sky to another (a change
// starts from whatever is showing, even halfway through another, and the
// light moves the short way round), where you stand and how the view is
// aimed so the hill's crest lands where the page wants it, the intro that
// brings the view down from the sky onto the hill, the pointer leaning the
// view a little and the slow sway, the wind, the clouds' drift, and the
// frame loop: a gentle 30 pictures a second unless the view is on the
// move, nothing while the page has it out of view (but a change of light
// under way is finished, so it never stops halfway to dawn) or the app is
// hidden, fewer pixels when frames come slowly, and with reduced motion a
// still picture whenever something changes.
//
// The web runs this on requestAnimationFrame; here the frame callbacks it
// asks for are kept as `framesQueued`, and whoever drives it (VirgaUI's
// display link) calls `frame(now:)` with each display frame's time in
// milliseconds while any is queued. A picture drawn bumps `drawCount`:
// that is when the renderer draws the state as it then stands. Held to the
// web's own createHillside, run over a recording stand-in for WebGL, by
// ios/parity/cases/hillside.scene.js.

import Foundation

/// createHillside's `opts`, less its callbacks.
public struct HillsideSceneOptions: Hashable, Sendable {
  /// Reduced motion: a still picture, drawn when something changes.
  public var calm: Bool
  /// The sky to open on ('dawn', 'day', 'dusk' or 'night'; anything else is day).
  public var phase: String?
  /// How deep a blue the sky reaches at the top of the frame: 1 is the
  /// full deep blue, less is paler.
  public var depth: Double
  /// Shown out of focus: drawn at a lower resolution, since the blur hides it.
  public var soft: Bool
  /// The screen's pixels per point (`window.devicePixelRatio`).
  public var devicePixelRatio: Double

  public init(calm: Bool = false, phase: String? = "day", depth: Double = 1, soft: Bool = true, devicePixelRatio: Double = 1) {
    self.calm = calm
    self.phase = phase
    self.depth = depth
    self.soft = soft
    self.devicePixelRatio = devicePixelRatio
  }
}

/// The view's `{ w, h, crest, fov, x, z, pitch }`.
public struct HillsideViewFrame: Hashable, Sendable {
  public var w: Double = 1
  public var h: Double = 1
  public var crest = 0.5
  public var fov: Double = 50
  public var x: Double = 0
  public var z: Double = 0
  public var pitch: Double = 0
}

/// The pointer's lean on the view, and where it is easing to.
public struct HillsideLean: Hashable, Sendable {
  public var x: Double = 0
  public var y: Double = 0
  public var gx: Double = 0
  public var gy: Double = 0
}

public struct HillsideSceneState: Sendable {
  public let calm: Bool
  public let depth: Double
  public let soft: Bool

  // MARK: The light

  /// C: what is drawn, by COLOR_KEYS' order.
  public private(set) var colors: [HillsideColor]
  private var turnFrom: [HillsideColor]
  private var turnTo: [HillsideColor]
  private var sunA = HillsideVector.zero
  private var sunB = HillsideVector.zero
  /// Where the light comes from now.
  public private(set) var sunDir = HillsideVector(0, 1, 0)
  /// `uDisc`, `uStars`, `uSpan`.
  public private(set) var disc: Double = 0
  public private(set) var stars: Double = 0
  public private(set) var span = 0.45
  private var fromDisc: Double = 0
  private var fromStars: Double = 0
  public private(set) var phase: SkyPhase
  /// How far through a change of sky (1 when none is under way).
  public private(set) var turnT: Double = 1

  // MARK: The view

  public private(set) var view = HillsideViewFrame()
  public private(set) var camera = HillsideCamera()
  public private(set) var lean = HillsideLean()
  /// How far through the intro (1 when it isn't running).
  public private(set) var introT: Double = 1
  /// `uTime`: seconds drawn.
  public private(set) var clock: Double = 0
  /// `uWindOff`: how far the wind has carried the cloud shadows and gusts.
  public private(set) var windOff = HillsideVector.zero
  public private(set) var clouds: HillsideCloudBatch

  // MARK: Drawing

  /// The pixels drawn per point, lowered when frames come slowly.
  public private(set) var ratio: Double
  /// The lowest the pace check takes `ratio`.
  public let floor: Double
  public private(set) var active = true
  public private(set) var shown = true
  /// The first picture is up (`onReady`).
  public private(set) var isReady = false
  /// Nothing more is drawn: disposed, or the drawing went away.
  public private(set) var isDead = false
  /// The drawing went away (`onLost`): the page's own picture shows again.
  public private(set) var isLost = false
  /// Pictures drawn so far.
  public private(set) var drawCount = 0
  /// Times the pace check has lowered `ratio`.
  public private(set) var ratioChanges = 0
  /// The frame loop's callback is waiting for the next display frame (`raf`).
  public private(set) var tickQueued = false
  /// The still picture's callback is waiting for it (`pending`).
  public private(set) var stillQueued = false
  private var last: Double = 0
  private var since: Double = 0
  private var slowN = 0
  private var slowSum: Double = 0

  public init(_ options: HillsideSceneOptions, clouds: HillsideCloudBatch = HillsideCloudBatch()) {
    calm = options.calm
    depth = options.depth
    soft = options.soft
    let keys = HillsideColorKey.allCases.count
    colors = Array(repeating: .white, count: keys)
    turnFrom = Array(repeating: .white, count: keys)
    turnTo = Array(repeating: .white, count: keys)
    phase = HillsideScene.phaseOf(options.phase)
    ratio = min(options.devicePixelRatio == 0 ? 1 : options.devicePixelRatio, options.soft ? 0.75 : 1.5)
    floor = options.soft ? 0.5 : 0.6
    self.clouds = clouds
    beginTurn(to: phase)
    applyTurn()
  }

  /// Whether the frame loop or a still picture waits for a display frame.
  public var framesQueued: Bool { tickQueued || stillQueued }

  /// `busy()`: something on screen is moving fast enough to want every frame.
  public var busy: Bool {
    introT < 1 || turnT < 1 || abs(lean.gx - lean.x) > 0.002 || abs(lean.gy - lean.y) > 0.002
  }

  /// `wanted()`: draw while the page has it in view, and, out of view,
  /// until a change of light under way has finished.
  public var wanted: Bool { !isDead && shown && (active || turnT < 1) }

  /// A colour of C.
  public func color(_ key: HillsideColorKey) -> HillsideColor {
    colors[HillsideColorKey.allCases.firstIndex(of: key) ?? 0]
  }

  // MARK: Colours, eased from one sky to another

  /// `turnTo(name)`.
  private mutating func beginTurn(to next: SkyPhase) {
    let p = HillsideScene.palette(next)
    for (index, key) in HillsideColorKey.allCases.enumerated() {
      turnFrom[index] = colors[index]
      turnTo[index] = p.color(key)
    }
    sunA = sunDir
    sunB = p.sun.normalized
    fromDisc = disc
    fromStars = stars
    phase = next
  }

  /// `applyTurn()`.
  private mutating func applyTurn() {
    let p = HillsideScene.palette(phase)
    let e = HillsideScene.smooth(turnT)
    for index in colors.indices { colors[index] = turnFrom[index].lerp(turnTo[index], e) }
    // the light moves the short way round, from where it was to its new place
    let ref = HillsideVector(0, 0, -1)
    let qa = HillsideQuaternion.fromUnitVectors(ref, sunA)
    let qt = HillsideQuaternion.fromUnitVectors(ref, sunB)
    sunDir = ref.applying(qa.slerp(qt, e))
    disc = HillsideScene.lerp(fromDisc, p.disc, e)
    stars = HillsideScene.lerp(fromStars, p.stars, e)
  }

  // MARK: The view

  /// `aim()`: where you stand, and how the view is aimed so the crest lands
  /// where the page wants it. A tall, narrow screen stands nearer the foot
  /// of the hill, so the slope fills it rather than the grass at your feet.
  private mutating func aim() {
    let deg = HillsideScene.deg
    let aspect = view.w / view.h
    // at least about 52° across, short of a fish-eye on a phone
    view.fov = HillsideScene.clamp((2 * atan(tan(26 * deg) / aspect)) / deg, 44, 72)
    let tall = HillsideScene.smooth((0.34 - view.crest) / 0.22)
    view.z = HillsideScene.lerp(0, -110, tall)
    view.x = HillsideScene.lerp(0, -30, tall)
    let camY = HillsideLand.height(view.x, view.z) + HillsideScene.eye
    // the crest straight ahead: the highest the land rises, seen from here
    var crestAng = -0.2
    var d: Double = 8
    while d < 9000 {
      let h = HillsideLand.height(view.x, view.z - d)
      crestAng = max(crestAng, atan2(h - camY, d))
      d *= 1.04
    }
    let half = tan((view.fov / 2) * deg)
    view.pitch = crestAng - atan((0.5 - view.crest) * 2 * half)
    // the sky's gradient spans the frame, from the horizon to its top edge
    span = max(0.12, sin(view.pitch + (view.fov / 2) * deg)) / HillsideScene.clamp(depth, 0.3, 1.2)
    camera.fov = view.fov
    camera.aspect = aspect
  }

  /// `place(t)`: the pointer leans the view a little; the intro looks up at
  /// the sky first.
  private mutating func place(_ t: Double) {
    let deg = HillsideScene.deg
    let i = HillsideScene.easeOut(introT)
    let look = (1 - i) * 7 * deg
    let step = (1 - i) * 26
    let yaw = -lean.x * 1.4 * deg + (calm ? 0 : sin(t * 0.09) * 0.35 * deg)
    let pitchLook = view.pitch + look - lean.y * 0.6 * deg
    let pitch = pitchLook + (calm ? 0 : sin(t * 0.13 + 1) * 0.12 * deg)
    let x = view.x + lean.x * 3
    let z = view.z + step
    let y = HillsideLand.height(x, z) + HillsideScene.eye + (1 - i) * 2
    camera.place(HillsideVector(x, y, z), pitch: pitch, yaw: yaw)
  }

  // MARK: Drawing

  /// `draw(dt)`: everything moves on by `dt` seconds and a picture is drawn.
  private mutating func draw(_ dt: Double) {
    clock += dt
    let carried = HillsideScene.wind * 0.9 * dt
    windOff.x += HillsideScene.windDir.x * carried
    windOff.y += HillsideScene.windDir.y * carried
    if turnT < 1 {
      turnT = min(1, turnT + dt / HillsideScene.turn)
      applyTurn()
    }
    if introT < 1 { introT = min(1, introT + dt / HillsideScene.introSeconds) }
    let k = 1 - exp(-dt * 2.2)
    lean.x += (lean.gx - lean.x) * k
    lean.y += (lean.gy - lean.y) * k
    place(clock)
    clouds.update(dt: dt, wind: calm ? 0 : HillsideScene.wind, camera: camera, sunDir: sunDir)
    drawCount += 1
    isReady = true
  }

  /// `tick(now)`: the frame loop's callback.
  private mutating func tick(_ now: Double) {
    tickQueued = false
    if !wanted {
      last = 0
      return
    }
    let dt = last != 0 ? min(0.1, (now - last) / 1000) : 1.0 / 60
    last = now
    since += dt
    // a gentle 30 frames a second, unless the view is on the move
    if busy || since >= 1.0 / 31 {
      if !busy {
        slowSum += since
        slowN += 1
        if slowN >= 45 {
          if slowSum / Double(slowN) > 1.0 / 20 && ratio > floor + 0.02 {
            ratio = max(floor, ratio * 0.8)
            ratioChanges += 1
          }
          slowN = 0
          slowSum = 0
        }
      }
      draw(since)
      since = 0
    }
    tickQueued = true
  }

  /// `still()`: with reduced motion, one picture whenever something changes.
  private mutating func still() {
    if stillQueued || isDead { return }
    stillQueued = true
  }

  /// `run()`.
  private mutating func run() {
    if calm {
      still()
      return
    }
    if !tickQueued && wanted { tickQueued = true }
  }

  /// A display frame at `now` (milliseconds): the callbacks waiting for it run.
  public mutating func frame(now: Double) {
    let runTick = tickQueued
    let runStill = stillQueued
    if runTick { tick(now) }
    if runStill {
      stillQueued = false
      if !isDead { draw(0) }
    }
  }

  // MARK: What the page asks of it

  /// `resize(width, height, crest)`: the canvas's size, and how far down it
  /// the hill's crest should sit (0 to 1). Returns whether the size changed
  /// (the drawing buffer is made again).
  @discardableResult
  public mutating func resize(width: Double, height: Double, crest: Double) -> Bool {
    let nextW = max(1, width)
    let nextH = max(1, height)
    let resized = nextW != view.w || nextH != view.h
    view.w = nextW
    view.h = nextH
    view.crest = HillsideScene.clamp(crest, 0.04, 0.96)
    aim()
    // draw now, so a resize never shows a stretched frame
    if calm || !tickQueued {
      if !isDead { draw(0) }
    }
    run()
    return resized
  }

  /// `setPhase(next, instant)`: ease from the sky as it stands to another;
  /// `instant` jumps there.
  public mutating func setPhase(_ next: String?, instant: Bool = false) {
    let name = HillsideScene.phaseOf(next)
    if name == phase { return }
    beginTurn(to: name)
    // With reduced motion there is no turning: the still is drawn again in the new light.
    turnT = instant || calm ? 1 : 0
    applyTurn()
    run()
  }

  public mutating func setPhase(_ next: SkyPhase, instant: Bool = false) {
    setPhase(next.rawValue, instant: instant)
  }

  /// `setActive(on)`: whether the page has it in view.
  public mutating func setActive(_ on: Bool) {
    active = on
    run()
  }

  /// `intro()`: step outside; the view comes down from the sky onto the hill.
  public mutating func intro() {
    if calm { return }
    introT = 0
    run()
  }

  /// The page's visibility (`!document.hidden`): the app is in front.
  public mutating func setShown(_ on: Bool) {
    shown = on
    run()
  }

  /// `pointermove`: a mouse (or a trackpad's pointer) at `x`, `y` in a
  /// window `width` by `height`. Any other pointer, and any pointer with
  /// reduced motion, leans nothing.
  public mutating func pointerMoved(type: String, x: Double, y: Double, width: Double, height: Double) {
    if calm || !type.jsEquals("mouse") { return }
    lean.gx = x / width - 0.5
    lean.gy = y / height - 0.5
  }

  /// The drawing went away (`webglcontextlost`): nothing more is drawn.
  public mutating func contextLost() {
    isDead = true
    isLost = true
  }

  /// `dispose()`.
  public mutating func dispose() {
    isDead = true
    tickQueued = false
    stillQueued = false
  }
}
