// Ports src/components/Figures.jsx
// Ports src/components/Delta.jsx
// Ports src/styles/controls.css (.figures, .delta)
//
// A row of figures, each under a 2-point rule in --line: its label (--ink-2,
// 500, small), the number (--figure-size, 500, tracking −0.04em, line 1)
// with its unit after it if it has one (reports.css `.fig-unit`), and a
// note (muted, small; FigureNote for a change and its words). Four or five to a row on a wide screen (each
// at least 168 wide, 128 when there are exactly five), two on a phone, an
// odd last one taking the whole row. Numbers get the active locale's
// separators (AppLocale.formatNumber, the web's toLocaleString(activeLocale())),
// anything else prints as given, and a missing value is skipped.
//
// DeltaView is a change against the window before: the figure in ink, 600,
// with its sign, no colour (which way it went, not whether that is good:
// more blocks is "up" too). Its words are VirgaArchive's ChartFormat.deltaText
// (charts/format.js): "+8.6%", "−12%", "0%", or "new" with nothing to
// compare against. A caller with no comparison at all draws none.

#if canImport(UIKit)
import CoreText
import SwiftUI
import VirgaArchive
import VirgaCore

/// One figure: `{ key, value, label, note? }`.
public struct FigureItem: Identifiable {
  public enum Value {
    case number(Double)
    case text(String)
  }

  public var key: String
  public var label: String
  public var value: Value?
  public var note: AnyView?
  /// A unit after the number ("%"), small and muted (reports.css `.fig-unit`).
  public var unit: String?

  public var id: String { key }

  public init(key: String? = nil, label: String, value: Value?, note: AnyView? = nil, unit: String? = nil) {
    self.key = key ?? label
    self.label = label
    self.value = value
    self.note = note
    self.unit = unit
  }

  var shown: String? {
    switch value {
    case .number(let n)?: return AppLocale.formatNumber(n)
    case .text(let t)?: return t.isEmpty ? nil : t
    case nil: return nil
    }
  }
}

/// `.figures`: the grid of cells, columns worked out from its width. Its
/// subviews come in threes, a cell's label (under its rule), number and
/// note, and each line of cells shares those three rows (the stylesheet's
/// subgrid): a label that takes two lines in one cell doesn't leave its
/// number lower than its neighbour's.
struct FiguresLayout: Layout {
  var columnGap: CGFloat
  var rowGap: CGFloat
  /// Between a cell's label, number and note (`row-gap: 8px`).
  var partGap: CGFloat
  var minWidth: CGFloat
  var phone: Bool

  func columns(_ width: CGFloat, count: Int) -> Int {
    if phone { return min(2, max(1, count)) }
    let fit = Int((width + columnGap) / (minWidth + columnGap))
    return max(1, min(count, fit))
  }

  func frames(_ width: CGFloat, subviews: Subviews) -> [CGRect] {
    let count = subviews.count / 3
    guard count > 0 else { return [] }
    let cols = columns(width, count: count)
    let cellWidth = (width - columnGap * CGFloat(cols - 1)) / CGFloat(cols)
    var out: [CGRect] = []
    var y: CGFloat = 0
    var index = 0
    while index < count {
      let rowCount = min(cols, count - index)
      // An odd one out at the end of a phone's rows takes the whole row.
      let span = phone && rowCount == 1 && cols == 2
      let w = span ? width : cellWidth
      // The line's three rows, each as tall as its tallest part.
      var rows: [CGFloat] = [0, 0, 0]
      for i in 0..<rowCount {
        for part in 0..<3 {
          let height = subviews[(index + i) * 3 + part].sizeThatFits(ProposedViewSize(width: w, height: nil)).height
          rows[part] = max(rows[part], height)
        }
      }
      for i in 0..<rowCount {
        let x = CGFloat(i) * (cellWidth + columnGap)
        var top = y
        for part in 0..<3 {
          out.append(CGRect(x: x, y: top, width: w, height: rows[part]))
          top += rows[part] + partGap
        }
      }
      y += rows[0] + rows[1] + rows[2] + partGap * 2 + rowGap
      index += rowCount
    }
    return out
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 600
    let frames = frames(width, subviews: subviews)
    return CGSize(width: width, height: frames.map(\.maxY).max() ?? 0)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for (index, frame) in frames(bounds.width, subviews: subviews).enumerated() {
      subviews[index].place(
        at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
        proposal: ProposedViewSize(width: frame.width, height: frame.height))
    }
  }
}

public struct FiguresView: View {
  @Environment(\.virgaTheme) private var theme
  private let items: [FigureItem]
  private let label: String?

  /// - Parameter label: the row's name, for VoiceOver.
  public init(_ items: [FigureItem], label: String? = nil) {
    self.items = items
    self.label = label
  }

  public var body: some View {
    let shown = items.filter { $0.shown != nil }
    let phone = theme.isPhone
    let gap = theme.gap(ThemeKit.figuresGap)
    let minWidth: CGFloat = shown.count == 5 ? Measure.Figures.fiveMinWidth : Measure.Figures.minWidth
    FiguresLayout(
      columnGap: phone ? theme.points(ThemeKit.phoneFiguresColumnGap) : gap.column, rowGap: gap.row,
      partGap: theme.points(ThemeKit.figureCellGap), minWidth: minWidth, phone: phone
    ) {
      ForEach(shown) { item in
        FigureLabelPart(item: item, phone: phone)
        FigureValuePart(item: item)
        FigureNotePart(item: item)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label ?? "")
  }
}

/// A cell's top: its 2-point rule, the padding under it, and its label.
struct FigureLabelPart: View {
  @Environment(\.virgaTheme) private var theme
  let item: FigureItem
  let phone: Bool

  var body: some View {
    let rule = ThemeKit.figureCellRule
    let padding = phone ? ThemeKit.phoneFigureCellPadding : ThemeKit.figureCellPadding
    Text(item.label)
      .virgaText(size: theme.points(ThemeKit.figureLabelFontSize), weight: ThemeKit.figureLabelWeight)
      .foregroundStyle(theme.color(ThemeKit.figureLabelInk))
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, theme.points(padding.top))
      .overlay(alignment: .top) {
        Rectangle().fill(theme.color(rule)).frame(height: theme.points(rule))
      }
      // Read with its number (FigureValuePart).
      .accessibilityHidden(true)
  }
}

/// The number: --figure-size at line height 1, wrapping anywhere rather
/// than shrinking (`overflow-wrap: anywhere`), then its unit if it has one
/// (reports.css `.fig-unit`): 0.4 of the number's size, muted, 500, no
/// tracking, 3 after the number on its baseline, in the same line of text
/// so it follows the number's last line.
///
/// On one line it is one Text. A number that wraps (a long one in a
/// phone's half of the row, or any at a large Dynamic Type size) is set a
/// character at a time (FigureLines), a line every figure size as the
/// web's are, where a Text's lines would be the face's own 1.22 apart; its
/// unit then goes to a line of its own, 3 in, when it doesn't fit after the
/// number, as the web's does. Only a value FigureWrap.canSet takes is set
/// so, with the bundled face; anything else wraps as a Text.
struct FigureValuePart: View {
  @Environment(\.virgaTheme) private var theme
  let item: FigureItem

  var body: some View {
    let size = theme.points(ThemeKit.figureValueFontSize)
    let weight = ThemeKit.figureValueWeight
    let spoken: String = (item.shown ?? "") + (item.unit ?? "")
    value(size: size, weight: weight)
      .foregroundStyle(theme.ink)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(item.label)
      .accessibilityValue(spoken)
  }

  @ViewBuilder private func value(size: CGFloat, weight: Double) -> some View {
    if let characters = characters(size: size, weight: weight) {
      ViewThatFits(in: .horizontal) {
        line(size: size, weight: weight)
        characters
      }
    } else {
      line(size: size, weight: weight)
    }
  }

  private func line(size: CGFloat, weight: Double) -> some View {
    words(size: size)
      .virgaText(size: size, weight: weight, lineHeight: ThemeKit.figureValueLineHeight, tracking: ThemeKit.figureValueTracking)
      // Line height 1: the box is the figure's size, its glyphs reaching
      // past it as a browser's do.
      .padding(.vertical, theme.overflowingLeading(size: size, lineHeight: ThemeKit.figureValueLineHeight, weight: weight))
      .fixedSize(horizontal: false, vertical: true)
  }

  /// The value and its unit a character at a time, each where it goes in a
  /// line of it as Core Text sets it with the bundled face (its tabular
  /// figures, and any kerning), with the letter-spacing a browser puts
  /// after each; nil for a value FigureWrap doesn't set, or without the
  /// bundled face.
  private func characters(size: CGFloat, weight: Double) -> FigureCharacters? {
    guard let shown = item.shown, FigureWrap.canSet(shown + (item.unit ?? "")), theme.hasTypeface,
      let face = VirgaTypeface.face(size: theme.scaled(size), weight: weight)
    else { return nil }
    let tracking = theme.tracking(ThemeKit.figureValueTracking, size: size)
    var glyphs = shown.map { FigureCharacters.Glyph(text: String($0), font: theme.font(size: size, weight: weight), unit: false) }
    var advances = FigureCharacters.measure(shown, face: face).map { $0 + tracking }
    var leads = Array(repeating: CGFloat(0), count: advances.count)
    if let unit = item.unit, !unit.isEmpty {
      let unitSize = size * Measure.Reports.figUnitScale
      guard let unitFace = VirgaTypeface.face(size: theme.scaled(unitSize), weight: Measure.Reports.figUnitWeight) else { return nil }
      let font = theme.font(size: unitSize, weight: Measure.Reports.figUnitWeight)
      glyphs += unit.map { FigureCharacters.Glyph(text: String($0), font: font, unit: true) }
      // `.fig-unit { margin-left: 3px; letter-spacing: 0 }`
      advances += FigureCharacters.measure(unit, face: unitFace)
      leads += [Measure.Reports.figUnitGap] + Array(repeating: CGFloat(0), count: unit.count - 1)
    }
    guard advances.count == glyphs.count else { return nil }
    return FigureCharacters(
      glyphs: glyphs, advances: advances, leads: leads,
      pitch: theme.scaled(size) * CGFloat(ThemeKit.figureValueLineHeight))
  }

  private func words(size: CGFloat) -> Text {
    let number = Text(item.shown ?? "")
    guard let unit = item.unit, !unit.isEmpty else { return number }
    let unitSize: CGFloat = size * Measure.Reports.figUnitScale
    // `margin-left: 3px`: a no-break space tracked to 3, so the unit never
    // starts a line of its own.
    let gapTracking: CGFloat = Measure.Reports.figUnitGap - theme.spaceWidth(size: unitSize)
    let gap = Text("\u{00A0}").font(theme.font(size: unitSize)).tracking(gapTracking)
    let shown = Text(unit)
      .font(theme.font(size: unitSize, weight: Measure.Reports.figUnitWeight))
      .tracking(0)
      .foregroundStyle(theme.muted)
    return number + gap + shown
  }
}

/// A figure's value once it wraps: one Text per character, placed by
/// FigureLines. The number's characters are in ink, the unit's muted.
struct FigureCharacters: View {
  @Environment(\.virgaTheme) private var theme

  struct Glyph {
    var text: String
    var font: Font
    var unit: Bool
  }

  let glyphs: [Glyph]
  /// Each glyph's advance, the letter-spacing after it included.
  let advances: [CGFloat]
  /// The room before each on its line (the unit's 3).
  let leads: [CGFloat]
  /// From one line's top to the next's.
  let pitch: CGFloat

  var body: some View {
    FigureLines(pitch: pitch, advances: advances, leads: leads) {
      ForEach(Array(glyphs.enumerated()), id: \.offset) { _, glyph in
        // No tracking: FigureLines puts the letter-spacing in.
        Text(glyph.text)
          .font(glyph.font)
          .tracking(0)
          .foregroundStyle(glyph.unit ? theme.muted : theme.ink)
      }
    }
  }

  /// Each character's advance in one line of `text` set in `face`, as Core
  /// Text sets it: from where it starts to where the next one does.
  static func measure(_ text: String, face: CTFont) -> [CGFloat] {
    let attributed = NSAttributedString(
      string: text, attributes: [NSAttributedString.Key(rawValue: kCTFontAttributeName as String): face])
    let line = CTLineCreateWithAttributedString(attributed as CFAttributedString)
    var starts: [CGFloat] = []
    var index = 0
    for character in text {
      starts.append(CTLineGetOffsetForStringIndex(line, index, nil))
      index += character.utf16.count
    }
    starts.append(CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil)))
    return (0..<max(0, starts.count - 1)).map { starts[$0 + 1] - starts[$0] }
  }
}

/// `.figures-value` wrapped: each character where FigureWrap puts it, its
/// line `pitch` below the last (line-height 1), every character on its
/// line's baseline, which sits where the number's own line, centred on the
/// line's box, has it, as a browser's line box does.
struct FigureLines: Layout {
  var pitch: CGFloat
  var advances: [CGFloat]
  var leads: [CGFloat]

  private func spots(_ maxWidth: CGFloat) -> [FigureWrap.Spot] {
    FigureWrap.place(advances: advances.map { Double($0) }, leads: leads.map { Double($0) }, maxWidth: Double(maxWidth))
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let spots = spots(proposal.width ?? .infinity)
    var width: CGFloat = 0
    for (index, spot) in spots.enumerated() where index < subviews.count {
      width = max(width, CGFloat(spot.x) + subviews[index].sizeThatFits(.unspecified).width)
    }
    return CGSize(width: width, height: pitch * CGFloat(FigureWrap.lineCount(spots)))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard let first = subviews.first else { return }
    let spots = spots(max(bounds.width, proposal.width ?? 0))
    // The number's line, centred on the line's box: where its baseline is.
    let strut = first.dimensions(in: .unspecified)
    let baseline = (pitch - strut.height) / 2 + strut[VerticalAlignment.firstTextBaseline]
    for (index, spot) in spots.enumerated() where index < subviews.count {
      let own = subviews[index].dimensions(in: .unspecified)
      subviews[index].place(
        at: CGPoint(
          x: bounds.minX + CGFloat(spot.x),
          y: bounds.minY + CGFloat(spot.line) * pitch + baseline - own[VerticalAlignment.firstTextBaseline]),
        proposal: .unspecified)
    }
  }
}

/// The note, muted and small at 1.35, or nothing.
struct FigureNotePart: View {
  @Environment(\.virgaTheme) private var theme
  let item: FigureItem

  var body: some View {
    if let note = item.note {
      note
        .virgaText(size: theme.points(ThemeKit.figureNoteFontSize), lineHeight: ThemeKit.figureNoteLineHeight)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      Color.clear.frame(height: 0)
    }
  }
}

/// A figure's note: a change, a faint dot, and the words about it, as one
/// line of text ("+8.6% · 583 the 30 days before"), so in a narrow cell its
/// words wrap one at a time after the change. The dot belongs to the change
/// (4 after it, 6 before the words), so a wrapped note never starts with it.
/// `delta`: nil for no change shown, `.some(nil)` for "new".
///
/// A dashboard card's note (dashboards.css's `.stat-note`) has its words in
/// parts ("2.3 a day · 48% replies"), each drawn with the same dot after it
/// but the last: `FigureNote(deltaText:parts:)`. The words take the size
/// and the line height of the text round the note.
public struct FigureNote: View {
  @Environment(\.virgaTheme) private var theme
  private let deltaText: String?
  private let deltaTitle: String?
  private let parts: [String]
  private let followed: Bool

  /// - Parameters:
  ///   - deltaTitle: what the change is against, read by VoiceOver as a hint.
  public init(delta: Double??, deltaTitle: String? = nil, words: String? = nil) {
    self.deltaText = delta.map { ChartFormat.deltaText($0) }
    self.deltaTitle = deltaTitle
    self.parts = words.map { [$0] } ?? []
    self.followed = false
  }

  /// A change already in words ("+8.4%", "+12"), and the words in parts.
  /// - Parameter followed: something drawn after the note on its line (a
  ///   part that is more than words), so the last piece takes a dot too.
  public init(deltaText: String?, deltaTitle: String? = nil, parts: [String], followed: Bool = false) {
    self.deltaText = deltaText
    self.deltaTitle = deltaTitle
    self.parts = parts
    self.followed = followed
  }

  public var body: some View {
    line
      .accessibilityHint(deltaTitle ?? "")
  }

  private var line: Text {
    let size = theme.points(ThemeKit.figureNoteFontSize)
    var pieces: [Text] = []
    if let deltaText {
      pieces.append(
        Text(deltaText)
          .font(theme.font(size: theme.points(ThemeKit.deltaFontSize), weight: ThemeKit.deltaWeight))
          .foregroundStyle(theme.ink))
    }
    for part in parts {
      pieces.append(Text(part).foregroundStyle(theme.muted))
    }
    var out = Text("")
    for (index, piece) in pieces.enumerated() {
      out = out + piece
      if index < pieces.count - 1 || followed {
        // `.delta:not(:last-child)::after, .stat-sub:not(:last-child)::after
        // { content: '·'; margin: 0 6px 0 4px; color: var(--faint);
        // font-weight: 400 }`
        out = out + space(Measure.Figures.noteDotBefore, size: size)
        out = out + Text("·").font(theme.font(size: size)).foregroundStyle(theme.faint)
        out = out + space(Measure.Figures.noteDotAfter, size: size)
      }
    }
    return out
  }

  /// A space whose advance is `points`: the face's own space, tracked (not
  /// kerned: the tracking virgaText puts on the whole line would win over a
  /// kerning). It is a no-break space, as the web's margins are no break at
  /// all: the change, its dot and the first word stay on one line, and the
  /// words after wrap.
  private func space(_ points: CGFloat, size: CGFloat) -> Text {
    Text("\u{00A0}")
      .font(theme.font(size: size))
      .tracking(points - theme.spaceWidth(size: size))
  }
}

/// `.delta`: the change in ink, 600, with its sign. `plain` takes the size
/// of the words around it.
public struct DeltaView: View {
  @Environment(\.virgaTheme) private var theme
  private let pct: Double?
  private let title: String?
  private let plain: Bool

  /// - Parameters:
  ///   - pct: the change in percent, or nil for "new" (nothing before).
  ///   - title: what it was compared with, read by VoiceOver as a hint.
  public init(pct: Double?, title: String? = nil, plain: Bool = false) {
    self.pct = pct
    self.title = title
    self.plain = plain
  }

  public var body: some View {
    let label = Text(ChartFormat.deltaText(pct)).foregroundStyle(theme.ink).lineLimit(1)
    if plain {
      label.fontWeight(.semibold)
        .accessibilityHint(title ?? "")
    } else {
      label
        .virgaText(size: theme.points(ThemeKit.deltaFontSize), weight: ThemeKit.deltaWeight)
        .accessibilityHint(title ?? "")
    }
  }
}

#Preview("Figures") {
  VirgaPreviewHost {
    FiguresView(
      [
        FigureItem(label: "Followers", value: .number(4810), note: AnyView(DeltaView(pct: 8.6))),
        FigureItem(label: "Posts", value: .number(1031)),
        FigureItem(label: "Engagement rate", value: .text("3.2%")),
      ], label: "This period")
    .padding()
  }
}
#endif
