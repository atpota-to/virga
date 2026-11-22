// Ports src/posting/library/TemplateQuestions.jsx
// Ports src/posting/library/library.css (.lib-questions, .lib-question, .lib-answers, .lib-preview, .lib-part, .lib-preview-attach)
//
// A template's questions, asked before it fills a post: a text field per
// typed question and a row of chips per choice question (one tab stop, the
// arrows move and choose, as radios do; choosing the chosen one again
// clears an optional question), with a live preview of what the post will
// read: what's added plain, what fills itself underlined, answers tinted
// and blanks still to answer as dashed chips, the count against 300, what
// it attaches, and any notes. Return in a field goes to the next question
// that still needs an answer, or uses the template once none does.
//
// The preview is the library's previewFor (VirgaPosting's Library): on its
// own, a template's words added to an empty post; a caller with a post
// under way (the composer's library) passes its own. The context is a
// template context, the library's libraryContext.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

/// What the editor and the preview show for an attachment: `{ by, title }`.
struct TemplateAttachSummary: Hashable {
  var by: String
  var title: String
}

extension TemplateQuestions {
  /// `previewFor(itemFromTemplate(template, ctx, { embedView }), { currentText: '', answers, context })`:
  /// a template's words added to an empty post, nothing already attached.
  static func defaultPreview(
    _ template: PostTemplate, answers: [String: String], context: TemplateContext?, embedView: JSONValue?
  ) -> LibraryPreview {
    Library.previewFor(
      Library.itemFromTemplate(template, context, embedView: embedView), currentText: "",
      answers: .object(answers.mapValues(JSONValue.string)), context: context)
  }
}

/// `ChoiceGroup`: a radio group of chips with one tab stop; the arrows
/// (and Home and End) move and choose. Choosing the chosen one again
/// clears it when `allowClear` is set.
struct ChoiceGroup: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  let options: [String]
  let value: String
  var required = false
  var allowClear = false
  let onChange: (String) -> Void
  @FocusState private var focused: Int?

  var body: some View {
    let chosen = options.firstIndex { $0.jsEquals(value) }
    FlowLayout(spacing: Measure.Templates.answersGap, lineSpacing: Measure.Templates.answersGap, alignment: .center) {
      ForEach(Array(options.enumerated()), id: \.offset) { index, option in
        let on = index == chosen
        Button {
          onChange(allowClear && on ? "" : option)
        } label: {
          Text(option)
        }
        // A long answer wraps inside its chip rather than running out of the column.
        .buttonStyle(ChipStyle(isOn: on, wraps: true))
        .focused($focused, equals: index)
        .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow, .home, .end]) { press in
          let n = options.count
          let next: Int
          switch press.key {
          case .downArrow, .rightArrow: next = (index + 1) % n
          case .upArrow, .leftArrow: next = (index - 1 + n) % n
          case .home: next = 0
          default: next = n - 1
          }
          onChange(options[next])
          focused = next
          return .handled
        }
        .accessibilityAddTraits(on ? .isSelected : [])
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
  }
}

/// `TemplatePreview`: what the post will read, in a hairline frame.
struct TemplatePreviewView: View {
  @Environment(\.virgaTheme) private var theme
  let preview: LibraryPreview
  var label = "The post will read"
  var maxLength = 300

  var body: some View {
    let parts = preview.parts.filter { !$0.text.isEmpty }
    VStack(alignment: .leading, spacing: Measure.Templates.previewGap) {
      HStack(alignment: .firstTextBaseline, spacing: Measure.Templates.previewGap) {
        Text(label)
          .virgaText(.textSm, weight: VirgaWeight.medium)
          .foregroundStyle(theme.muted)
        Spacer(minLength: 0)
        Text("\(AppLocale.formatNumber(preview.count)) of \(maxLength)")
          .virgaText(.textSm, weight: preview.overLimit ? VirgaWeight.semibold : VirgaWeight.regular)
          .foregroundStyle(preview.overLimit ? theme.danger : theme.muted)
          .accessibilityLabel(preview.overLimit ? "\(AppLocale.formatNumber(preview.count)) of \(maxLength), over the limit" : "\(AppLocale.formatNumber(preview.count)) of \(maxLength)")
      }
      if parts.isEmpty {
        Text("The text stays as it is.")
          .virgaText(.textMd, lineHeight: Measure.Templates.previewLineHeight)
          .foregroundStyle(theme.muted)
      } else {
        words(parts)
          .virgaText(.textMd, lineHeight: Measure.Templates.previewLineHeight)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityLabel(parts.map { $0.kind == "blank" ? "blank: \($0.text)" : $0.text }.joined())
      }
      if let attachment = preview.attachment {
        TemplateAttachCard(summary: TemplateAttachSummary(by: attachment.by, title: attachment.title))
      }
      ForEach(preview.notes, id: \.self) { note in
        Text(note).virgaText(.textSm).foregroundStyle(theme.muted).fixedSize(horizontal: false, vertical: true)
      }
      if let blocked = preview.blocked {
        Text(blocked).virgaText(.textSm).foregroundStyle(theme.warn).fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(Measure.Templates.previewPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: Measure.Templates.previewRadius).strokeBorder(theme.line, lineWidth: 1))
    // `.lib-preview-blocked { role="status" }`: what stops it, read out as it changes.
    .toolAnnounces(preview.blocked)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("template-preview")
  }

  /// The parts run together as one paragraph: existing words muted, what
  /// fills itself underlined, answers on the accent's tint with a rule
  /// under them, a blank still to answer in brackets of its own, smaller
  /// and muted (a dashed chip on the web, which a run of text can't draw).
  private func words(_ parts: [LibraryPreviewPart]) -> Text {
    var out = Text("")
    for part in parts {
      switch part.kind {
      case "existing":
        out = out + Text(part.text).foregroundColor(theme.muted)
      case "context":
        out = out + Text(part.text).underline(true, color: theme.line2)
      case "answer":
        var piece = AttributedString(part.text)
        piece.backgroundColor = theme.accentTint
        out = out + Text(piece).underline(true, color: theme.accent)
      case "blank":
        out = out + Text("[\(part.text)]").foregroundColor(theme.muted).font(theme.font(size: theme.textSm))
      default:
        out = out + Text(part.text)
      }
    }
    return out
  }
}

/// `.lib-preview-attach`: what it attaches, `by` over its title.
struct TemplateAttachCard: View {
  @Environment(\.virgaTheme) private var theme
  let summary: TemplateAttachSummary

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Templates.attachCardGap) {
      Text(summary.by).virgaText(.textSm).foregroundStyle(theme.muted)
      if !summary.title.isEmpty {
        Text(summary.title).virgaText(.textSm).foregroundStyle(theme.ink).fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(Measure.Templates.attachCardPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: theme.radius).strokeBorder(theme.line, lineWidth: 1))
    .accessibilityElement(children: .combine)
  }
}

/// `TemplateQuestions`: the questions, the preview, and Use it.
struct TemplateQuestions: View {
  @Environment(\.virgaTheme) private var theme
  let template: PostTemplate
  let context: TemplateContext?
  /// The library's view of what the template quotes (a view, or
  /// `Library.missing`), when it has read it.
  var embedView: JSONValue? = nil
  var submitLabel = "Use it"
  var cancelLabel = "Cancel"
  var busy = false
  var autoFocus = false
  /// The preview of the post under way, when there is one (the composer's
  /// library); nil works it out for the template on its own.
  var preview: (([String: String]) -> LibraryPreview)? = nil
  let onDone: ([String: String]) -> Void
  var onCancel: (() -> Void)? = nil

  @State private var answers: [String: String]?
  @State private var tried = false
  @FocusState private var focusedKey: String?

  var body: some View {
    let narrow = theme.windowWidth <= Breakpoint.tablet
    let questions = PostTemplates.templateQuestions(template, context)
    let given = answers ?? PostTemplates.initialAnswers(questions)
    let missing = PostTemplates.missingAnswers(questions, given)
    let shown = preview?(given) ?? Self.defaultPreview(template, answers: given, context: context, embedView: embedView)
    VStack(alignment: .leading, spacing: Measure.Templates.questionsGap) {
      if !questions.isEmpty {
        VStack(alignment: .leading, spacing: Measure.Templates.questionListGap) {
          ForEach(Array(questions.enumerated()), id: \.offset) { index, q in
            question(q, index: index, given: given, missing: missing)
          }
        }
      }
      TemplatePreviewView(preview: shown, label: context?.their != nil ? "Your reply will read" : "Your post will read")
      // `.lib-questions-actions`: at the end; from 760 down the one thing to
      // do is the column's width, and in the phone's dialog it is held at
      // the sheet's foot.
      HStack(spacing: Measure.Templates.questionsActionsGap) {
        if !narrow { Spacer(minLength: 0) }
        if let onCancel {
          Button(cancelLabel, action: onCancel)
            .buttonStyle(.virga)
            .disabled(busy)
        }
        Button(busy ? "Adding…" : submitLabel) { submit(given, missing: missing) }
          .buttonStyle(.virga(.primary))
          .environment(\.virgaFillsWidth, narrow)
          .disabled(busy || !shown.usable)
          .accessibilityIdentifier("template-questions-use")
      }
      .modifier(LibraryPinnedActions())
    }
    .onAppear {
      // The first typed question takes the keyboard (`data-autofocus`, and
      // the library's focus into a template chosen on a phone).
      guard autoFocus, let first = questions.first(where: { $0.kind != "choice" }) else { return }
      DispatchQueue.main.async { focusedKey = first.key }
    }
    // `role="status"`: how many still need an answer, read out again as the
    // count changes once Use it has been tried.
    .toolAnnounces(tried && !missing.isEmpty ? Self.stillToAnswer(missing.count) : nil)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("template-questions")
  }

  @ViewBuilder
  private func question(_ q: TemplateQuestion, index: Int, given: [String: String], missing: [String]) -> some View {
    let failed = tried && missing.contains { $0.jsEquals(q.key) }
    // `.lib-optional { font-weight: 400 }`: its own face, as the label's
    // face (virgaText) is set at the label's weight, which a segment's
    // fontWeight can't change.
    let optional: Text =
      q.optional
      ? Text(" · optional").font(theme.font(size: theme.points(ThemeKit.fieldLabelFontSize), weight: VirgaWeight.regular))
        .foregroundColor(theme.muted) : Text("")
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
      (Text(q.label) + optional)
        .virgaText(size: theme.points(ThemeKit.fieldLabelFontSize), weight: ThemeKit.fieldLabelWeight)
        .foregroundStyle(theme.ink)
      if q.kind == "choice" {
        ChoiceGroup(label: q.label, options: q.choices, value: given[q.key] ?? "", required: !q.optional, allowClear: true) { v in
          set(q.key, v, given)
        }
      } else {
        VirgaTextField("", text: Binding(get: { given[q.key] ?? "" }, set: { set(q.key, $0, given) }))
          .textInputAutocapitalization(.sentences)
          .virgaField(invalid: failed)
          .focused($focusedKey, equals: q.key)
          .submitLabel(.next)
          .onSubmit {
            // Return: the next question still to answer, or use it.
            if let next = missing.first(where: { !$0.jsEquals(q.key) }) { focusedKey = next } else { submit(given, missing: missing) }
          }
          .accessibilityLabel(q.optional ? "\(q.label), optional" : q.label)
          .accessibilityHint(q.hint)
          .accessibilityIdentifier("template-question-\(index)")
      }
      if !q.hint.isEmpty { FieldHint(q.hint) }
      if !q.note.isEmpty { FieldHint(q.note) }
      if failed {
        Text("Answer this one first.").virgaText(.textSm).foregroundStyle(theme.danger)
      }
    }
  }

  static func stillToAnswer(_ count: Int) -> String {
    count == 1 ? "One question still needs an answer." : "\(count) questions still need an answer."
  }

  private func set(_ key: String, _ value: String, _ given: [String: String]) {
    var next = given
    next[key] = value
    answers = next
  }

  private func submit(_ given: [String: String], missing: [String]) {
    if busy { return }
    if let first = missing.first {
      tried = true
      focusedKey = first
      return
    }
    onDone(given)
  }
}
#endif
