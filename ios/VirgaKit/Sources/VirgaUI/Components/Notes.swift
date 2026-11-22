// Ports src/styles/controls.css (empty states and notes: .empty, .empty-block, .note, .callout, .disclosure, .progress)
//
//   Callout      something to know before going on, with a rule down its
//                side (2 points of --line-2); a warning or a failure has
//                its colour for the rule and the words, and its wash, since
//                it has to be found. A failure of words alone,
//                `Callout(tone: .danger, words)`, is the web's
//                `role="alert"`: VoiceOver reads it out when it appears
//                and when its words change. One built round its own
//                content leaves that to its caller (`alert:`).
//   EmptyState   one sentence, and at most one way to change that, a quiet
//                button. No heading and no ink.
//   NoteText     prose about a setting: muted, small, held to the measure.
//   ProgressLine a 3-point line in --line, filled in the accent; with no
//                value a 35% fill slides across, for ever (still, under
//                Reduce Motion).
//   Disclosure   a plain details/summary: a sentence to open, its chevron
//                turning as it does.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public enum CalloutTone: Sendable {
  case plain, warn, danger
}

public struct Callout<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let tone: CalloutTone
  private let systemImage: String?
  private let alert: String?
  private let content: Content

  /// - Parameter alert: words to read out as the web's `role="alert"`
  ///   does, when the callout appears and when they change (nil reads
  ///   nothing: the caller announces it, or it isn't an alert).
  public init(tone: CalloutTone = .plain, systemImage: String? = nil, alert: String? = nil, @ViewBuilder content: () -> Content) {
    self.tone = tone
    self.systemImage = systemImage
    self.alert = alert
    self.content = content()
  }

  public var body: some View {
    let edgeWidth = theme.points(ThemeKit.calloutEdge)
    let edge: Color
    let ink: Color
    let fill: Color
    let padding: EdgeInsets
    switch tone {
    case .plain:
      edge = theme.color(ThemeKit.calloutEdge)
      ink = theme.color(ThemeKit.calloutInk)
      fill = .clear
      padding = theme.insets(ThemeKit.calloutPadding)
    case .warn:
      edge = theme.color(ThemeKit.warnCalloutEdge)
      ink = theme.warn
      fill = theme.color(ThemeKit.warnCalloutFill)
      padding = theme.insets(ThemeKit.warnCalloutPadding)
    case .danger:
      edge = theme.color(ThemeKit.dangerCalloutEdge)
      ink = theme.danger
      fill = theme.color(ThemeKit.dangerCalloutFill)
      padding = theme.insets(ThemeKit.warnCalloutPadding)
    }
    let radius = tone == .plain ? 0 : theme.radius
    let shape = UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 0, bottomTrailingRadius: radius, topTrailingRadius: radius)
    return HStack(alignment: .top, spacing: theme.points(ThemeKit.calloutGap)) {
      if let systemImage {
        Image(systemName: systemImage)
          .virgaGlyph(Measure.Section.calloutIcon, beside: theme.textSm)
          .padding(.top, Measure.Section.calloutIconSpaceAbove)
          .accessibilityHidden(true)
      }
      content
        .virgaText(.textSm)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .foregroundStyle(ink)
    .tint(ink)
    .padding(padding)
    .padding(.leading, edgeWidth)
    .background(shape.fill(fill))
    .overlay(alignment: .leading) {
      Rectangle().fill(edge).frame(width: edgeWidth)
    }
    .frame(maxWidth: theme.measure, alignment: .leading)
    .modifier(CalloutAlert(words: alert))
  }
}

extension Callout where Content == Text {
  /// A callout of words alone. A danger one is `role="alert"`: its words
  /// are read out when it appears and whenever they change.
  public init(tone: CalloutTone = .plain, systemImage: String? = nil, _ words: String) {
    self.init(tone: tone, systemImage: systemImage, alert: tone == .danger ? words : nil) { Text(words) }
  }
}

/// `role="alert"`: the words posted to VoiceOver when the callout appears
/// and again when they change.
struct CalloutAlert: ViewModifier {
  let words: String?

  func body(content: Content) -> some View {
    content
      .onAppear { post(words) }
      .onChange(of: words) { _, next in post(next) }
  }

  private func post(_ text: String?) {
    guard let text, !text.isEmpty else { return }
    UIAccessibility.post(notification: .announcement, argument: text)
  }
}

public struct EmptyState: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.virgaUnderRuledHead) private var underRuledHead
  private let sentence: String
  private let actionTitle: String?
  private let action: (() -> Void)?

  public init(_ sentence: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
    self.sentence = sentence
    self.actionTitle = actionTitle
    self.action = action
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.emptyBlockGap)) {
      Text(sentence)
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
        .frame(maxWidth: theme.characters(Measure.Section.emptyMeasure, size: theme.textBase), alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
      if let actionTitle, let action {
        Button(actionTitle, action: action).buttonStyle(.virga)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    // `.card--flush > .card-head ~ .empty-block { padding-top: var(--space-4) }`:
    // under a ruled heading it keeps the air a first row would have.
    .padding(.top, underRuledHead ? theme.space4 : 0)
  }
}

private struct UnderRuledHeadKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// Set on a flush section's content, under the rule its heading ends in.
  var virgaUnderRuledHead: Bool {
    get { self[UnderRuledHeadKey.self] }
    set { self[UnderRuledHeadKey.self] = newValue }
  }
}

/// `.note`: prose about a setting.
public struct NoteText: View {
  @Environment(\.virgaTheme) private var theme
  private let text: String

  public init(_ text: String) {
    self.text = text
  }

  public var body: some View {
    Text(text)
      .virgaText(size: theme.points(ThemeKit.noteFontSize))
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.measure, alignment: .leading)
  }
}

public struct ProgressLine: View {
  /// ThemeKit.progressIndeterminateWidth (35%) as a share of the track.
  static var indeterminateShare: CGFloat {
    if case .value(let share, .percent) = ThemeKit.progressIndeterminateWidth { return CGFloat(share / 100) }
    return 0.35
  }

  @Environment(\.virgaTheme) private var theme
  @State private var sliding = false
  /// 0…1, or nil for a line that doesn't know how far it has got.
  private let value: Double?
  /// The fill, when it isn't the accent (a sync step's done or failed).
  private let fill: Color?
  /// The line's thickness, when it isn't 3 (the sync strip's hairline).
  private let height: CGFloat?

  public init(value: Double?, fill: Color? = nil, height: CGFloat? = nil) {
    self.value = value
    self.fill = fill
    self.height = height
  }

  public var body: some View {
    let height = self.height ?? theme.points(ThemeKit.progressHeight)
    let fill = self.fill ?? theme.color(ThemeKit.progressFill)
    GeometryReader { geometry in
      let width = geometry.size.width
      ZStack(alignment: .leading) {
        Capsule().fill(theme.color(ThemeKit.progressTrack))
        if let value {
          Capsule()
            .fill(fill)
            .frame(width: width * CGFloat(min(1, max(0, value))))
            .animation(theme.motion.progressFill, value: value)
        } else {
          // `progress-slide`: from one of its widths left of the track to
          // three to the right of it.
          let share = width * Self.indeterminateShare
          // Under Reduce Motion the web's animation runs 0.01ms once and ends
          // untransformed: a still 35% at the track's start.
          Capsule()
            .fill(fill)
            .frame(width: share)
            .offset(x: theme.motion.reduced ? 0 : (sliding ? share * 3 : -share))
            .onAppear {
              guard let animation = theme.motion.indeterminate else { return }
              withAnimation(animation) { sliding = true }
            }
        }
      }
      .clipShape(Capsule())
    }
    .frame(height: height)
    .accessibilityElement()
    .accessibilityValue(value.map { AppLocale.formatNumber(($0 * 100).rounded()) + "%" } ?? "")
  }
}

/// `.disclosure`: a sentence to open, the chevron turning as it does.
public struct Disclosure<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  @State private var open = false
  private let summary: String
  private let content: Content

  public init(_ summary: String, @ViewBuilder content: () -> Content) {
    self.summary = summary
    self.content = content()
  }

  public var body: some View {
    // `<details>` sets no gap between its summary and what it opens.
    VStack(alignment: .leading, spacing: 0) {
      Button {
        withAnimation(theme.motion.chevron) { open.toggle() }
      } label: {
        HStack(spacing: Measure.Disclosure.gap) {
          Image(systemName: Glyph.chevronRight)
            .virgaGlyph(Measure.Disclosure.chevron, weight: .semibold, beside: theme.textSm)
            .rotationEffect(.degrees(open ? 90 : 0))
          Text(summary)
            .virgaText(.textSm, weight: VirgaWeight.medium)
            .multilineTextAlignment(.leading)
        }
        .foregroundStyle(theme.ink)
        .frame(minHeight: Measure.Touch.target)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
      // A summary is read with its state, as a browser reads <details>.
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      if open {
        content
      }
    }
  }
}

#Preview("Notes") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 16) {
      Callout { Text("Sign in to finish your post.") }
      Callout(tone: .warn) { Text("Tick the box to say you agree, then carry on.") }
      Callout(tone: .danger) { Text("The last sync had problems.") }
      EmptyState("Nothing is scheduled.", actionTitle: "New post") {}
      NoteText("Compact fits more on a screen.")
      ProgressLine(value: 0.4)
      ProgressLine(value: nil)
      Disclosure("Details") { Text("access_denied").font(.caption.monospaced()) }
    }
    .padding()
  }
}
#endif
