// Ports src/settings/SettingsPage.jsx
// Ports src/settings/settings.css
// Ports src/posting/ui/SettingsParts.jsx (SettingsCard and SettingsRow: SettingsSectionView and SettingsRow here)
//
// Settings: each section is a page of its own. Beside the sidebar the
// sidebar lists them and the bare address opens the first; on a phone
// /settings is that list. A section is rows under a rule in ink: what a
// setting is and a line about it at the left, its control at the right on
// the name's first line (or on a line of its own under them, `block`); from
// 760 down the control goes under the words, except a switch or a word or
// two of state.
//
// Here now: Account (AccountsSettings), Data and sync (DataSection.swift),
// Dashboards (DashboardsSection.swift), Posting (PostingSettingsSection.swift),
// Appearance (the sky, the accent with its swatches, contrast, density, the
// sidebar, numbers and dates), Permissions, and About (with the Terms and
// the Privacy Policy, and when the repo was last read). Appearance's live
// sky waits for the hillside.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaSession

public struct SettingsPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.shellChrome) private var chrome
  private let section: String?

  public init(section: String?) {
    self.section = section
  }

  public var body: some View {
    let named = SettingsSections.sections.first { Optional($0.key).jsEquals(section) }
    if chrome == .phone && named == nil {
      SettingsIndex()
    } else {
      let current = named ?? SettingsSections.sections[0]
      VirgaPage(PageHeaderModel(title: current.label, sub: current.desc, crumbs: [Crumb("Settings", to: "/settings")])) {
        sectionBody(current.key)
      }
    }
  }

  @ViewBuilder
  private func sectionBody(_ key: String) -> some View {
    switch key {
    case "account": AccountsSettings()
    case "data": DataSection()
    case "dashboards": DashboardsSection()
    case "posting": PostingSettingsSection()
    case "appearance": AppearanceSection()
    case "permissions": PermissionsSection()
    case "about": AboutSection()
    default:
      Text(Unported.section)
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
        .accessibilityIdentifier("unported")
    }
  }
}

/// The sections as a list, for a phone: each a row to press, with its line under it.
struct SettingsIndex: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate

  var body: some View {
    VirgaPage(PageHeaderModel(title: "Settings", sub: "For whoever is at this browser, and for the account that’s open.")) {
      VStack(spacing: 0) {
        ForEach(SettingsSections.sections) { section in
          SettingsIndexItem(label: section.label, desc: section.desc) { navigate("/settings/\(section.key)") }
            .accessibilityIdentifier("settings-\(section.key)")
        }
      }
      .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
    }
  }
}

/// `.settings-index-item`: a row to press, its name and a line under it,
/// the chevron centred on the two. About's documents are rows of the same
/// kind, with one line.
struct SettingsIndexItem: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  let desc: String?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: Measure.Settings.indexGap) {
        VStack(alignment: .leading, spacing: Measure.Settings.indexTextGap) {
          Text(label)
            .virgaText(.textMd, weight: VirgaWeight.medium)
            .foregroundStyle(theme.ink)
          if let desc {
            Text(desc)
              .virgaText(.textSm)
              .foregroundStyle(theme.muted)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: Glyph.chevronRight)
          .font(.system(size: Measure.Accounts.rememberedChevron))
          .foregroundStyle(theme.muted)
      }
      .padding(.vertical, desc == nil ? theme.rowPadLg : Measure.Settings.indexPadding)
      .frame(minHeight: desc == nil ? nil : Measure.Settings.indexHeight)
      .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm), placement: .inside)
  }
}

// MARK: - A section, and a row

/// A band of a settings page: a heading, then its rows under a rule in ink
/// (red, for something that can't be taken back). Without a title it is
/// the rows alone, under the rule.
struct SettingsSectionView<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  let title: String?
  let sub: AnyView?
  let action: AnyView?
  let danger: Bool
  let content: Content

  init(title: String? = nil, subView: AnyView? = nil, action: AnyView? = nil, danger: Bool = false, @ViewBuilder content: () -> Content) {
    self.title = title
    self.sub = subView
    self.action = action
    self.danger = danger
    self.content = content()
  }

  init(title: String?, sub: String?, action: AnyView? = nil, danger: Bool = false, @ViewBuilder content: () -> Content) {
    self.init(title: title, subView: sub.map { AnyView(Text($0)) }, action: action, danger: danger, content: content)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let title {
        VStack(alignment: .leading, spacing: theme.points(ThemeKit.cardSubSpaceAbove)) {
          HStack(alignment: .firstTextBaseline, spacing: theme.space4) {
            Text(title)
              .virgaText(
                size: theme.points(ThemeKit.cardTitleFontSize), weight: ThemeKit.cardTitleWeight, tracking: ThemeKit.cardTitleTracking)
              .foregroundStyle(theme.ink)
              .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if let action { action }
          }
          if let sub {
            sub
              .virgaText(size: theme.points(ThemeKit.cardSubFontSize))
              .foregroundStyle(theme.color(ThemeKit.cardSubInk))
              .fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: theme.measure, alignment: .leading)
          }
        }
        .padding(.bottom, theme.space3)
      }
      SettingsBody(danger: danger) { content }
    }
  }
}

/// `.settings-section-body`: the rows, under a rule in ink.
struct SettingsBody<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  let danger: Bool
  let content: Content

  init(danger: Bool = false, @ViewBuilder content: () -> Content) {
    self.danger = danger
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      content
    }
    .overlay(alignment: .top) { Rectangle().fill(danger ? theme.danger : theme.rule).frame(height: 1) }
  }
}

/// What sits in a settings row's control place, which says how far it is
/// drawn up to centre it on the name's first line (`.settings-row-control`'s
/// margin-top on a touch screen).
enum SettingsControlKind {
  /// A button or a field: 40 tall on a touch screen.
  case button
  /// A Segmented: its keys are 44.
  case segmented
  /// A switch: 24, centred in its 44-point target.
  case toggle
  /// A badge, or a word or two of state: already on the name's line.
  case state
  /// Prose in the control's place: read from the top of its column.
  case prose
}

extension Measure.Settings {
  /// `.settings-row:has(> .settings-row-control > :is(.switch, .badge,
  /// .settings-row-state):only-child) { gap: 2px 24px }`, from 760 down.
  static let compactColumnGap: CGFloat = 24
}

/// `.settings-row`: a setting's name and the line about it, and its control.
struct SettingsRow<Control: View>: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  let hint: AnyView?
  let block: Bool
  /// A switch or a word or two of state: kept on the name's line on a phone.
  let compactControl: Bool
  let kind: SettingsControlKind
  let control: Control

  /// - Parameter kind: what the control is; a switch where `compactControl`
  ///   is set, else a button or a field.
  init(
    label: String, hint: AnyView? = nil, block: Bool = false, compactControl: Bool = false, kind: SettingsControlKind? = nil,
    @ViewBuilder control: () -> Control
  ) {
    self.label = label
    self.hint = hint
    self.block = block
    self.compactControl = compactControl
    self.kind = kind ?? (compactControl ? .toggle : .button)
    self.control = control()
  }

  init(
    label: String, hint: String?, block: Bool = false, compactControl: Bool = false, kind: SettingsControlKind? = nil,
    @ViewBuilder control: () -> Control
  ) {
    self.init(
      label: label, hint: hint.map { AnyView(Text($0)) }, block: block, compactControl: compactControl, kind: kind, control: control)
  }

  var body: some View {
    Group {
      if block || (theme.isTablet && !compactControl) {
        VStack(alignment: .leading, spacing: Measure.Settings.rowGap) {
          words
          control
        }
      } else if theme.isTablet {
        // A switch or a state stays on the name's line at the right; the
        // line about it runs under both.
        VStack(alignment: .leading, spacing: Measure.Settings.rowTextGap) {
          HStack(alignment: .top, spacing: Measure.Settings.compactColumnGap) {
            name
            Spacer(minLength: 0)
            control.padding(.top, rise)
          }
          if let hint {
            hintView(hint)
              .frame(maxWidth: theme.measure, alignment: .leading)
          }
        }
      } else {
        HStack(alignment: .top, spacing: Measure.Settings.rowColumnGap) {
          words
          Spacer(minLength: 0)
          control.padding(.top, rise)
        }
      }
    }
    .padding(.vertical, theme.rowPadLg)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }

  /// `--settings-line`: the name's first line, `--text-md` × 1.45.
  private var nameLine: CGFloat {
    theme.textMd * CGFloat(Measure.Settings.labelLineHeight)
  }

  /// The control's margin-top: `(--settings-line − its height) / 2`, which
  /// draws a control taller than the line up to centre it on the name.
  private var rise: CGFloat {
    switch kind {
    case .button: return (nameLine - theme.points(ThemeKit.touchButtonHeight)) / 2
    case .segmented: return (nameLine - theme.points(ThemeKit.touchSegmentedKeyHeight)) / 2
    // The 24-point switch is laid out in its 44-point target, centred.
    case .toggle: return (nameLine - Measure.Touch.target) / 2
    case .state, .prose: return 0
    }
  }

  private var name: some View {
    Text(label)
      .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Settings.labelLineHeight)
      .foregroundStyle(theme.ink)
  }

  private func hintView(_ hint: AnyView) -> some View {
    hint
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var words: some View {
    VStack(alignment: .leading, spacing: Measure.Settings.rowTextGap) {
      name
      if let hint {
        hintView(hint)
      }
    }
    .frame(maxWidth: theme.measure, alignment: .leading)
  }
}

/// `.settings-text`: prose in a section, with a row's air and a hairline.
struct SettingsText: View {
  @Environment(\.virgaTheme) private var theme
  let text: Text

  init(_ text: Text) {
    self.text = text
  }

  init(_ string: String) {
    self.text = Text(string)
  }

  var body: some View {
    text
      .virgaText(.textBase)
      .foregroundStyle(theme.ink2)
      .tint(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.measure, alignment: .leading)
      .padding(.vertical, theme.rowPadLg)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

// MARK: - Appearance

struct AppearanceSection: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.shellChrome) private var chrome
  @Environment(PreferencesModel.self) private var preferences

  static let skyNames: [SkyChoice: String] = [.clock: "Follows the clock", .dawn: "Dawn", .day: "Day", .dusk: "Dusk", .night: "Night"]
  static let skyGlyphs: [SkyChoice: String] = [.clock: Glyph.clock, .dawn: Glyph.dawn, .day: Glyph.day, .dusk: Glyph.dusk, .night: Glyph.night]
  static let accentNames: [Preferences.Accent: String] = [
    .blue: "Blue", .violet: "Violet", .teal: "Teal", .amber: "Amber", .rose: "Rose", .graphite: "Graphite",
  ]
  static let weekStartNames: [Int: String] = [0: "Sunday", 1: "Monday", 6: "Saturday"]

  var body: some View {
    SettingsBody {
      SettingsRow(
        label: "Sky",
        hint:
          "The sky behind every page. Let it follow the clock, or keep it where you leave it. Night is also the dark theme, and a device set to dark stays on it.",
        block: true
      ) {
        SkyChoices()
      }
      SettingsRow(
        label: "Accent",
        hint: "The colour of your data, and of whatever is selected. Each pair is checked for contrast and for colour-blind eyes, under every sky.",
        block: true
      ) {
        AccentChoices()
      }
      SettingsRow(
        label: "Contrast",
        hint:
          "High darkens the words and the rules, takes the sky away and thickens the focus ring. Match system follows your device’s own setting.",
        kind: .segmented
      ) {
        Segmented(
          label: "Contrast",
          options: [
            SegmentedOption(Preferences.ContrastChoice.system, "Match system"),
            SegmentedOption(Preferences.ContrastChoice.normal, "Standard"),
            SegmentedOption(Preferences.ContrastChoice.high, "High"),
          ],
          selection: preferences.prefs.contrast
        ) { preferences.setPref(\.contrast, $0) }
        .accessibilityIdentifier("contrast")
      }
      SettingsRow(label: "Density", hint: "Compact fits more on a screen.", kind: .segmented) {
        Segmented(
          label: "Density",
          options: [
            SegmentedOption(Preferences.Density.comfortable, "Comfortable"), SegmentedOption(Preferences.Density.compact, "Compact"),
          ],
          selection: preferences.prefs.density
        ) { preferences.setPref(\.density, $0) }
      }
      // A phone, or a narrow tablet, has no sidebar to fold.
      if chrome != .phone {
        SettingsRow(
          label: "Sidebar", hint: "Folded, it’s a rail of icons, which gives the page more room. The button at its top does the same.",
          kind: .segmented
        ) {
          Segmented(
            label: "Sidebar",
            options: [SegmentedOption(Preferences.Sidebar.expanded, "Open"), SegmentedOption(Preferences.Sidebar.collapsed, "Folded")],
            selection: preferences.prefs.sidebar
          ) { preferences.setPref(\.sidebar, $0) }
        }
      }
      formats
    }
  }

  /// "Germany" for 'en-DE'; the tag itself where it can't be named.
  static func regionName(_ tag: String) -> String {
    guard let region = LanguageTag(tag)?.region, let name = Locale(identifier: "en").localizedString(forRegionCode: region) else {
      return tag
    }
    return name
  }

  private var formats: some View {
    let active = AppLocale.activeLocale()
    let sample = AppLocale.localeSample(active)
    let regionStart = Self.weekStartNames[AppLocale.regionWeekStart(active)] ?? ""
    let system = AppLocale.systemLocale(Locale.preferredLanguages)
    let regions: [(Preferences.LocaleChoice, String)] = AppLocale.localeChoices.compactMap { tag in
      guard let choice = Preferences.LocaleChoice(rawValue: tag) else { return nil }
      return (choice, "\(Self.regionName(tag)): \(AppLocale.localeSample(tag))")
    }
    let localeOptions: [(Preferences.LocaleChoice, String)] =
      [(Preferences.LocaleChoice.system, "This browser’s region (\(Self.regionName(system)))")] + regions
    let weekOptions: [(Preferences.WeekStart, String)] = [
      (Preferences.WeekStart.system, "Week starts as in this region (\(regionStart))"),
      (Preferences.WeekStart.monday, "Week starts Monday"),
      (Preferences.WeekStart.sunday, "Week starts Sunday"),
      (Preferences.WeekStart.saturday, "Week starts Saturday"),
    ]
    return SettingsRow(
      label: "Numbers and dates",
      hint: AnyView(
        VStack(alignment: .leading, spacing: Measure.Settings.sampleSpaceAbove) {
          Text("Virga’s words are English. These choose how its figures, dates and times are written, and the day a week starts on.")
          Text(sample).foregroundStyle(theme.ink2).accessibilityIdentifier("locale-sample")
        }),
      block: true
    ) {
      SettingsSelects(
        basis: Measure.Settings.selectMinWidth, maxWidth: theme.isTablet ? .infinity : Measure.Settings.selectMaxWidth,
        spacing: Measure.Settings.controlGap
      ) {
        SettingsSelect(label: "Number and date format", options: localeOptions, selection: preferences.prefs.locale) {
          preferences.setPref(\.locale, $0)
        }
        SettingsSelect(label: "Week starts on", options: weekOptions, selection: preferences.prefs.weekStart) {
          preferences.setPref(\.weekStart, $0)
        }
      }
    }
  }
}

extension Measure.Settings {
  /// `select.input`'s chevron: two 5-point halves, 10 across, in --ink-2.
  static let selectChevron: CGFloat = 10
}

/// `.settings-row-control > select.input`: the chosen option's words in ink
/// on one line, the chevron at its right, in the field's chrome; the options
/// in the system's menu, the chosen one ticked.
struct SettingsSelect<Value: Hashable>: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  let options: [(Value, String)]
  let selection: Value
  let onChange: (Value) -> Void

  var body: some View {
    let current = options.first { $0.0 == selection }?.1 ?? ""
    Menu {
      Picker(label, selection: Binding(get: { selection }, set: { onChange($0) })) {
        ForEach(Array(options.enumerated()), id: \.offset) { _, option in
          Text(option.1).tag(option.0)
        }
      }
    } label: {
      // The chrome is the label's, so the whole field opens the menu.
      SelectFace(text: current)
        .virgaField()
    }
    .accessibilityLabel(label)
    .accessibilityValue(current)
  }
}

/// What a closed select shows: its words, cut short on one line, and the
/// chevron at the far end.
struct SelectFace: View {
  @Environment(\.virgaTheme) private var theme
  let text: String

  var body: some View {
    HStack(spacing: theme.space2) {
      Text(text)
        .lineLimit(1)
        .truncationMode(.tail)
        .foregroundStyle(theme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
      Image(systemName: "chevron.down")
        .font(.system(size: Measure.Settings.selectChevron, weight: .semibold))
        .foregroundStyle(theme.ink2)
        .accessibilityHidden(true)
    }
    .contentShape(Rectangle())
  }
}

/// The selects of a row, as `flex: 1 1 220px; max-width: 320px` lays them
/// out in a wrapping row 8 apart: as many to a line as fit at 220, each
/// taking an even share of its line up to 320 (the whole line from 760
/// down), from the left.
struct SettingsSelects: Layout {
  var basis: CGFloat
  var maxWidth: CGFloat
  var spacing: CGFloat

  private func lines(_ count: Int, width: CGFloat) -> [[Int]] {
    var out: [[Int]] = []
    var line: [Int] = []
    var used: CGFloat = 0
    for index in 0..<count {
      let extra = line.isEmpty ? basis : spacing + basis
      if !line.isEmpty && used + extra > width {
        out.append(line)
        line = [index]
        used = basis
      } else {
        line.append(index)
        used += extra
      }
    }
    if !line.isEmpty { out.append(line) }
    return out
  }

  private func share(_ count: Int, width: CGFloat) -> CGFloat {
    let even = (width - spacing * CGFloat(max(0, count - 1))) / CGFloat(max(1, count))
    return max(0, min(even, maxWidth))
  }

  private func available(_ proposal: ProposedViewSize, _ count: Int) -> CGFloat {
    if let proposed = proposal.width, proposed.isFinite { return proposed }
    return basis * CGFloat(count) + spacing * CGFloat(max(0, count - 1))
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let across = available(proposal, subviews.count)
    var height: CGFloat = 0
    var widest: CGFloat = 0
    for (row, line) in lines(subviews.count, width: across).enumerated() {
      let each = share(line.count, width: across)
      let tallest = line.map { subviews[$0].sizeThatFits(ProposedViewSize(width: each, height: nil)).height }.max() ?? 0
      height += tallest + (row > 0 ? spacing : 0)
      widest = max(widest, each * CGFloat(line.count) + spacing * CGFloat(max(0, line.count - 1)))
    }
    return CGSize(width: widest, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for line in lines(subviews.count, width: bounds.width) {
      let each = share(line.count, width: bounds.width)
      let tallest = line.map { subviews[$0].sizeThatFits(ProposedViewSize(width: each, height: nil)).height }.max() ?? 0
      var x = bounds.minX
      for index in line {
        subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(width: each, height: tallest))
        x += each + spacing
      }
      y += tallest + spacing
    }
  }
}

/// The sky's tiles: the wash each paints, with the picture of its hour on
/// it; the chosen one ringed in the accent. A radio group: the arrows, Home
/// and End on a hardware keyboard move and choose (radioKeys.js).
struct SkyChoices: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences
  @FocusState private var focused: Int?

  var body: some View {
    let choices = Sky.skyChoices
    let chosen = choices.firstIndex(of: preferences.prefs.sky) ?? -1
    ChoiceGrid(
      minWidth: Measure.Settings.skyMinWidth, maxWidth: Measure.Settings.skyMaxWidth, spacing: Measure.Settings.skyColumnGap,
      rowSpacing: Measure.Settings.skyRowGap, columns: theme.isPhone ? Measure.Settings.phoneChoiceColumns : nil
    ) {
      ForEach(Array(choices.enumerated()), id: \.offset) { index, choice in
        SkyTile(choice: choice, chosen: index == chosen, place: RadioKeyPress.place(index, of: choices.count)) {
          preferences.setPref(\.sky, choice)
        }
        .focused($focused, equals: index)
        .onKeyPress(keys: RadioKeyPress.keys) { press in
          guard let target = RadioKeys.radioKeyTarget(RadioKeyPress.name(press.key), chosen, choices.count) else { return .ignored }
          preferences.setPref(\.sky, choices[target])
          focused = target
          return .handled
        }
      }
    }
    .frame(maxWidth: Measure.Settings.skyMaxWidth, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Sky")
  }
}

struct SkyTile: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences
  let choice: SkyChoice
  let chosen: Bool
  /// "2 of 5": its place in the group, for VoiceOver.
  let place: String
  let action: () -> Void

  var body: some View {
    let swatch = Measure.Settings.skySwatch(choice)
    let stops: [Gradient.Stop] = choice == .clock
      ? zip(swatch.stops, Measure.Settings.clockStops).map { Gradient.Stop(color: $0.0.color, location: $0.1) }
      : [Gradient.Stop(color: swatch.stops[0].color, location: 0), Gradient.Stop(color: swatch.stops[1].color, location: 1)]
    let gradient = choice == .clock
      ? LinearGradient(stops: stops, startPoint: UnitPoint(x: 0, y: 0.32), endPoint: UnitPoint(x: 1, y: 0.68))
      : LinearGradient(stops: stops, startPoint: .top, endPoint: .bottom)
    let shape = RoundedRectangle(cornerRadius: Measure.Settings.skySwatchRadius)
    let name = AppearanceSection.skyNames[choice] ?? choice.rawValue
    let now = AppearanceSection.skyNames[SkyChoice(rawValue: preferences.effectiveSky.rawValue) ?? .day] ?? ""
    // What the clock comes to at the moment, under its tile, and in its name.
    let nowLine: String? = choice == .clock && chosen ? (preferences.systemDark ? "Night, as your device asks" : "\(now) now") : nil
    return Button(action: action) {
      VStack(alignment: .leading, spacing: Measure.Settings.skyChoiceGap) {
        ZStack {
          shape.fill(gradient)
          shape.strokeBorder(theme.line, lineWidth: 1)
          Image(systemName: AppearanceSection.skyGlyphs[choice] ?? Glyph.day)
            .font(.system(size: Measure.Settings.skyIcon))
            .foregroundStyle(swatch.ink.color)
        }
        .frame(height: theme.isPhone ? Measure.Settings.phoneSkySwatchHeight : Measure.Settings.skySwatchHeight)
        .overlay {
          if chosen {
            shape
              .inset(by: -(Measure.Settings.ringGap + Measure.Settings.ringWidth))
              .strokeBorder(theme.accent, lineWidth: Measure.Settings.ringWidth)
          }
        }
        VStack(alignment: .leading, spacing: 0) {
          Text(name)
            .virgaText(.textBase, weight: chosen ? VirgaWeight.semibold : VirgaWeight.medium, lineHeight: Measure.Settings.skyLineHeight)
            .foregroundStyle(theme.ink)
          if let nowLine {
            Text(nowLine)
              .virgaText(.textSm, lineHeight: Measure.Settings.skyLineHeight)
              .foregroundStyle(theme.muted)
          }
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(shape)
    .accessibilityLabel(nowLine.map { "\(name), \($0)" } ?? name)
    .accessibilityValue(place)
    .accessibilityAddTraits(chosen ? [.isSelected] : [])
    .accessibilityIdentifier("sky-\(choice.rawValue)")
  }
}

/// The accents: each a disc of its own colour in the page's own sky and
/// contrast (ThemeTokens.swatch), the chosen one ringed. A radio group, as
/// the sky's is.
struct AccentChoices: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences
  @FocusState private var focused: Int?

  var body: some View {
    let choices = Preferences.accentChoices
    let chosen = choices.firstIndex(of: preferences.prefs.accent) ?? -1
    ChoiceGrid(
      minWidth: Measure.Settings.accentMinWidth, maxWidth: Measure.Settings.accentMaxWidth, spacing: Measure.Settings.accentGap,
      rowSpacing: Measure.Settings.accentGap, columns: theme.isPhone ? Measure.Settings.phoneChoiceColumns : nil
    ) {
      ForEach(Array(choices.enumerated()), id: \.offset) { index, accent in
        AccentChoice(accent: accent, chosen: index == chosen, place: RadioKeyPress.place(index, of: choices.count)) {
          preferences.setPref(\.accent, accent)
        }
        .focused($focused, equals: index)
        .onKeyPress(keys: RadioKeyPress.keys) { press in
          guard let target = RadioKeys.radioKeyTarget(RadioKeyPress.name(press.key), chosen, choices.count) else { return .ignored }
          preferences.setPref(\.accent, choices[target])
          focused = target
          return .handled
        }
      }
    }
    .frame(maxWidth: Measure.Settings.accentMaxWidth, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Accent")
  }
}

struct AccentChoice: View {
  @Environment(\.virgaTheme) private var theme
  let accent: Preferences.Accent
  let chosen: Bool
  /// "2 of 6": its place in the group, for VoiceOver.
  let place: String
  let action: () -> Void

  var body: some View {
    let swatch = ThemeTokens.swatch(accent, in: theme.attributes, viewportWidth: Double(theme.windowWidth)).accent.color
    let name = AppearanceSection.accentNames[accent] ?? accent.rawValue
    let side = Measure.Settings.accentSwatch
    return Button(action: action) {
      HStack(spacing: Measure.Settings.accentChoiceGap) {
        Circle()
          .fill(swatch)
          .frame(width: side, height: side)
          .overlay {
            if chosen {
              Circle()
                .inset(by: -(Measure.Settings.ringGap + Measure.Settings.ringWidth))
                .strokeBorder(swatch, lineWidth: Measure.Settings.ringWidth)
            }
          }
        Text(name)
          .virgaText(.textBase, weight: chosen ? VirgaWeight.semibold : VirgaWeight.regular)
          .foregroundStyle(chosen ? theme.ink : theme.ink2)
          .lineLimit(1)
        Spacer(minLength: 0)
      }
      .padding(.leading, Measure.Settings.accentPaddingLeading)
      .padding(.trailing, Measure.Settings.accentPaddingTrailing)
      .frame(minHeight: theme.isPhone ? Measure.Settings.phoneAccentChoiceHeight : Measure.Settings.accentChoiceHeight)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(Capsule())
    .accessibilityLabel(name)
    .accessibilityValue(place)
    .accessibilityAddTraits(chosen ? [.isSelected] : [])
    .accessibilityIdentifier("accent-\(accent.rawValue)")
  }
}

extension Measure.Settings {
  /// `.sky-choices`, `.accent-choices { grid-template-columns: repeat(3,
  /// minmax(0, 1fr)) }` from 560 down.
  static let phoneChoiceColumns = 3
}

/// A radio group's keys on a hardware keyboard, by the names radioKeys.js
/// reads (`event.key`).
enum RadioKeyPress {
  static let keys: Set<KeyEquivalent> = [.upArrow, .downArrow, .leftArrow, .rightArrow, .home, .end]

  static func name(_ key: KeyEquivalent) -> String {
    switch key {
    case .upArrow: return "ArrowUp"
    case .downArrow: return "ArrowDown"
    case .leftArrow: return "ArrowLeft"
    case .rightArrow: return "ArrowRight"
    case .home: return "Home"
    case .end: return "End"
    default: return ""
    }
  }

  /// "2 of 5".
  static func place(_ index: Int, of count: Int) -> String {
    "\(index + 1) of \(count)"
  }
}

/// `grid-template-columns: repeat(auto-fill, minmax(min, 1fr))` over the
/// grid's own width, held to `maxWidth`: as many columns as fit at `min`,
/// sharing the width evenly; or `columns` of them (a phone's three). Each
/// choice sits at the top of its row.
struct ChoiceGrid: Layout {
  var minWidth: CGFloat
  var maxWidth: CGFloat
  var spacing: CGFloat
  var rowSpacing: CGFloat
  var columns: Int?

  private func gridWidth(_ proposal: ProposedViewSize) -> CGFloat {
    if let proposed = proposal.width, proposed.isFinite { return min(proposed, maxWidth) }
    return maxWidth
  }

  private func columnCount(_ across: CGFloat) -> Int {
    if let columns { return max(1, columns) }
    return max(1, Int(((across + spacing) / (minWidth + spacing)).rounded(.down)))
  }

  private func cellWidth(_ across: CGFloat, _ n: Int) -> CGFloat {
    max(0, (across - spacing * CGFloat(n - 1)) / CGFloat(n))
  }

  private func rowHeights(_ subviews: Subviews, _ n: Int, _ side: CGFloat) -> [CGFloat] {
    stride(from: 0, to: subviews.count, by: n).map { start -> CGFloat in
      let end = min(start + n, subviews.count)
      return (start..<end).map { subviews[$0].sizeThatFits(ProposedViewSize(width: side, height: nil)).height }.max() ?? 0
    }
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let across = gridWidth(proposal)
    let n = columnCount(across)
    let heights = rowHeights(subviews, n, cellWidth(across, n))
    let tall = heights.reduce(0, +) + rowSpacing * CGFloat(max(0, heights.count - 1))
    return CGSize(width: across, height: tall)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let across = min(bounds.width, maxWidth)
    let n = columnCount(across)
    let side = cellWidth(across, n)
    var y = bounds.minY
    for (row, height) in rowHeights(subviews, n, side).enumerated() {
      for column in 0..<n {
        let index = row * n + column
        guard index < subviews.count else { break }
        let x = bounds.minX + CGFloat(column) * (side + spacing)
        subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(width: side, height: nil))
      }
      y += height + rowSpacing
    }
  }
}

// MARK: - Permissions

struct PermissionsSection: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app

  var body: some View {
    let host = AppConfig.backendHost(app.flags.backendURL)
    VStack(alignment: .leading, spacing: theme.sectionGap) {
      SettingsSectionView(title: "What signing in lets Virga do", sub: "It asks for these and nothing else.") {
        ForEach(AppConfig.permissionGroups, id: \.key) { group in
          PermissionRow(group: group)
        }
      }
      SettingsSectionView(title: "What it can’t do", sub: nil) {
        SettingsText(
          "It can’t like, repost, block or mute anyone, change your profile, or read your messages. It posts, replies and deletes posts only when you ask it to, and never edits a post once it’s published. With Defense’s lists on, it adds people to a list you made only when you approve them, and never anyone you follow. Everything else it reads is public and fetched without your session."
        )
      }
      SettingsSectionView(title: "Where the sign-in is kept", sub: nil) {
        SettingsText(
          Text(
            AttributedString(
              "A browser session stays in this browser and goes straight to your account’s server. A long session is held by Virga’s server at \(host), which makes the same requests on your behalf, and is what lets a scheduled post go out while the browser is closed. Virga’s server is used only for long sessions and the features that need one, and for the record that an account agreed to the terms, which either kind of session sends it; your archive never goes there. Settings › "
            ) + pageLink("Account", to: "/settings/account") + AttributedString(" says which kind each account has.")))
      }
    }
  }
}

struct PermissionRow: View {
  @Environment(\.virgaTheme) private var theme
  let group: AppConfig.PermissionGroup

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Settings.codesSpaceAbove) {
      (Text(group.title).font(theme.font(.textBase, weight: VirgaWeight.semibold)).foregroundStyle(theme.ink) + Text(" ") + Text(group.text))
        .virgaText(.textBase)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
      // The resource and its name, on a line of their own.
      Text(group.tokens.map { String($0.split(separator: "?", maxSplits: 1).first ?? "") }.joined(separator: " "))
        .font(theme.codeFont(around: theme.textXs))
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: theme.measure, alignment: .leading)
    .padding(.vertical, theme.rowPadLg)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

// MARK: - About

struct AboutSection: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @Environment(SessionModel.self) private var session
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @State private var reading: String?

  /// When this device noted that the account agreed to the current documents.
  private var agreed: TermsAcceptanceNote? {
    let entry = Acceptance.readAcceptance(app.stores.keyValue, session.did)
    return Acceptance.coversCurrent(entry) ? entry : nil
  }

  var body: some View {
    let host = AppConfig.backendHost(app.flags.backendURL)
    VStack(alignment: .leading, spacing: theme.sectionGap) {
      SettingsSectionView(title: "About Virga", sub: nil) {
        SettingsText(
          "Analytics for your Bluesky account and the rest of your atproto repo, worked out in your browser from your own data, and a place to write and schedule posts. The archive is read from your PDS, Bluesky’s public API, the PLC directory and Constellation, and kept in this browser; it is never sent to Virga’s server. That server and its database are used only for long sessions, for the features that run while the browser is closed, and for the record that an account agreed to the terms."
        )
      }
      SettingsSectionView(
        title: "Terms and privacy", sub: "What you agreed to when this account signed in, and what Virga does with information about you."
      ) {
        ForEach(LegalDocuments.all, id: \.key) { document in
          SettingsIndexItem(label: document.title, desc: nil) { reading = document.key }
            .accessibilityIdentifier("about-\(document.key)")
        }
        if let agreed {
          Text(
            "This account agreed to version \(agreed.version) of both\(agreed.at.map { " on \(Time.formatDateShort($0))" } ?? "")."
          )
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .padding(.top, theme.points(ThemeKit.cardCaptionSpaceAbove))
        }
      }
      SettingsSectionView(title: "Where the data comes from", sub: nil) {
        ForEach(Self.sources(host: host), id: \.0) { source in
          SourceRow(name: source.0, text: source.1)
        }
        if let read = archive?.data.meta.repo?.syncedAt, read != 0, read.isFinite {
          Text("Your repo was last read \(Time.relativeTime(read, now: SyncStatus.now())), on \(Time.formatDateShort(read)).")
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
            .padding(.top, theme.points(ThemeKit.cardCaptionSpaceAbove))
            .accessibilityIdentifier("about-repo-read")
        }
      }
    }
    .legalDialog($reading)
  }

  static func sources(host: String) -> [(String, String)] {
    [
      ("Your PDS", ": your whole repo in one download, and your follow records."),
      ("Bluesky’s public API", ": your posts and their counts, profiles, lists, and when accounts were last active."),
      ("Bluesky, signed in as you", ": your follower list and your notifications, and what you post."),
      (
        "Virga’s server (\(host))",
        ", for an account with a long session: the sign-in, and the signed-in requests, which it passes on to your account. Scheduled posts and post timers are kept there, and stay on record after they run; a scheduled post’s pictures are deleted once it goes out."
      ),
      (
        "Bluesky’s link card service (cardyb.bsky.app)",
        ", while you write a post with a link: the page’s title, description and picture, for the card under the post."
      ),
      ("Bluesky’s video service (video.bsky.app)", ", when you post a video: the video, which it processes before the post goes out."),
      (
        "The post adviser and alt text",
        ", only when you turn them on or ask: the post (or the image) goes to Virga’s server, which passes it to an AI model and sends back what it made of it."
      ),
      ("Constellation", ": who blocks you, and which lists you’re on."),
      (
        "Signing in",
        ": the handle you type goes to Bluesky’s public API, to suggest accounts and to find yours. Where the account signs in is read from the PLC directory and its own server. The Privacy Policy lists every lookup a sign-in makes."
      ),
      ("The PLC directory", ": your DID document and its history."),
    ]
  }
}

struct SourceRow: View {
  @Environment(\.virgaTheme) private var theme
  let name: String
  let text: String

  var body: some View {
    (Text(name).font(theme.font(.textBase, weight: VirgaWeight.semibold)).foregroundStyle(theme.ink) + Text(text))
      .virgaText(.textBase)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.measure, alignment: .leading)
      .padding(.vertical, theme.rowPadLg)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}
#endif
