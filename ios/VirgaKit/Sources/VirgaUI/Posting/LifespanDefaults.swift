// Ports src/posting/ui/LifespanDefaults.jsx
//
// Settings › Posting: the timer new posts start with, for one account.
// Whether there is one, and its rule (a length, never a set time). The
// composer puts it on only when the account has a free timer of its kind,
// and says so when it can't. Kept on this device. With a long session the
// account's limits are read (getLimits): the editor checks the rule against
// the free timers, and the caption starts with the timers in use.
//
// The rule's editor is LifespanRuleEditor (LifespanEditor.jsx); the switch
// above it (`default-timer-on`) keeps `enabled`.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights
import VirgaPosting
import VirgaSession

/// `LifespanDefaults`: the timer new posts start with, a length, never a set time.
struct LifespanDefaultsCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let did: String?
  let model: PostingSettingsModel
  @State private var error: String?
  @State private var limits: JSONValue?

  var body: some View {
    let lifespan = SelfDestruct.normalizeTimer(model.settings.lifespan)
    let rule = Self.ruleSentence(lifespan)
    SettingsSectionView(title: "Default timer", sub: "A timer every new post starts with. Each post can change it or take it off.") {
      SettingsRow(
        label: "Start new posts with a timer",
        hint: lifespan.enabled ? nil as String? : "New posts start without one. The rule is kept for when you turn this on.",
        compactControl: true
      ) {
        SettingsSwitch(label: "Start new posts with a timer", isOn: lifespan.enabled) { enabled in
          var next = lifespan
          next.enabled = enabled
          save(next)
        }
        .accessibilityIdentifier("default-timer-on")
      }
      .pressingName {
        var next = lifespan
        next.enabled = !lifespan.enabled
        save(next)
      }
      // On, the editor under this row ends with the rule in a sentence, so
      // the row says nothing more; off, the rule waits behind its sentence,
      // closed, still there to change before turning the timer on (a
      // closed `<details>` keeps it, unsaved rows and all).
      if lifespan.enabled {
        SettingsRow(block: { editor(lifespan) })
      } else {
        Disclosure("The rule it will use: \(Self.sentenceClause(rule))", settingsRow: true, keepsContent: true) {
          // `.settings-rule[open] > .settings-rule-editor { margin-top: var(--space-4) }`
          editor(lifespan)
            .padding(.top, theme.space4)
        }
        .padding(.vertical, theme.rowPadLg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
      }
      if let error {
        PostingSettingsRefusal(words: error)
      }
      caption
    }
    // Read again when the account gains or loses its long session, as the
    // web's effect on `req` is.
    .task(id: "\(did ?? "")|\(app.session.capabilitiesFor(did).canSchedule)") { await readLimits() }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posting-default-timer")
  }

  /// The account's limits, with a long session; none without.
  private func readLimits() async {
    guard let did, app.session.capabilitiesFor(did).canSchedule, let req = app.session.backendFor(did) else {
      limits = nil
      return
    }
    limits = try? await ScheduleService.getLimits(req)
  }

  /// The rule's editor (LifespanRuleEditor), always on, a length never a
  /// set time; what it changes keeps the timer on or off as it is. Held to
  /// `.settings-rule-editor { max-width: 640px }`, its parts named like the
  /// rows around it.
  private func editor(_ lifespan: TimerRule) -> some View {
    var on = lifespan
    on.enabled = true
    return LifespanRuleEditor(
      value: on,
      onChange: { next in
        var kept = next
        kept.enabled = lifespan.enabled
        save(kept)
      },
      fit: LifespanEditorFit(), limits: limits, did: did, allowExactTime: false, showToggle: false,
      transport: app.archiveEnvironment.transport, settingsLegends: true
    )
    .frame(maxWidth: Measure.SettingsPosting.ruleEditorMax, alignment: .leading)
  }

  /// `usage ? usage + ' ' : ''`, then what happens without a free timer,
  /// and the way to the posts on one: a link in ink, underlined, as links
  /// are (the posting kit's linked words, through the navigator).
  private var caption: some View {
    let usage = ScheduleModel.timerLimitsLine(limits)
    let lead =
      "\(usage.isEmpty ? "" : "\(usage) ")When the account has no free timer of the kind this rule needs, a new post starts without it, and the composer says why. "
    return ScheduleLinkedText(pieces: [
      .words(lead), .link("See posts on a timer", to: PostingRoutes.postingPath("timers")), .words("."),
    ])
    .virgaText(.textSm)
    .foregroundStyle(theme.muted)
    .tint(theme.ink)
    .fixedSize(horizontal: false, vertical: true)
    .frame(maxWidth: theme.measure, alignment: .leading)
    .padding(.top, theme.points(ThemeKit.cardCaptionSpaceAbove))
    .accessibilityIdentifier("default-timer-caption")
  }

  /// `save(next)`: the rule normalized, never pinned to a time.
  private func save(_ next: TimerRule) {
    do {
      var rule = SelfDestruct.normalizeTimer(next)
      rule.deleteAt = nil
      try model.update(["lifespan": rule.json])
      error = nil
    } catch {
      self.error = PostingSettingsSave.message(error)
    }
  }

  /// `describeTimer({ ...lifespan, enabled: true })`.
  static func ruleSentence(_ lifespan: TimerRule) -> String {
    var on = lifespan
    on.enabled = true
    return SelfDestruct.describeTimer(on, now: SyncStatus.now())
  }

  /// `sentenceClause(text)`: "Deletes itself 24 hours after it goes up."
  /// as the end of a sentence.
  static func sentenceClause(_ text: String) -> String {
    guard let first = text.first else { return text }
    var rest = String(text.dropFirst())
    if rest.hasSuffix(".") { rest.removeLast() }
    return first.lowercased() + rest
  }
}
#endif
