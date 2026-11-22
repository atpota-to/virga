// Ports src/posting/library/TemplateQuestions.jsx
// Ports src/posting/library/library.css (.lib-questions, .lib-question, .lib-answers, .lib-preview, .lib-part, .lib-preview-attach)
// Ports src/posting/library/model.js (previewFor, attachmentFor and embedLabel, for a template on its own)
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
// The preview is previewFor's. library/model.js is the library's, still to
// be ported whole; until it is, `LibraryPreview.forTemplate` works out the
// case the questions need on their own (a template's words added to an
// empty post, nothing already attached), and a caller with a post under
// way (the composer's library) passes its own preview instead. The context
// is a template context (PostTemplates.buildTemplateContext), the
// library's libraryContext.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

/// previewFor's result: the post's words as kinded parts, its count, what
/// it attaches, its notes, what stops it, and whether it can be used.
struct LibraryPreview {
  /// `{ text, kind }`: 'existing', 'added', 'context', 'answer' or 'blank'.
  var parts: [TemplatePart]
  var count: Int
  var overLimit: Bool
  var attachment: TemplateAttachSummary?
  var notes: [String]
  var blocked: String?
  var usable: Bool

  static let noteGone = [
    "post": "The post this template quotes is gone, so only its text will be added.",
    "feed": "The feed this template attaches is gone, so only its text will be added.",
    "list": "The list this template attaches is gone, so only its text will be added.",
  ]
  static let blockedGoneEmpty = [
    "post": "The post this template quotes is gone, so there’s nothing to add.",
    "feed": "The feed this template attaches is gone, so there’s nothing to add.",
    "list": "The list this template attaches is gone, so there’s nothing to add.",
  ]
  static let noteUnsupported = "What this template attaches can’t be added here, so only its text will be added."
  static let blockedUnsupportedEmpty = "What this template attaches can’t be added here, and it has no text."

  /// `previewFor(itemFromTemplate(template, ctx, { embedView }), { currentText: '', answers, context })`.
  static func forTemplate(
    _ template: PostTemplate, answers: [String: String], context: TemplateContext?, embedView: TemplateEmbedView?, maxLength: Int = 300
  ) -> LibraryPreview {
    // templateAdditionParts: the template's own words are what's added.
    var parts: [TemplatePart] = []
    for part in PostTemplates.templatePreviewParts(template, answers, context) {
      push(&parts, part.text, part.kind == "text" ? "added" : part.kind)
    }
    let filled = PostTemplates.fillTemplate(template, answers, context)
    let count = InlineLinks.countComposerGraphemes(filled)
    let hasText = !template.text.jsTrimmed().isEmpty
    let kind = EditorDrafts.templateEmbedKind(template.embed)
    let isRecord = kind == "post" || kind == "feed" || kind == "list"
    let missing: Bool
    if case .missing? = embedView { missing = true } else { missing = false }
    // slotFor: what it would attach, unless what it quotes is gone.
    let slot: String? = missing ? nil : (isRecord ? "record" : (kind == "link" ? "link" : nil))
    var notes: [String] = []
    var blocked: String?
    if isRecord && missing, let kind {
      if hasText { notes.append(noteGone[kind] ?? "") } else { blocked = blockedGoneEmpty[kind] }
    } else if kind == "unsupported" {
      if hasText { notes.append(noteUnsupported) } else { blocked = blockedUnsupportedEmpty }
    }
    return LibraryPreview(
      parts: parts, count: count, overLimit: count > maxLength,
      attachment: attachment(template, embedView: embedView, context: context), notes: notes, blocked: blocked,
      usable: hasText || slot != nil)
  }

  /// `pushPart`: a part joins the last when it is of the same kind; an empty one is left out.
  static func push(_ parts: inout [TemplatePart], _ text: String, _ kind: String) {
    guard !text.isEmpty else { return }
    if let last = parts.last, last.kind == kind {
      parts[parts.count - 1].text += text
    } else {
      parts.append(TemplatePart(text: text, kind: kind))
    }
  }

  /// `attachmentFor({ kind: 'template', … })`: the mini card's words.
  static func attachment(_ template: PostTemplate, embedView: TemplateEmbedView?, context: TemplateContext?) -> TemplateAttachSummary? {
    var view: JSONValue?
    switch embedView {
    case .missing?: return nil
    case .view(let v)?: view = v
    case nil: view = nil
    }
    let embed = template.embed
    let oneLine = { (v: String?) in (v ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ") }
    switch EditorDrafts.templateEmbedKind(embed) {
    case "post":
      guard let view else { return TemplateAttachSummary(by: "Quoted post", title: "") }
      let handle = view["author"]?["handle"]?.stringValue ?? ""
      let mine = context?.my?.handle ?? ""
      let by = !handle.isEmpty && !mine.isEmpty && handle == mine ? "Your post" : (handle.isEmpty ? "Post" : "Post by @\(handle)")
      return TemplateAttachSummary(by: by, title: TemplateEditorWords.firstLine(view["record"]?["text"]?.stringValue).nonEmpty ?? embedLabel(view))
    case "feed":
      guard let view else { return TemplateAttachSummary(by: "Feed", title: "") }
      let handle = view["creator"]?["handle"]?.stringValue ?? ""
      return TemplateAttachSummary(by: handle.isEmpty ? "Feed" : "Feed by @\(handle)", title: oneLine(view["displayName"]?.stringValue))
    case "list":
      guard let view else { return TemplateAttachSummary(by: "List", title: "") }
      let handle = view["creator"]?["handle"]?.stringValue ?? ""
      return TemplateAttachSummary(by: handle.isEmpty ? "List" : "List by @\(handle)", title: oneLine(view["name"]?.stringValue))
    case "link":
      let uri = embed?["external"]?["uri"]?.stringValue ?? ""
      var host = URL(string: uri)?.host ?? ""
      if host.utf16.starts(with: "www.".utf16) { host = host.jsSlice(4) }
      return TemplateAttachSummary(by: host.isEmpty ? "Link" : host, title: oneLine(embed?["external"]?["title"]?.stringValue).nonEmpty ?? uri)
    default:
      return nil
    }
  }

  /// `embedLabel(post)`: what a post with no text shows instead.
  static func embedLabel(_ post: JSONValue) -> String {
    let embed = post["record"]?["embed"]
    let own = embed?["$type"]?.stringValue ?? ""
    let viewType = (post["embed"]?["$type"]?.stringValue ?? "").replacingOccurrences(of: "#view", with: "")
    let type = own.isEmpty ? viewType : own
    switch type {
    case "app.bsky.embed.images": return "Image"
    case "app.bsky.embed.video": return "Video"
    case "app.bsky.embed.external": return "Link"
    case "app.bsky.embed.recordWithMedia":
      let media = embed?["media"]?["$type"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        ?? (post["embed"]?["media"]?["$type"]?.stringValue ?? "").replacingOccurrences(of: "#view", with: "")
      if media == "app.bsky.embed.video" { return "Video" }
      if media == "app.bsky.embed.images" { return "Image" }
      return "Quote"
    case "app.bsky.embed.record":
      let uri = embed?["record"]?["uri"]?.stringValue ?? post["embed"]?["record"]?["uri"]?.stringValue
      let collection = TemplateEditorSources.parseAtUri(uri)?.collection
      if collection == TemplateEditorSources.feedCollection { return "Feed" }
      if collection == TemplateEditorSources.listCollection { return "List" }
      return "Quote"
    default:
      return post["hasMedia"]?.isTruthy == true ? "Image" : "Post"
    }
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
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
        }
        .buttonStyle(ChipStyle(isOn: on))
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
        TemplateAttachCard(summary: attachment)
      }
      ForEach(preview.notes, id: \.self) { note in
        Text(note).virgaText(.textSm).foregroundStyle(theme.muted).fixedSize(horizontal: false, vertical: true)
      }
      if let blocked = preview.blocked {
        Text(blocked).virgaText(.textSm).foregroundStyle(theme.warn).fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.updatesFrequently)
      }
    }
    .padding(Measure.Templates.previewPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: Measure.Templates.previewRadius).strokeBorder(theme.line, lineWidth: 1))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("template-preview")
  }

  /// The parts run together as one paragraph: existing words muted, what
  /// fills itself underlined, answers on the accent's tint with a rule
  /// under them, a blank still to answer in brackets of its own, smaller
  /// and muted (a dashed chip on the web, which a run of text can't draw).
  private func words(_ parts: [TemplatePart]) -> Text {
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
  var embedView: TemplateEmbedView? = nil
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
    let questions = PostTemplates.templateQuestions(template, context)
    let given = answers ?? PostTemplates.initialAnswers(questions)
    let missing = PostTemplates.missingAnswers(questions, given)
    let shown = preview?(given) ?? LibraryPreview.forTemplate(template, answers: given, context: context, embedView: embedView)
    VStack(alignment: .leading, spacing: Measure.Templates.questionsGap) {
      if !questions.isEmpty {
        VStack(alignment: .leading, spacing: Measure.Templates.questionListGap) {
          ForEach(Array(questions.enumerated()), id: \.offset) { index, q in
            question(q, index: index, given: given, missing: missing)
          }
        }
      }
      TemplatePreviewView(preview: shown, label: context?.their != nil ? "Your reply will read" : "Your post will read")
      HStack(spacing: Measure.Templates.questionsActionsGap) {
        Spacer(minLength: 0)
        if let onCancel {
          Button(cancelLabel, action: onCancel)
            .buttonStyle(.virga)
            .disabled(busy)
        }
        Button(busy ? "Adding…" : submitLabel) { submit(given, missing: missing) }
          .buttonStyle(.virga(.primary))
          .disabled(busy || !shown.usable)
          .accessibilityIdentifier("template-questions-use")
      }
    }
    .onAppear {
      if autoFocus, let first = questions.first, first.kind != "choice" { focusedKey = first.key }
    }
    .onChange(of: tried) { _, now in
      guard now, !missing.isEmpty else { return }
      let words = missing.count == 1 ? "One question still needs an answer." : "\(missing.count) questions still need an answer."
      UIAccessibility.post(notification: .announcement, argument: words)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("template-questions")
  }

  @ViewBuilder
  private func question(_ q: TemplateQuestion, index: Int, given: [String: String], missing: [String]) -> some View {
    let failed = tried && missing.contains { $0.jsEquals(q.key) }
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
      (Text(q.label) + (q.optional ? Text(" · optional").foregroundColor(theme.muted).fontWeight(.regular) : Text("")))
        .virgaText(size: theme.points(ThemeKit.fieldLabelFontSize), weight: ThemeKit.fieldLabelWeight)
        .foregroundStyle(theme.ink)
      if q.kind == "choice" {
        ChoiceGroup(label: q.label, options: q.choices, value: given[q.key] ?? "", required: !q.optional, allowClear: true) { v in
          set(q.key, v, given)
        }
      } else {
        TextField("", text: Binding(get: { given[q.key] ?? "" }, set: { set(q.key, $0, given) }))
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
