// Ports src/posting/composer/Composer.jsx (the post's settings: tags, language, replies, timer, More)
// Ports src/posting/composer/composer.css (.composer-options, .composer-option, .composer-more-rows)
//
// The post's settings, under a rule in ink: each a button with its name
// and its value apart (a phone's rows, between hairlines), or one short
// phrase (a wider window's row of words). More holds Continue a thread,
// Save as a template and Start over.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

extension ComposerController {
  /// Where the post's reply settings come from (gatesSourceLine).
  var gatesLine: String {
    let info: JSONValue
    if state.gates.custom {
      info = ["custom": true]
    } else if let gatesInfo, gatesInfo.did.jsEquals(asDid) {
      var out: [String: JSONValue] = ["status": .string(gatesInfo.status)]
      if let source = gatesInfo.source { out["source"] = .string(source) }
      if let notice = gatesInfo.notice { out["notice"] = .string(notice) }
      info = .object(out)
    } else {
      info = ["status": "loading"]
    }
    return ComposerDefaults.gatesSourceLine(info, reply: state.reply != nil)
  }

  /// "Use my default": the account's usual reply settings again.
  func useDefaultGates() {
    var next = state
    var gates = next.gates.json.objectValue ?? [:]
    gates["custom"] = false
    next.json["gates"] = .object(gates)
    dispatch(.load(next))
    resolveGates()
  }

  var tagsValue: String { state.tags.isEmpty ? "None" : state.tags.map { "#\($0)" }.joined(separator: ", ") }

  var langsValue: String {
    let labels = state.labels
    return ComposerLanguages.langsSummary(state.langs) + (labels.isEmpty ? "" : " · \(ComposerLanguages.labelsSummary(labels))")
  }

  var gatesValue: String { ComposerDefaults.gatesShortSummary(state.gates.json) }

  var gatesShort: String {
    guard let reply = state.gates.reply, !reply.isEmpty else { return ComposerDefaults.gatesSummary(state.gates.json) }
    let value = gatesValue
    return "Replies: \(value.jsSlice(0, 1).lowercased())\(value.jsSlice(1))"
  }

  var timerOn: Bool { state.lifespan["enabled"]?.isTruthy ?? false }

  /// Whether the tags field is open (Tags pressed, or tags already set).
  var tagsOpen: Bool { showTags || !state.tags.isEmpty }

  /// Check this post's title: the month's checks, else what it does.
  var adviserOptionTitle: String {
    adviser.usageLine.isEmpty ? "Ask the post adviser what it thinks" : adviser.usageLine
  }

  /// "Anyone can reply" said under the settings, when the account's default
  /// is everyone and that came from Bluesky's own setting.
  var gatesNotice: String? {
    guard let info = gatesInfo, info.did.jsEquals(asDid), info.source == "everyone", !state.gates.custom,
      state.reply == nil, let notice = info.notice
    else { return nil }
    return notice
  }

  /// Whether a line sits between the settings and the when panel (the
  /// timer's note, the reply settings' notice): on a phone the panel's own
  /// rule shows only then, the rows above already ending on a hairline.
  var optionsNoteShown: Bool {
    (!timerNote.isEmpty && !timerOn) || gatesNotice != nil
  }

  /// The tag being typed, committed (TagsField's commit): on Return, a
  /// comma, the field losing focus, and before the post is sent.
  func commitTagDraft() {
    let text = tagDraft
    guard !text.jsTrimmed().isEmpty else { return }
    let tags = state.tags
    let next = Tags.normalizeTags(tags + text.components(separatedBy: ","))
    if next.count != tags.count || zip(next, tags).contains(where: { !$0.jsEquals($1) }) { dispatch(.setTags(next)) }
    tagDraft = ""
  }

  var timerValue: String {
    timerOn ? SelfDestruct.timerChipLabel(state.lifespan, now: now) : "No timer"
  }
}

struct ComposerOptions: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let disabled: Bool
  @State private var moreOpen = false

  var body: some View {
    let state = controller.state
    let replying = state.reply != nil
    let phone = theme.composerNarrow
    let timerNote = controller.timerNote  // TIMER
    VStack(alignment: .leading, spacing: 0) {
      Rectangle().fill(theme.rule).frame(height: 1)
      if phone {
        rows(replying: replying)
      } else {
        // The row of words, its ⋯ held in the row's top corner however
        // the words before it wrap (`.composer-more`).
        FlowLayout(spacing: ComposerMeasure.optionsGap, lineSpacing: ComposerMeasure.optionsRowGap) {
          words(replying: replying)
        }
        .padding(.top, ComposerMeasure.optionsTop)
        .padding(.trailing, ComposerMeasure.optionsMoreRoom)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .topTrailing) {
          MoreMenu(label: "More for this post", entries: moreEntries(replying: replying))
            .disabled(disabled)
            .offset(x: ComposerMeasure.moreRight, y: ComposerMeasure.moreTop - ComposerMeasure.optionsTop)
            .accessibilityIdentifier("option-more")
        }
        // The tags field opens after the whole row on a wide screen.
        if controller.tagsOpen {
          tagsField(bareLabel: false)
            .padding(.top, ComposerMeasure.optionsRowGap + ComposerMeasure.tagsFieldTop)
            .padding(.bottom, ComposerMeasure.tagsFieldBottom)
        }
      }
      // TIMER: why the post has no timer, while it has none (timerNote).
      if !timerNote.isEmpty && !controller.timerOn {
        FieldHint(timerNote)
          .padding(.top, ComposerMeasure.gap - ComposerMeasure.noteLift)
          .accessibilityIdentifier("composer-timer-note")
      }
      if let notice = controller.gatesNotice {
        FieldHint(notice).padding(.top, ComposerMeasure.gap - ComposerMeasure.noteLift)
      }
    }
  }

  private func tagsField(bareLabel: Bool) -> some View {
    TagsField(
      tags: controller.state.tags, draft: Binding(get: { controller.tagDraft }, set: { controller.tagDraft = $0 }),
      disabled: disabled, bareLabel: bareLabel, onCommit: { controller.commitTagDraft() }
    ) { controller.dispatch(.setTags($0)) }
  }

  // MARK: A wider window: a row of words

  @ViewBuilder
  private func words(replying: Bool) -> some View {
    let state = controller.state
    let count = state.tags.count
    word(
      ComposerGlyph.tags, count > 0 ? "\(count) \(count == 1 ? "tag" : "tags")" : "Tags", pressed: controller.tagsOpen,
      id: "option-tags"
    ) {
      controller.showTags.toggle()
    }
    .accessibilityAddTraits(controller.tagsOpen ? .isSelected : [])
    word(ComposerGlyph.languages, controller.langsValue, id: "option-language") { controller.dialog = .meta }
    if !replying {
      word(ComposerGlyph.replies, controller.gatesShort, id: "option-replies") { controller.dialog = .gates }
        .help(controller.gatesLine)  // the button's title: where the settings come from
        .accessibilityHint(controller.gatesLine)
    }
    word(ComposerGlyph.timer, controller.timerValue, id: "option-timer") { controller.dialog = .timer }
      .accessibilityLabel(controller.timerOn ? "Timer: \(controller.timerValue)" : "Timer: none")
      .help(controller.timerNote)  // TIMER: the button's title
      .accessibilityHint(controller.timerNote)
    // ADVISER: Check this post, the month's checks on the pointer's tip.
    if controller.adviser.enabled {
      word(AdviserGlyph.sparkles, "Check this post", id: "option-adviser") { controller.askAdviser() }
        .help(controller.adviserOptionTitle)
        .accessibilityHint(controller.adviserOptionTitle)
    }
  }

  /// More: Continue a thread (not on a reply), Save as a template, then
  /// Start over.
  private func moreEntries(replying: Bool) -> [MenuEntry] {
    var out: [MenuEntry] = []
    if !replying {
      out.append(
        .item(
          MenuItem(
            "Continue a thread", key: "continue", hint: "Reply to one of your own posts",
            accessibilityIdentifier: "more-continue"
          ) { controller.openContinue() }))
    }
    out.append(
      .item(
        MenuItem(
          "Save as a template", key: "template", hint: "Keep this text to use again",
          accessibilityIdentifier: "more-template"
        ) { controller.saveAsTemplate() }))
    out.append(.separator)
    out.append(.item(MenuItem("Start over", key: "over", destructive: true) { controller.startOver() }))
    return out
  }

  /// `.composer-option` on a wide screen: muted words, ink and 500 while
  /// what it opens is open (`aria-pressed`).
  private func word(_ symbol: String, _ text: String, pressed: Bool = false, id: String, action: @escaping () -> Void)
    -> some View
  {
    Button(action: action) {
      HStack(spacing: ComposerMeasure.optionGap) {
        Image(systemName: symbol).virgaGlyph(ComposerMeasure.optionIcon, beside: theme.textSm)
        Text(text)
          .virgaText(.textSm, weight: pressed ? VirgaWeight.medium : VirgaWeight.regular)
          .lineLimit(1)
          .truncationMode(.tail)
      }
      .foregroundStyle(pressed ? theme.ink : theme.muted)
      .frame(minHeight: ComposerMeasure.optionHeight)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? ThemeKit.disabledOpacity : 1)
    // A 32-point line, pressed as 44.
    .touchReach(horizontal: 0, vertical: (Measure.Touch.target - ComposerMeasure.optionHeight) / 2)
    .accessibilityIdentifier(id)
  }

  // MARK: A phone: rows between hairlines

  @ViewBuilder
  private func rows(replying: Bool) -> some View {
    row(ComposerGlyph.tags, "Tags", controller.tagsValue, id: "option-tags") { controller.showTags.toggle() }
      .accessibilityAddTraits(controller.tagsOpen ? .isSelected : [])
    // The tags field opens right under its own row on a phone, the row
    // over it saying Tags.
    if controller.tagsOpen {
      tagsField(bareLabel: true)
        .padding(.top, ComposerMeasure.phoneTagsFieldTop)
        .padding(.bottom, ComposerMeasure.phoneTagsFieldBottom)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    }
    row(ComposerGlyph.languages, "Language", controller.langsValue, id: "option-language") { controller.dialog = .meta }
    if !replying {
      row(ComposerGlyph.replies, "Replies", controller.gatesValue, id: "option-replies") { controller.dialog = .gates }
        .accessibilityHint(controller.gatesLine)
    }
    row(ComposerGlyph.timer, "Timer", controller.timerValue, id: "option-timer") { controller.dialog = .timer }
      .accessibilityLabel(controller.timerOn ? "Timer: \(controller.timerValue)" : "Timer: none")
      .accessibilityHint(controller.timerNote)  // TIMER: the button's title
    // ADVISER: Check this post; the month's checks are its title, not its value.
    if controller.adviser.enabled {
      row(AdviserGlyph.sparkles, "Check this post", nil, id: "option-adviser") { controller.askAdviser() }
        .accessibilityHint(controller.adviserOptionTitle)
    }
    row(ComposerGlyph.more, "More", nil, chevron: ComposerGlyph.chevronDown, turned: moreOpen, id: "option-more") {
      moreOpen.toggle()
    }
    .accessibilityValue(moreOpen ? "Expanded" : "Collapsed")
    if moreOpen {
      if !replying {
        subRow("Continue a thread", danger: false, id: "option-continue") { controller.openContinue() }
      }
      subRow("Save as a template", danger: false, id: "option-template") { controller.saveAsTemplate() }
      subRow("Start over", danger: true, id: "option-start-over") { controller.startOver() }
    }
  }

  /// One of More's rows, under the others: the rows close as it's chosen.
  private func subRow(_ label: String, danger: Bool, id: String, action: @escaping () -> Void) -> some View {
    Button {
      moreOpen = false
      action()
    } label: {
      Text(label)
        .virgaText(.textBase)
        .foregroundStyle(danger ? theme.danger : theme.ink)
        .frame(maxWidth: .infinity, minHeight: ComposerMeasure.phoneOptionHeight, alignment: .leading)
        .padding(.leading, ComposerMeasure.subRowInset)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? ThemeKit.disabledOpacity : 1)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityLabel(label)
    .accessibilityIdentifier(id)
  }

  private func row(
    _ symbol: String, _ label: String, _ value: String?, chevron: String = ComposerGlyph.chevronRight, turned: Bool = false,
    id: String, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: ComposerMeasure.phoneOptionGap) {
        Image(systemName: symbol)
          .virgaGlyph(ComposerMeasure.optionIcon, beside: theme.textBase)
          .foregroundStyle(theme.ink2)
        Text(label).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
        Spacer(minLength: theme.space2)
        if let value {
          Text(value).virgaText(.textBase).foregroundStyle(theme.muted).lineLimit(1).truncationMode(.tail)
        }
        Image(systemName: chevron)
          .virgaGlyph(ComposerMeasure.optionChevron, beside: theme.textBase)
          .foregroundStyle(theme.muted)
          .rotationEffect(.degrees(turned ? 180 : 0))
          .animation(theme.motion.control, value: turned)
      }
      .frame(minHeight: ComposerMeasure.phoneOptionHeight)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? ThemeKit.disabledOpacity : 1)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier(id)
  }
}
#endif
