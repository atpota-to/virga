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
    VStack(alignment: .leading, spacing: phone ? 0 : ComposerMeasure.optionsTop) {
      Rectangle().fill(theme.rule).frame(height: 1)
      if phone {
        rows(replying: replying)
      } else {
        FlowLayout(spacing: ComposerMeasure.optionsGap, lineSpacing: ComposerMeasure.optionsRowGap) {
          words(replying: replying)
        }
      }
      if controller.showTags || !state.tags.isEmpty {
        TagsField(tags: state.tags, disabled: disabled) { controller.dispatch(.setTags($0)) }
          .padding(.top, theme.space2)
      }
      if let info = controller.gatesInfo, info.did.jsEquals(controller.asDid), info.source == "everyone", !state.gates.custom,
        !replying, let notice = info.notice
      {
        FieldHint(notice)
      }
    }
  }

  // MARK: A wider window: a row of words

  @ViewBuilder
  private func words(replying: Bool) -> some View {
    let state = controller.state
    let count = state.tags.count
    word(ComposerGlyph.tags, count > 0 ? "\(count) \(count == 1 ? "tag" : "tags")" : "Tags", id: "option-tags") {
      controller.showTags.toggle()
    }
    word(ComposerGlyph.languages, controller.langsValue, id: "option-language") { controller.dialog = .meta }
    if !replying {
      word(ComposerGlyph.replies, controller.gatesShort, id: "option-replies") { controller.dialog = .gates }
    }
    word(ComposerGlyph.timer, controller.timerValue, id: "option-timer") { controller.dialog = .timer }
      .accessibilityLabel(controller.timerOn ? "Timer: \(controller.timerValue)" : "Timer: none")
    // ADVISER: Check this post, the month's checks on the pointer's tip.
    if controller.adviser.enabled {
      word(AdviserGlyph.sparkles, "Check this post", id: "option-adviser") { controller.askAdviser() }
        .help(controller.adviser.usageLine.isEmpty ? "Ask the post adviser what it thinks" : controller.adviser.usageLine)
        .accessibilityHint(controller.adviser.usageLine)
    }
    MoreMenu(label: "More for this post", entries: moreEntries(replying: replying))
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

  private func word(_ symbol: String, _ text: String, id: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: ComposerMeasure.optionGap) {
        Image(systemName: symbol).font(.system(size: 15))
        Text(text).virgaText(.textSm, weight: VirgaWeight.medium)
      }
      .foregroundStyle(theme.ink2)
      .frame(minHeight: ComposerMeasure.optionHeight)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .touchTarget()
    .accessibilityIdentifier(id)
  }

  // MARK: A phone: rows between hairlines

  @ViewBuilder
  private func rows(replying: Bool) -> some View {
    row(ComposerGlyph.tags, "Tags", controller.tagsValue, id: "option-tags") { controller.showTags.toggle() }
    row(ComposerGlyph.languages, "Language", controller.langsValue, id: "option-language") { controller.dialog = .meta }
    if !replying {
      row(ComposerGlyph.replies, "Replies", controller.gatesValue, id: "option-replies") { controller.dialog = .gates }
    }
    row(ComposerGlyph.timer, "Timer", controller.timerValue, id: "option-timer") { controller.dialog = .timer }
      .accessibilityLabel(controller.timerOn ? "Timer: \(controller.timerValue)" : "Timer: none")
    // ADVISER: Check this post, with the month's checks as its value.
    if controller.adviser.enabled {
      row(AdviserGlyph.sparkles, "Check this post", controller.adviser.usageLine.isEmpty ? nil : controller.adviser.usageLine, id: "option-adviser") {
        controller.askAdviser()
      }
    }
    row(ComposerGlyph.more, "More", nil, chevron: ComposerGlyph.chevronDown, id: "option-more") { moreOpen.toggle() }
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
        .virgaText(.textBase, weight: VirgaWeight.medium)
        .foregroundStyle(danger ? theme.danger : theme.ink)
        .frame(maxWidth: .infinity, minHeight: Measure.Touch.target, alignment: .leading)
        .padding(.leading, theme.space6)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .accessibilityLabel(label)
    .accessibilityIdentifier(id)
  }

  private func row(
    _ symbol: String, _ label: String, _ value: String?, chevron: String = ComposerGlyph.chevronRight, id: String,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: theme.space3) {
        Image(systemName: symbol).font(.system(size: 16)).foregroundStyle(theme.ink2).frame(width: 20)
        Text(label).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
        Spacer(minLength: theme.space2)
        if let value {
          Text(value).virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(1).truncationMode(.tail)
        }
        Image(systemName: chevron).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.faint)
      }
      .frame(minHeight: Measure.Touch.target)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier(id)
  }
}
#endif
