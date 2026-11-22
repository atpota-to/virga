// Ports src/posting/ui/LifespanEditor.jsx
// Ports src/posting/pages/schedule.css (.lifespan-editor, .lse-*)
//
// The whole timer rule: whether there is one, how long (a preset, a typed
// length or an exact time), what it does (delete, limit replies, turn off
// quotes), the conditions it reads first and what happens to a post that
// meets them, with the rule in a sentence underneath and anything that
// stops it applying to this post. Over VirgaPosting's LifespanModel and
// SelfDestruct; `onChange` hears the whole next rule, normalised.
//
// `fit` says what the post is, `publishAt` when it goes out (else now),
// `limits` the account's (for the free-timer check), `did` the writer (its
// lists are offered for "Limit replies"), `allowExactTime` and
// `showToggle` as the web's, `holds` the timer the post already has, and
// `countFrom` what a length counts from for a post that's already out.
// The conditions shown are the rule's clauses and rows added here without a
// number yet, kept apart so a row doesn't vanish while its number is
// retyped. The time is read again every thirty seconds. In Settings
// (`settingsLegends`) the parts are named like the rows around them
// (settings.css's `.settings-section .lse-legend`).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaPosting

struct LifespanRuleEditor: View {
  @Environment(\.virgaTheme) private var theme
  let value: TimerRule
  let onChange: (TimerRule) -> Void
  var fit = LifespanEditorFit()
  var publishAt: String? = nil
  var limits: JSONValue? = nil
  var did: String? = nil
  var allowExactTime = true
  var showToggle = true
  var toggleLabel = "Put a timer on this post"
  var holds: JSONValue? = nil
  var countFrom = "goesUp"
  var transport: any HTTPTransport = HTTP.transport
  /// Settings' editor: its parts named at --text-md, 500, as Settings' rows
  /// are; the dialogs' at --text-sm, 600.
  var settingsLegends = false

  @State private var now = SyncStatus.now()
  @State private var amount = ""
  @State private var unit = "hours"
  @State private var otherOpen = false
  @State private var lists: [AllowEntry] = []
  @State private var rows: [String] = []
  @State private var ops: [String: String] = [:]
  @State private var started = false

  static let hour = 3600
  /// The lengths offered as chips; the rest live under Other….
  static let shownLengths = [hour, 6 * hour, 24 * hour, 3 * 24 * hour, 7 * 24 * hour]
  static var shownPresets: [SelfDestruct.LifespanPreset] { SelfDestruct.lifespanPresets.filter { shownLengths.contains($0.seconds) } }
  static func isShownChoice(_ choice: String) -> Bool { Int(choice).map { shownLengths.contains($0) } ?? false }

  var body: some View {
    let rule = SelfDestruct.normalizeTimer(value)
    let choice = LifespanModel.lengthChoice(rule)
    let notes = LifespanModel.editorNotes(rule, fit: fit, publishAt: publishAt, limits: limits, holds: holds, countFrom: countFrom, now: now)
    VStack(alignment: .leading, spacing: Measure.Lifespan.editorGap) {
      if showToggle { toggle(rule) }
      if rule.enabled || !showToggle {
        length(rule, choice: choice)
        effects(rule)
        conditions(rule)
        summary(notes)
        ForEach([notes.fitNote, notes.unavailable].filter { !$0.isEmpty }, id: \.self) { note in
          Callout(tone: .warn) { Text(note) }
        }
        // `role="status"`: read out as it arrives, after what is being said.
        ForEach([notes.pin, notes.room].filter { !$0.isEmpty }, id: \.self) { note in
          Callout(tone: .warn) { Text(note) }
            .modifier(LifespanPoliteStatus(words: note, onAppear: true))
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("lifespan-editor")
    .onAppear { begin(rule, choice: choice) }
    .onChange(of: choice) { _, next in if !Self.isShownChoice(next) { otherOpen = true } }
    .onChange(of: rule.conditions.clauses.map(\.metric.rawValue)) { _, metrics in
      let missing = metrics.filter { !rows.contains($0) }
      if !missing.isEmpty { rows += missing }
    }
    .task(id: did ?? "") { await readLists() }
    .task {
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        if Task.isCancelled { return }
        now = SyncStatus.now()
      }
    }
  }

  private func emit(_ next: TimerRule) { onChange(SelfDestruct.normalizeTimer(next)) }

  /// `.lse-summary`: the rule in a sentence (`.lse-sentence`, 0.875rem),
  /// and what a thread changes. `aria-live="polite"`: a new sentence is
  /// read out after what was pressed, not as the editor first appears.
  private func summary(_ notes: LifespanEditorNotes) -> some View {
    let off = notes.summary.isEmpty
    let sentence = off ? (showToggle ? "This post gets no timer." : "No timer.") : notes.summary
    let said = notes.thread.isEmpty ? sentence : "\(sentence) \(notes.thread)"
    return VStack(alignment: .leading, spacing: Measure.Lifespan.summaryGap) {
      Text(sentence)
        .virgaText(size: theme.points(Measure.Lifespan.sentenceSize), lineHeight: Measure.Lifespan.sentenceLineHeight)
        .foregroundStyle(off ? theme.muted : theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
      if !notes.thread.isEmpty { FieldHint(notes.thread) }
    }
    // One element read as a whole: the identifier goes on that element,
    // not on a child the combining folds into it.
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("lifespan-sentence")
    .modifier(LifespanPoliteStatus(words: said, onAppear: false))
  }

  private func begin(_ rule: TimerRule, choice: String) {
    guard !started else { return }
    started = true
    let parts = SelfDestruct.splitLifespan(rule.lifespanSeconds)
    amount = String(parts.amount)
    unit = parts.unit
    otherOpen = !Self.isShownChoice(choice)
    rows = rule.conditions.clauses.map(\.metric.rawValue)
  }

  /// The writer's curation lists, for "Limit replies".
  private func readLists() async {
    guard let did, !did.isEmpty else { return }
    do {
      let body = try await PublicAppView.publicXrpc(
        "app.bsky.graph.getLists", ["actor": .string(did), "limit": .number(50)], transport: transport)
      lists = LifespanModel.curateLists(body["lists"])
    } catch {
      lists = []
    }
  }

  // MARK: Whether there is one

  /// `.lse-switch-row`: the switch named by its label (`aria-labelledby`)
  /// and described by its hint (`aria-describedby`), the words pressing it
  /// too (`<label htmlFor>`), as ScheduleSwitch's do.
  private func toggle(_ rule: TimerRule) -> some View {
    let hint =
      rule.enabled
      ? "Virga’s server acts on the post at its time, even with this browser closed."
      : "No timer: the post stays up until you delete it."
    return HStack(alignment: .top, spacing: Measure.Lifespan.switchGap) {
      Toggle(toggleLabel, isOn: Binding(get: { rule.enabled }, set: { emit(LifespanModel.patchRule(rule, ["enabled": .bool($0)])) }))
        .labelsHidden()
        .toggleStyle(.virgaSwitch)
        .accessibilityHint(hint)
      VStack(alignment: .leading, spacing: Measure.Lifespan.switchTextGap) {
        Text(toggleLabel).virgaText(.textMd, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
        FieldHint(hint)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
      .onTapGesture { emit(LifespanModel.patchRule(rule, ["enabled": .bool(!rule.enabled)])) }
      .accessibilityHidden(true)
    }
  }

  // MARK: How long

  private func length(_ rule: TimerRule, choice: String) -> some View {
    let deletes = rule.effects.contains { $0.action == .delete }
    let customSeconds = SelfDestruct.lifespanFromParts(.string(amount), unit)
    return block(deletes ? "Delete it after" : "Act on it after") {
      FlowLayout(spacing: Measure.Lifespan.chipsGap, lineSpacing: Measure.Lifespan.chipsGap) {
        ForEach(Self.shownPresets, id: \.seconds) { p in
          chip(p.label, on: !otherOpen && choice == String(p.seconds)) {
            otherOpen = false
            let parts = SelfDestruct.splitLifespan(p.seconds)
            amount = String(parts.amount)
            unit = parts.unit
            emit(LifespanModel.withLength(rule, p.seconds))
          }
        }
        // `aria-expanded`: it opens the length's fields under the chips.
        chip("Other…", on: otherOpen, expanded: otherOpen) { otherOpen = true }
      }
      if otherOpen {
        VStack(alignment: .leading, spacing: Measure.Lifespan.otherGap) {
          VStack(alignment: .leading, spacing: Measure.Lifespan.inlineRowGap) {
            HStack(alignment: .bottom, spacing: Measure.Lifespan.inlineGap) {
              FieldStack("Length") {
                VirgaTextField(
                  "",
                  text: Binding(
                    get: { amount },
                    set: { next in
                      amount = next
                      if let s = SelfDestruct.lifespanFromParts(.string(next), unit) { emit(LifespanModel.withLength(rule, s)) }
                    })
                )
                .keyboardType(.numberPad)
                .virgaField(invalid: customSeconds == nil)
                .accessibilityLabel("Length")
              }
              .frame(maxWidth: Measure.Lifespan.amountWidth)
              FieldStack("Unit") {
                VirgaSelect(
                  "Unit",
                  selection: Binding(
                    get: { unit },
                    set: { next in
                      unit = next
                      if let s = SelfDestruct.lifespanFromParts(.string(amount), next) { emit(LifespanModel.withLength(rule, s)) }
                    }),
                  options: SelfDestruct.lifespanUnits.map { SelectChoice($0.key, $0.label) })
              }
              .frame(maxWidth: Measure.Lifespan.unitWidth)
            }
            FieldHint(
              customSeconds == nil
                ? "Between 5 minutes and 30 days: at most \(SelfDestruct.maxAmountForUnit(unit)) \(unit)."
                : rule.deleteAt != nil
                  ? "Without a set time it would use \(SelfDestruct.formatLifespan(rule.lifespanSeconds))."
                  : "\(SelfDestruct.formatLifespan(customSeconds ?? 0)) after it goes up.")
          }
          if allowExactTime { exactTime(rule) }
        }
      }
    }
  }

  private func exactTime(_ rule: TimerRule) -> some View {
    let from = publishAt.map { JSDate.parse($0, timeZone: AppLocale.activeTimeZone()) }.flatMap { $0.isFinite ? $0 : nil } ?? now
    let bounds = try? LifespanModel.pinBounds(from: from)
    let lo = bounds.map { Date(timeIntervalSince1970: JSDate.parse($0.min, timeZone: .gmt) / 1000) } ?? Date()
    let hi = bounds.map { Date(timeIntervalSince1970: JSDate.parse($0.max, timeZone: .gmt) / 1000) } ?? Date().addingTimeInterval(30 * 86_400)
    let pinned = rule.deleteAt.map { JSDate.parse($0, timeZone: AppLocale.activeTimeZone()) }.flatMap { $0.isFinite ? $0 : nil }
    return VStack(alignment: .leading, spacing: Measure.Lifespan.inlineRowGap) {
      FieldLabel("Or a set time")
      HStack(spacing: theme.space3) {
        if let pinned {
          DatePicker(
            "Or a set time",
            selection: Binding(
              get: { Date(timeIntervalSince1970: pinned / 1000) },
              set: { date in emit(LifespanModel.withPin(rule, JSDate.toISOString(date.timeIntervalSince1970 * 1000))) }),
            in: lo...max(lo, hi)
          )
          .labelsHidden()
          Button("Clear") { emit(LifespanModel.withPin(rule, nil as String?)) }
            .buttonStyle(.virga(.ghost, size: .small))
        } else {
          unpinnedField(rule, earliest: lo)
        }
      }
      FieldHint("In this device’s time. At least 5 minutes and at most 30 days after it goes up.")
    }
  }

  /// `toLocalInput(rule.deleteAt)` is '' without a pin: an empty field,
  /// not a time drawn as if chosen. Pressing it sets the earliest time
  /// allowed, at the next whole minute (the field's own precision), which
  /// the system's pickers that take its place then change (a browser's
  /// empty field opens its own picker instead).
  private func unpinnedField(_ rule: TimerRule, earliest: Date) -> some View {
    Button {
      let minute = (earliest.timeIntervalSince1970 / 60).rounded(.up) * 60
      emit(LifespanModel.withPin(rule, JSDate.toISOString(minute * 1000)))
    } label: {
      Text(verbatim: " ")
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .virgaField()
    .frame(maxWidth: Measure.Lifespan.atWidth)
    .accessibilityLabel("Or a set time")
    .accessibilityValue("")
  }

  // MARK: What it does

  private func effects(_ rule: TimerRule) -> some View {
    let gate = SelfDestruct.effectFor(rule.effects, "limitReplies")
    let allow = gate?.allow ?? []
    var choices = lists
    for entry in allow {
      if case .list = entry, !choices.contains(where: { SelfDestruct.allowEntryKey($0).jsEquals(SelfDestruct.allowEntryKey(entry)) }) {
        choices.append(entry)
      }
    }
    return block("What happens then") {
      FlowLayout(spacing: Measure.Lifespan.chipsGap, lineSpacing: Measure.Lifespan.chipsGap) {
        ForEach(SelfDestruct.effects, id: \.key) { effect in
          let on = SelfDestruct.effectFor(rule.effects, effect.key) != nil
          let blocked = effect.key == "limitReplies" && fit.reply
          chip(effect.label, on: on) { emit(LifespanModel.toggleEffect(rule, effect.key)) }
            .disabled(blocked && !on)
            .help(blocked ? "A reply can’t limit who replies to it." : "")
        }
      }
      if gate != nil {
        sub("Who can still reply") {
          FlowLayout(spacing: Measure.Lifespan.chipsGap, lineSpacing: Measure.Lifespan.chipsGap) {
            chip("Nobody", on: allow.isEmpty) { emit(LifespanModel.withAllow(rule, [AllowEntry]())) }
            ForEach(SelfDestruct.allowOptions, id: \.key) { o in
              let on = allow.contains { SelfDestruct.allowEntryKey($0).jsEquals(o.key) }
              chip(o.label, on: on) { emit(LifespanModel.withAllow(rule, LifespanModel.toggleAllow(allow, .string(o.key)))) }
            }
            ForEach(Array(choices.enumerated()), id: \.offset) { _, l in
              let key = SelfDestruct.allowEntryKey(l)
              let on = allow.contains { SelfDestruct.allowEntryKey($0).jsEquals(key) }
              chip(Self.listName(l), on: on) { emit(LifespanModel.withAllow(rule, LifespanModel.toggleAllow(allow, l))) }
            }
          }
          FieldHint(
            (allow.isEmpty ? "Nobody can reply once it acts." : "Only \(SelfDestruct.describeAllow(allow)) can reply once it acts.")
              + (allow.count >= SelfDestruct.maxAllowRules ? " That’s the most Bluesky takes (\(SelfDestruct.maxAllowRules))." : ""))
        }
      }
    }
  }

  static func listName(_ entry: AllowEntry) -> String {
    if case .list(_, let name) = entry, let name, !name.isEmpty { return "People in \(name)" }
    return "People in a list"
  }

  // MARK: The conditions

  private func conditions(_ rule: TimerRule) -> some View {
    let deletes = rule.effects.contains { $0.action == .delete }
    let clauses = rule.conditions.clauses
    let quoteClause = SelfDestruct.clauseFor(rule.conditions, "quotes")
    let free = SelfDestruct.metrics.first { !rows.contains($0.key) }
    let from = publishAt.map { JSDate.parse($0, timeZone: AppLocale.activeTimeZone()) }.flatMap { $0.isFinite ? $0 : nil } ?? now
    let windowPhrase = SelfDestruct.formatLifespan(SelfDestruct.extendWindowSeconds(rule, from))
    return block("Conditions (optional)") {
      FieldHint("Leave these empty to act on time, whatever happens. Counts are read from Bluesky when it’s due.")
      if !rows.isEmpty {
        Segmented(
          label: "How the conditions work",
          options: [SegmentedOption("unless", "Unless it reaches"), SegmentedOption("onlyIf", "Only if it reaches")],
          selection: rule.conditions.sense.rawValue, size: .small
        ) { emit(LifespanModel.withConditions(rule, ["sense": .string($0)])) }
        VStack(alignment: .leading, spacing: theme.isPhone ? Measure.Lifespan.phoneCondsGap : Measure.Lifespan.condsGap) {
          ForEach(rows, id: \.self) { metric in
            conditionRow(rule, metric)
          }
        }
      }
      if let free {
        Button {
          rows.append(free.key)
        } label: {
          Label("Add a condition", systemImage: Glyph.plus)
        }
        .buttonStyle(.linkAction)
        .accessibilityIdentifier("lifespan-add-condition")
      }
      if let quoteClause { quoteFilter(rule, quoteClause.from) }
      if clauses.count > 1 {
        sub("When there’s more than one") {
          Segmented(
            label: "When there’s more than one condition",
            options: [SegmentedOption("any", "Any one of them"), SegmentedOption("all", "All of them")],
            selection: rule.conditions.logic.rawValue, size: .small
          ) { emit(LifespanModel.withConditions(rule, ["logic": .string($0)])) }
        }
      }
      if !clauses.isEmpty {
        sub(rule.conditions.sense == .onlyIf ? "If it doesn’t" : "If it does") {
          FlowLayout(spacing: Measure.Lifespan.spareGap, lineSpacing: Measure.Lifespan.chipsGap) {
            Segmented(
              label: "What happens to a post that's spared",
              options: [
                SegmentedOption("keep", deletes ? "Keep it for good" : "Leave it alone"),
                SegmentedOption("extend", deletes ? "Give it another \(windowPhrase)" : "Check again in \(windowPhrase)"),
              ],
              selection: rule.conditions.onSpare.rawValue, size: .small
            ) { emit(LifespanModel.withConditions(rule, ["onSpare": .string($0)])) }
            if rule.conditions.onSpare == .extend {
              HStack(spacing: Measure.Lifespan.chipsGap) {
                // `.lse-inline-field` sets only the size: the words are ink.
                Text("At most").virgaText(.textSm).foregroundStyle(theme.ink)
                VirgaSelect(
                  "At most",
                  selection: Binding(
                    get: { rule.conditions.maxExtensions },
                    set: { emit(LifespanModel.withConditions(rule, ["maxExtensions": .number(Double($0))])) }),
                  options: LifespanModel.extensionChoices.map { SelectChoice($0, $0 == 1 ? "once" : "\($0) times") })
                // `.lse-inline-field .lse-op { width: auto }`
                .fixedSize(horizontal: true, vertical: false)
              }
            }
          }
        }
      }
    }
  }

  private func conditionRow(_ rule: TimerRule, _ metric: String) -> some View {
    let m = SelfDestruct.metrics.first { $0.key == metric }
    let label = m?.label ?? metric
    let clause = SelfDestruct.clauseFor(rule.conditions, metric)
    let op = clause?.op.rawValue ?? ops[metric] ?? "gte"
    // A metric another row holds can't be chosen here (the web's disabled
    // options), so it isn't offered.
    let metricChoices = SelfDestruct.metrics.filter { $0.key == metric || !rows.contains($0.key) }.map { SelectChoice($0.key, $0.label) }
    let metricPicker = VirgaSelect(
      "What it counts", selection: Binding(get: { metric }, set: { changeRowMetric(rule, from: metric, to: $0) }),
      options: metricChoices)
    let opPicker = VirgaSelect(
      "\(label): how to compare",
      selection: Binding(
        get: { op },
        set: { next in
          if let clause {
            emit(LifespanModel.withMetric(rule, metric, ["op": .string(next), "value": .number(Double(clause.value))]))
          } else {
            ops[metric] = next
          }
        }),
      options: SelfDestruct.operators.map { SelectChoice($0.key, "\($0.symbol) \($0.label)") })
    let number = VirgaTextField(
      "off",
      text: Binding(
        get: { clause.map { String($0.value) } ?? "" },
        set: { next in emit(LifespanModel.withMetric(rule, metric, ["op": .string(op), "value": .string(next)])) })
    )
    .keyboardType(.numberPad)
    .virgaField()
    .accessibilityLabel("\(label): how many")
    let remove = Button {
      removeRow(rule, metric)
    } label: {
      Image(systemName: Glyph.close)
    }
    .buttonStyle(.virga(.ghost, size: .small, icon: true))
    .accessibilityLabel("Remove the \(label.jsLowercased()) condition")
    // `.lse-cond-remove { margin-right: -14px }` on a touch screen.
    .padding(.trailing, -Measure.Lifespan.removeLetOut)
    return Group {
      if theme.isPhone {
        LifespanPhoneCondition(gap: Measure.Lifespan.condsGap) {
          metricPicker
          remove
          opPicker
          number
        }
      } else {
        HStack(spacing: Measure.Lifespan.condsGap) {
          metricPicker
          opPicker.frame(maxWidth: Measure.Lifespan.opWidth)
          number.frame(maxWidth: Measure.Lifespan.valueWidth)
          remove
        }
      }
    }
    .accessibilityElement(children: .contain)
  }

  private func changeRowMetric(_ rule: TimerRule, from: String, to: String) {
    if from == to || rows.contains(to) { return }
    rows = rows.map { $0 == from ? to : $0 }
    if let clause = SelfDestruct.clauseFor(rule.conditions, from) {
      let cleared = LifespanModel.withMetric(rule, from, ["value": ""])
      emit(LifespanModel.withMetric(cleared, to, ["op": .string(clause.op.rawValue), "value": .number(Double(clause.value))]))
    } else {
      ops[to] = ops[from] ?? "gte"
    }
  }

  private func removeRow(_ rule: TimerRule, _ metric: String) {
    rows.removeAll { $0 == metric }
    if SelfDestruct.clauseFor(rule.conditions, metric) != nil {
      emit(LifespanModel.withMetric(rule, metric, ["value": ""]))
    }
  }

  private func quoteFilter(_ rule: TimerRule, _ filter: ActorFilter?) -> some View {
    sub("Count quotes from") {
      FlowLayout(spacing: Measure.Lifespan.checksGap, lineSpacing: Measure.Lifespan.chipsGap) {
        Toggle(
          SelfDestruct.actorTests.first?.label ?? "",
          isOn: Binding(
            get: { filter?.notFollowed ?? false }, set: { emit(LifespanModel.withQuoteFilter(rule, ["notFollowed": .bool($0)])) })
        )
        .toggleStyle(.virgaCheck)
        HStack(spacing: Measure.Lifespan.chipsGap) {
          Toggle(
            "People with over",
            isOn: Binding(
              get: { filter?.followersOver != nil },
              set: { emit(LifespanModel.withQuoteFilter(rule, ["followersOver": $0 ? .number(10_000) : .null])) })
          )
          .toggleStyle(.virgaCheck)
          VirgaSelect(
            "Followers, at least",
            selection: Binding(
              get: { filter?.followersOver ?? 10_000 },
              set: { emit(LifespanModel.withQuoteFilter(rule, ["followersOver": .number(Double($0))])) }),
            options: LifespanModel.followerThresholds.map { SelectChoice($0, "\(AppLocale.formatNumber($0)) followers") })
          // `.lse-check-with .lse-op { width: auto }`
          .fixedSize(horizontal: true, vertical: false)
          .disabled(filter?.followersOver == nil)
        }
      }
      if let filter, filter.notFollowed, filter.followersOver != nil {
        Segmented(
          label: "Which quoters count", options: [SegmentedOption("any", "Either one"), SegmentedOption("all", "Both")],
          selection: filter.match.rawValue, size: .small
        ) { emit(LifespanModel.withQuoteFilter(rule, ["match": .string($0)])) }
      }
      if filter == nil {
        FieldHint("Leave both off to count every quote.")
      }
    }
  }

  // MARK: Parts

  /// `.lse-block`: a part of the rule under its name. The fieldset's gap
  /// is its content's, which the legend isn't part of: the legend's 8 below
  /// is the whole gap to what it names, and what follows is 12 apart.
  private func block<Content: View>(_ legend: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: Measure.Lifespan.legendBelow) {
      Text(legend)
        .virgaText(
          settingsLegends ? ThemeToken.textMd : ThemeToken.textSm,
          weight: settingsLegends ? VirgaWeight.medium : VirgaWeight.semibold
        )
        .foregroundStyle(theme.ink)
        .accessibilityAddTraits(.isHeader)
      VStack(alignment: .leading, spacing: Measure.Lifespan.blockGap) {
        content()
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// `.lse-sub`: a follow-on question, a little further off.
  private func sub<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: Measure.Lifespan.subGap) {
      FieldLabel(label)
      content()
    }
    .padding(.top, Measure.Lifespan.subAbove)
    .accessibilityElement(children: .contain)
  }

  /// `.lse-chips .chip`: pressed while on (`aria-pressed`), 50% while
  /// disabled; `expanded` says whether what it opens is open (`aria-expanded`).
  private func chip(_ label: String, on: Bool, expanded: Bool? = nil, action: @escaping () -> Void) -> some View {
    Button(label, action: action)
      .buttonStyle(ChipStyle(isOn: on, disabledOpacity: Measure.Lifespan.disabledChipOpacity))
      .accessibilityAddTraits(on ? .isSelected : [])
      .accessibilityValue(expanded.map { $0 ? "Expanded" : "Collapsed" } ?? "")
  }
}

/// `role="status"` and `aria-live="polite"`: words read out when they
/// change (and, for a status that arrives with them, as it appears),
/// queued after what VoiceOver is saying rather than cutting it off.
struct LifespanPoliteStatus: ViewModifier {
  let words: String
  let onAppear: Bool

  func body(content: Content) -> some View {
    content
      .onAppear { if onAppear { Self.post(words) } }
      .onChange(of: words) { _, next in Self.post(next) }
  }

  @MainActor
  static func post(_ text: String) {
    guard !text.isEmpty else { return }
    let queued = NSAttributedString(string: text, attributes: [.accessibilitySpeechQueueAnnouncement: true])
    UIAccessibility.post(notification: .announcement, argument: queued)
  }
}

/// `.lse-cond` from 560 down: `grid-template-columns: minmax(0, 1fr)
/// minmax(0, 1fr) auto; gap: 8px`. What it counts takes the first two
/// columns and its ✕ the third; how it compares the first column of the
/// second line and the number the other two. The ✕'s column is as wide as
/// the ✕ less what it's let out by (its trailing padding, already in its
/// size here). Each is centred in its line. The subviews, in order: what it
/// counts, the ✕, how it compares, the number.
struct LifespanPhoneCondition: Layout {
  var gap: CGFloat

  private struct Lines {
    var one: CGFloat
    var metric: CGFloat
    var number: CGFloat
    var remove: CGSize
    var first: CGFloat
    var second: CGFloat
    var heights: [CGFloat]
  }

  private func lines(_ width: CGFloat, _ subviews: Subviews) -> Lines {
    let remove = subviews[1].sizeThatFits(.unspecified)
    let last = max(0, remove.width)
    let one = max(0, (width - last - 2 * gap) / 2)
    let metric = one * 2 + gap
    let number = one + gap + last
    let heights = [
      subviews[0].sizeThatFits(ProposedViewSize(width: metric, height: nil)).height,
      remove.height,
      subviews[2].sizeThatFits(ProposedViewSize(width: one, height: nil)).height,
      subviews[3].sizeThatFits(ProposedViewSize(width: number, height: nil)).height,
    ]
    return Lines(
      one: one, metric: metric, number: number, remove: remove, first: max(heights[0], heights[1]),
      second: max(heights[2], heights[3]), heights: heights)
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard subviews.count == 4 else { return .zero }
    let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? Measure.Lifespan.phoneConditionWidth
    let l = lines(width, subviews)
    return CGSize(width: width, height: l.first + gap + l.second)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard subviews.count == 4 else { return }
    let l = lines(bounds.width, subviews)
    let top = bounds.minY
    let below = top + l.first + gap
    subviews[0].place(
      at: CGPoint(x: bounds.minX, y: top + (l.first - l.heights[0]) / 2), anchor: .topLeading,
      proposal: ProposedViewSize(width: l.metric, height: l.heights[0]))
    subviews[1].place(
      at: CGPoint(x: bounds.minX + l.metric + gap, y: top + (l.first - l.heights[1]) / 2), anchor: .topLeading,
      proposal: ProposedViewSize(l.remove))
    subviews[2].place(
      at: CGPoint(x: bounds.minX, y: below + (l.second - l.heights[2]) / 2), anchor: .topLeading,
      proposal: ProposedViewSize(width: l.one, height: l.heights[2]))
    subviews[3].place(
      at: CGPoint(x: bounds.minX + l.one + gap, y: below + (l.second - l.heights[3]) / 2), anchor: .topLeading,
      proposal: ProposedViewSize(width: l.number, height: l.heights[3]))
  }
}

extension Measure {
  /// schedule.css's timer editor (.lifespan-editor, .lse-*).
  public enum Lifespan {
    /// `.lifespan-editor { gap: 24px }`, `.lse-switch-row { gap: 4px 12px }`.
    public static let editorGap: CGFloat = 24
    public static let switchGap: CGFloat = 12
    public static let switchTextGap: CGFloat = 4
    /// `.lse-block { gap: 12px }`, `.lse-legend { margin-bottom: 8px }`, `.lse-chips { gap: 8px }`.
    public static let blockGap: CGFloat = 12
    public static let legendBelow: CGFloat = 8
    public static let chipsGap: CGFloat = 8
    /// `.lse-other { gap: 16px }`, `.lse-inline { grid-template-columns: minmax(0, 140px) minmax(0, 160px); gap: 8px 12px }`.
    public static let otherGap: CGFloat = 16
    public static let amountWidth: CGFloat = 140
    public static let unitWidth: CGFloat = 160
    public static let inlineGap: CGFloat = 12
    public static let inlineRowGap: CGFloat = 8
    /// `.lse-sub { gap: 8px }`, 4 more above it in a block.
    public static let subGap: CGFloat = 8
    public static let subAbove: CGFloat = 4
    /// `.lse-conds { gap: 8px }` (16 from 560 down), `.lse-cond { grid-template-columns: … minmax(0, 150px) minmax(0, 96px) auto }`,
    /// `.lse-cond-remove { margin-right: -14px }` on a touch screen.
    public static let condsGap: CGFloat = 8
    public static let phoneCondsGap: CGFloat = 16
    public static let opWidth: CGFloat = 150
    public static let valueWidth: CGFloat = 96
    public static let removeLetOut: CGFloat = 14
    /// A phone's condition with no width offered (it always is, in the editor's column).
    public static let phoneConditionWidth: CGFloat = 320
    /// `.lse-inline--at { grid-template-columns: minmax(0, 260px) … }`: the set time's field.
    public static let atWidth: CGFloat = 260
    /// `.lse-chips .chip:disabled { opacity: 0.5 }`
    public static let disabledChipOpacity: Double = 0.5
    /// `.lse-checks { gap: 8px 18px }`, `.lse-spare { gap: 8px 14px }`.
    public static let checksGap: CGFloat = 18
    public static let spareGap: CGFloat = 14
    /// `.lse-sentence { font-size: 0.875rem; line-height: 1.45 }`, `.lse-summary .field-hint { margin-top: 4px }`.
    public static let sentenceSize: ThemeLength = .rem(0.875)
    public static let sentenceLineHeight: Double = 1.45
    public static let summaryGap: CGFloat = 4
  }
}
#endif
