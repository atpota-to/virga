// Ports src/share/chartImage.js (renderShareImage)
//
// A card as a picture: VirgaInsights' drawShareImage makes the web's
// canvas calls one for one, and this is the canvas they are made on. A
// ShareCanvas over SwiftUI's GraphicsContext, inside a Canvas view the
// picture's size (ChartImage.shareWidth × shareHeight, 1200 × 675), the
// text set and measured in Instrument Sans (the canvas's own face: its
// wght axis, and no tabular figures, as the web's canvas sets it; the
// system font when the face isn't registered), rendered to PNG with
// ImageRenderer at one pixel a point, as the web's 1200 × 675 canvas is.
//
// The canvas keeps the 2D context's state as the web's does: the styles,
// the font, the alignment and baseline, the line's width, cap, join and
// dash; save and restore keep that and the transform and clip (a copy of
// the GraphicsContext each, which draws into the same picture); the path
// is built in the current transform's space and filled (non-zero) or
// stroked through it. Angles are the canvas's: radians, clockwise in the
// y-down space, which is CGPath's `clockwise: false`.
//
// renderShareImage's rejection is nil here: when drawShareImage says the
// web's drawing would have thrown (it returns false), or the renderer
// gives no image, there is no picture.

#if canImport(UIKit)
import CoreText
import SwiftUI
import UIKit
import VirgaCore
import VirgaInsights

/// The canvas's face: Instrument Sans at a weight and a size, without the
/// app's tabular figures (a canvas's font has none).
enum ShareFace {
  private static let lock = NSLock()
  private static var made: [String: CTFont] = [:]

  static func font(_ font: ShareFont) -> CTFont {
    let size = CGFloat(font.size)
    let weight = Double(font.weight)
    let key = "\(size)|\(weight)"
    lock.lock()
    defer { lock.unlock() }
    if let held = Self.made[key] { return held }
    let face: CTFont
    if VirgaTypeface.isRegistered {
      let attributes: [String: Any] = [
        kCTFontNameAttribute as String: VirgaTypeface.postScriptName,
        kCTFontVariationAttribute as String: [NSNumber(value: VirgaTypeface.weightAxis): NSNumber(value: weight)],
      ]
      face = CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(attributes as CFDictionary), size, nil)
    } else {
      let uiWeight: UIFont.Weight = weight >= 600 ? .semibold : weight >= 500 ? .medium : .regular
      face = UIFont.systemFont(ofSize: size, weight: uiWeight) as CTFont
    }
    Self.made[key] = face
    return face
  }
}

/// A ShareCanvas over a GraphicsContext.
final class GraphicsShareCanvas: ShareCanvas {
  /// What `save()` keeps besides the transform and the clip.
  struct CanvasState {
    var fillStyle: ShareStyle = .color(.hex(0x000000))
    var strokeStyle: ShareStyle = .color(.hex(0x000000))
    var font = ShareFont(weight: 400, size: 10)
    var textAlign: ShareTextAlign = .left
    var textBaseline: ShareTextBaseline = .alphabetic
    var lineWidth: Double = 1
    var lineCap: ShareLineCap = .butt
    var lineJoin: ShareLineJoin = .miter
    var letterSpacing: Double = 0
    var dash: [Double] = []
  }

  private var context: GraphicsContext
  private var state = CanvasState()
  private var saved: [(context: GraphicsContext, state: CanvasState)] = []
  private var path = Path()

  init(_ context: GraphicsContext) {
    self.context = context
  }

  var fillStyle: ShareStyle {
    get { state.fillStyle }
    set { state.fillStyle = newValue }
  }

  var strokeStyle: ShareStyle {
    get { state.strokeStyle }
    set { state.strokeStyle = newValue }
  }

  var font: ShareFont {
    get { state.font }
    set { state.font = newValue }
  }

  var textAlign: ShareTextAlign {
    get { state.textAlign }
    set { state.textAlign = newValue }
  }

  var textBaseline: ShareTextBaseline {
    get { state.textBaseline }
    set { state.textBaseline = newValue }
  }

  var lineWidth: Double {
    get { state.lineWidth }
    set { if newValue.isFinite && newValue > 0 { state.lineWidth = newValue } }
  }

  var lineCap: ShareLineCap {
    get { state.lineCap }
    set { state.lineCap = newValue }
  }

  var lineJoin: ShareLineJoin {
    get { state.lineJoin }
    set { state.lineJoin = newValue }
  }

  var supportsLetterSpacing: Bool { true }

  var letterSpacing: Double {
    get { state.letterSpacing }
    set { state.letterSpacing = newValue }
  }

  // MARK: Styles

  private func shading(_ style: ShareStyle) -> GraphicsContext.Shading {
    switch style {
    case .color(let color):
      return .color(color.color)
    case .linearGradient(let g):
      let stops = g.stops.map { Gradient.Stop(color: $0.color.color, location: CGFloat($0.offset)) }
      return .linearGradient(Gradient(stops: stops), startPoint: CGPoint(x: g.x0, y: g.y0), endPoint: CGPoint(x: g.x1, y: g.y1))
    }
  }

  private var strokeStyleNow: StrokeStyle {
    let cap: CGLineCap = state.lineCap == .round ? .round : .butt
    let join: CGLineJoin = state.lineJoin == .round ? .round : .miter
    return StrokeStyle(lineWidth: CGFloat(state.lineWidth), lineCap: cap, lineJoin: join, miterLimit: 10, dash: state.dash.map { CGFloat($0) })
  }

  // MARK: Text

  /// The text in the current font and spacing, shaded with the fill.
  private func resolved(_ text: String) -> GraphicsContext.ResolvedText {
    let face = ShareFace.font(state.font)
    var resolved = context.resolve(Text(verbatim: text).font(Font(face)).tracking(CGFloat(state.letterSpacing)))
    resolved.shading = shading(state.fillStyle)
    return resolved
  }

  private static let unbounded = CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)

  func measureText(_ text: String) -> Double {
    Double(resolved(text).measure(in: Self.unbounded).width)
  }

  func fillText(_ text: String, _ x: Double, _ y: Double) {
    let shaped = resolved(text)
    let size = shaped.measure(in: Self.unbounded)
    let baseline = shaped.firstBaseline(in: size)
    let left: CGFloat
    switch state.textAlign {
    case .left: left = CGFloat(x)
    case .center: left = CGFloat(x) - size.width / 2
    case .right: left = CGFloat(x) - size.width
    }
    var baselineY = CGFloat(y)
    if state.textBaseline == .middle {
      // The middle of the em square: half the way from the descent up to the ascent.
      let face = ShareFace.font(state.font)
      baselineY += (CTFontGetAscent(face) - CTFontGetDescent(face)) / 2
    }
    context.draw(shaped, at: CGPoint(x: left, y: baselineY - baseline), anchor: .topLeading)
  }

  // MARK: Rectangles, state, transforms

  func fillRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
    context.fill(Path(CGRect(x: x, y: y, width: width, height: height)), with: shading(state.fillStyle))
  }

  func save() {
    saved.append((context, state))
  }

  func restore() {
    guard let last = saved.popLast() else { return }
    context = last.context
    state = last.state
  }

  func translate(_ x: Double, _ y: Double) {
    context.translateBy(x: CGFloat(x), y: CGFloat(y))
  }

  func scale(_ x: Double, _ y: Double) {
    context.scaleBy(x: CGFloat(x), y: CGFloat(y))
  }

  // MARK: Paths

  func beginPath() {
    path = Path()
  }

  func moveTo(_ x: Double, _ y: Double) {
    path.move(to: CGPoint(x: x, y: y))
  }

  func lineTo(_ x: Double, _ y: Double) {
    // With no subpath, lineTo starts one where it is (the canvas's rule).
    if path.currentPoint == nil {
      path.move(to: CGPoint(x: x, y: y))
    } else {
      path.addLine(to: CGPoint(x: x, y: y))
    }
  }

  func arc(_ x: Double, _ y: Double, _ radius: Double, _ startAngle: Double, _ endAngle: Double) {
    path.addArc(
      center: CGPoint(x: x, y: y), radius: CGFloat(radius), startAngle: .radians(startAngle), endAngle: .radians(endAngle), clockwise: false)
  }

  func arcTo(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ radius: Double) {
    if path.currentPoint == nil { path.move(to: CGPoint(x: x1, y: y1)) }
    path.addArc(tangent1End: CGPoint(x: x1, y: y1), tangent2End: CGPoint(x: x2, y: y2), radius: CGFloat(radius))
  }

  func rect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
    path.addRect(CGRect(x: x, y: y, width: width, height: height))
  }

  func closePath() {
    path.closeSubpath()
  }

  func fill() {
    context.fill(path, with: shading(state.fillStyle))
  }

  func stroke() {
    context.stroke(path, with: shading(state.strokeStyle), style: strokeStyleNow)
  }

  func clip() {
    context.clip(to: path)
  }

  func setLineDash(_ segments: [Double]) {
    // A list with a value that isn't a finite length of at least 0 is
    // ignored; an odd one is used twice over.
    if segments.contains(where: { !$0.isFinite || $0 < 0 }) { return }
    state.dash = segments.count % 2 == 1 ? segments + segments : segments
  }
}

/// Whether the drawing finished, read once the renderer has run it.
final class ShareDrawing {
  var finished: Bool?
}

/// The picture as a view: a Canvas the picture's size, drawShareImage on it.
struct ShareImageCanvas: View {
  let spec: ShareSpecification
  let theme: ShareTheme
  let formats: ReportFormats
  let drawing: ShareDrawing

  var body: some View {
    Canvas { context, _ in
      let canvas = GraphicsShareCanvas(context)
      drawing.finished = ChartImage.drawShareImage(canvas, spec, theme, formats: formats)
    }
    .frame(width: CGFloat(ChartImage.shareWidth), height: CGFloat(ChartImage.shareHeight))
  }
}

enum ShareImage {
  /// The file name the picture goes out as.
  static let filename = "virga-chart.png"

  /// `renderShareImage(spec, { theme })`: the picture as PNG, or nil where
  /// the web's would reject (the drawing couldn't finish, or no image).
  @MainActor
  static func render(_ spec: ShareSpecification, theme: ShareTheme, formats: ReportFormats = .active) -> UIImage? {
    let drawing = ShareDrawing()
    let renderer = ImageRenderer(content: ShareImageCanvas(spec: spec, theme: theme, formats: formats, drawing: drawing))
    renderer.scale = 1
    renderer.isOpaque = true
    renderer.proposedSize = ProposedViewSize(width: CGFloat(ChartImage.shareWidth), height: CGFloat(ChartImage.shareHeight))
    guard let image = renderer.uiImage, drawing.finished == true else { return nil }
    return image
  }
}
#endif
