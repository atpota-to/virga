// Ports src/posting/composer/PostEditor.jsx
// Ports src/posting/composer/composer.css (.post-editor, .hl--*, .suggest-*)
//
// One post's text field. The web draws the text twice (a transparent
// textarea over a layer that colours mentions, links, hashtags and the
// brackets of inline links); UIKit's text view colours its own letters,
// so the highlights are attributes on the text itself, set a beat after
// typing stops, and the caret never drifts. Typing "@" suggests accounts
// (the public typeahead); pasting an address over selected words makes an
// inline link; pasting pictures adds them to the post. Detection runs 150
// ms after typing stops, and the composer hears which record links and
// web addresses it found.
//
// Typing "/" at the start of a word suggests templates by shortcut
// (Library.detectSlashCommand, rankTemplatesForSlash, matchShortcut); a
// template picked goes in over the shortcut, and Open the library opens
// it over the shortcut's range.

#if canImport(UIKit)
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import VirgaCore
import VirgaNetwork
import VirgaPosting

/// The mention being typed, and who it might be.
struct MentionLookup: Equatable {
  enum Status: Equatable { case loading, ready, error }
  var range: PartialMention
  var status: Status
  var items: [JSONValue]
  var index = 0
}

struct PostEditor: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let postId: String
  let index: Int
  let label: String
  let placeholder: String
  let disabled: Bool
  @State private var caret = 0
  @State private var detected: (text: String, segments: [HighlightSegment]) = (text: "", segments: [])
  @State private var mention: MentionLookup?
  @State private var pasteNote = ""
  @State private var focusTick = 0

  private var text: String {
    controller.state.posts.first { $0.id.jsEquals(postId) }?.text ?? ""
  }

  private var partial: PartialMention? {
    guard let m = Mentions.detectPartialMention(text, caret), m.query.utf16.count >= 1 else { return nil }
    return m
  }

  /// The "/shortcut" being typed, while no mention is.
  private var slash: SlashCommand? {
    guard partial == nil else { return nil }
    return Library.detectSlashCommand(text, caret)
  }

  var body: some View {
    let text = self.text
    // Until detection catches up, the text is drawn plain: never stale
    // colours on characters that moved.
    let segments = detected.text == text ? detected.segments : []
    let notes = ComposerEditing.misleadingLinkNotes(.string(text)) + (pasteNote.isEmpty ? [] : [pasteNote])
    VStack(alignment: .leading, spacing: theme.space2) {
      field(text: text, segments: segments)
      if !notes.isEmpty {
        Text(notes.joined(separator: " "))
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
      }
      if let mention, mention.range.query.jsEquals(partial?.query ?? "\u{0}") {
        MentionList(mention: mention) { actor in pick(actor) }
      }
      if let slash {
        SlashList(
          controller: controller, slash: slash,
          onOpenLibrary: { controller.openLibrary(postId, range: TextSelection(start: slash.start, end: slash.end)) }
        ) { template in
          controller.applyTemplate(postId, template, range: TextSelection(start: slash.start, end: slash.end))
        }
      }
    }
    .task(id: text) { await detect(text) }
    .task(id: partial.map { "\($0.start):\($0.query)" }) { await lookUp(partial) }
  }

  private func field(text: String, segments: [HighlightSegment]) -> some View {
    let caretRequest = controller.pendingCaret[postId]
    let focus = controller.focusPostId.map { $0.jsEquals(postId) } ?? false
    return ZStack(alignment: .topLeading) {
      if text.isEmpty {
        Text(placeholder)
          .font(theme.font(size: ComposerMeasure.editorSize, weight: ComposerMeasure.editorWeight))
          .foregroundStyle(theme.muted)
          .padding(.top, 2)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      HighlightedTextView(
        text: Binding(
          get: { self.text },
          set: { next in
            let at = controller.indexOfPost(postId)
            if at >= 0 { controller.dispatch(.setText(index: at, text: next)) }
          }),
        segments: segments,
        style: EditorStyle(theme: theme),
        label: label,
        identifier: "post-editor-\(index)",
        placeholder: placeholder,
        disabled: disabled,
        caretRequest: caretRequest,
        focusRequest: focus,
        onCaret: { caret = $0 },
        onFocus: { controller.activeIndex = controller.indexOfPost(postId) },
        onRequestsDone: {
          controller.pendingCaret[postId] = nil
          if controller.focusPostId.map({ $0.jsEquals(postId) }) ?? false { controller.focusPostId = nil }
        },
        onPaste: { range in paste(range) },
        onSend: { controller.sendFromKeyboard() })
    }
    .opacity(disabled ? 0.6 : 1)
  }

  // MARK: Detection

  private func detect(_ text: String) async {
    try? await Task.sleep(nanoseconds: 150_000_000)
    if Task.isCancelled { return }
    let links = InlineLinks.findInlineLinks(text).filter { !$0.misleading }
    let result = await Facets.detectFacets(text, DetectFacetsOptions(skipMentionResolution: true))
    if Task.isCancelled { return }
    let merged = InlineLinks.applyInlineLinks(text, links.map(\.span), result)
    detected = (text: text, segments: Highlight.highlightSegments(text, merged.facets, links))
    controller.detected(postId, text: text, postEmbeds: merged.postEmbeds, externalLinks: merged.externalLinks)
  }

  // MARK: Mentions

  private func lookUp(_ partial: PartialMention?) async {
    guard let partial else {
      mention = nil
      return
    }
    let kept = mention?.range.query.jsEquals(partial.query) ?? false ? mention?.items ?? [] : []
    mention = MentionLookup(range: partial, status: .loading, items: kept)
    try? await Task.sleep(nanoseconds: 150_000_000)
    if Task.isCancelled { return }
    do {
      let body = try await PublicAppView.publicXrpc(
        "app.bsky.actor.searchActorsTypeahead", ["q": .string(partial.query), "limit": 5],
        transport: controller.transport)
      if Task.isCancelled { return }
      let items = (body["actors"]?.arrayValue ?? []).filter { !($0["handle"]?.stringValue ?? "").isEmpty }
      mention = MentionLookup(range: partial, status: .ready, items: Array(items.prefix(5)))
    } catch {
      if !Task.isCancelled { mention = MentionLookup(range: partial, status: .error, items: []) }
    }
  }

  private func pick(_ actor: JSONValue) {
    guard let mention, let handle = actor["handle"]?.stringValue, !handle.isEmpty else { return }
    let edit = ComposerEditing.insertMention(text, mention.range, handle)
    self.mention = nil
    let at = controller.indexOfPost(postId)
    guard at >= 0 else { return }
    controller.dispatch(.setText(index: at, text: edit.text))
    controller.pendingCaret[postId] = Int(edit.caret)
  }

  // MARK: Pasting

  /// True when the paste was taken here (an inline link, or pictures).
  private func paste(_ range: NSRange) -> Bool {
    let board = UIPasteboard.general
    let pastedText = board.string ?? ""
    let at = controller.indexOfPost(postId)
    guard at >= 0 else { return false }
    switch ComposerEditing.pasteAsInlineLink(text, range.location, range.location + range.length, pastedText) {
    case .refused(let note)?:
      pasteNote = note
      return true
    case .linked(let edit)?:
      pasteNote = ""
      controller.dispatch(.setText(index: at, text: edit.text))
      controller.pendingCaret[postId] = Int(edit.caret)
      return true
    case nil:
      pasteNote = ""
    }
    guard pastedText.jsTrimmed().isEmpty, board.hasImages else { return false }
    return controller.pasteFiles(at, PasteboardItems.read(board), text: pastedText)
  }
}

/// UIPasteboard's items as media.js reads a clipboard: each image as a file
/// (written to a temporary file, its ref the path), each string as one.
enum PasteboardItems {
  static func read(_ board: UIPasteboard) -> [PastedItem] {
    var out: [PastedItem] = []
    for item in board.items {
      for (identifier, value) in item {
        guard let type = UTType(identifier) else { continue }
        if type.conforms(to: .image) {
          let data: Data?
          if let raw = value as? Data {
            data = raw
          } else if let image = value as? UIImage {
            data = image.pngData()
          } else {
            data = nil
          }
          let mime = (value is UIImage ? UTType.png : type).preferredMIMEType ?? "image/png"
          let file = data.flatMap { TemporaryComposerFiles.write($0, mime: mime, name: "pasted") }
          out.append(PastedItem(kind: "file", type: mime, file: file))
        } else if type.conforms(to: .text) {
          out.append(PastedItem(kind: "string", type: "text/plain", file: nil))
        }
      }
    }
    return out
  }
}

/// `.suggest-pop`: who the mention might be, and its status line.
struct MentionList: View {
  @Environment(\.virgaTheme) private var theme
  let mention: MentionLookup
  let pick: (JSONValue) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(mention.items.enumerated()), id: \.offset) { _, actor in
        row(actor)
      }
      if mention.items.isEmpty {
        Text(status)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .padding(theme.space3)
      }
    }
    .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.radiusLg))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Accounts to mention")
  }

  private var status: String {
    switch mention.status {
    case .error: return "Couldn’t look up accounts just now."
    case .loading: return "Looking…"
    case .ready: return "No one found for “\(mention.range.query)”."
    }
  }

  private func row(_ actor: JSONValue) -> some View {
    let handle = actor["handle"]?.stringValue ?? ""
    let name = actor["displayName"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? handle
    return Button {
      pick(actor)
    } label: {
      HStack(spacing: theme.space2) {
        Avatar(src: actor["avatar"]?.stringValue, name: name, size: .small)
        VStack(alignment: .leading, spacing: 0) {
          Text(name).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
          Text("@\(handle)").virgaText(.textSm).foregroundStyle(theme.muted)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, theme.space3)
      .padding(.vertical, theme.space2)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(name), @\(handle)")
  }
}

/// `.suggest-pop` for "/": the templates the shortcut could mean, or why
/// there are none.
struct SlashList: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let slash: SlashCommand
  let onOpenLibrary: () -> Void
  let pick: (PostTemplate) -> Void

  var body: some View {
    let replying = controller.state.reply != nil
    let templates = controller.templates.templates
    let ranked = Library.rankTemplatesForSlash(
      templates, parentText: controller.state.reply?.text ?? "", usage: controller.templateUsage(), replying: replying)
    let matches = PostTemplates.matchShortcut(ranked, slash.query, replying: replying, limit: 5)
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(matches.enumerated()), id: \.offset) { _, template in
        row(template)
      }
      if matches.isEmpty {
        Text(status(templates))
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .padding(theme.space3)
      }
      Rectangle().fill(theme.line).frame(height: 1)
      Button(action: onOpenLibrary) {
        Label("Open the library", systemImage: ComposerGlyph.library)
          .virgaText(.textSm, weight: VirgaWeight.medium)
          .foregroundStyle(theme.ink)
          .padding(.horizontal, theme.space3)
          .frame(maxWidth: .infinity, minHeight: Measure.Touch.target, alignment: .leading)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("slash-open-library")
    }
    .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.radiusLg))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Templates")
    .accessibilityIdentifier("slash-templates")
  }

  private func status(_ templates: [PostTemplate]) -> String {
    if controller.templates.loading { return "Looking for your templates…" }
    if controller.templates.error != nil { return "Couldn’t load your templates." }
    if templates.isEmpty { return "No templates yet. Make one from your library." }
    return slash.query.isEmpty ? "None of your templates has a shortcut yet." : "No template uses /\(slash.query)."
  }

  private func row(_ template: PostTemplate) -> some View {
    let name = template.name.isEmpty ? "Untitled template" : template.name
    return Button {
      pick(template)
    } label: {
      HStack(spacing: theme.space2) {
        Text(name).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
        if !template.shortcut.isEmpty {
          Text("/\(template.shortcut)").virgaText(.textSm).foregroundStyle(theme.muted)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, theme.space3)
      .frame(minHeight: Measure.Touch.target)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(template.shortcut.isEmpty ? name : "\(name), /\(template.shortcut)")
    .accessibilityIdentifier("slash-template-\(template.shortcut)")
  }
}

/// The editor's type: composer.css's `.post-editor-input`, in UIKit's terms.
struct EditorStyle {
  var font: UIFont
  var ink: UIColor
  var faint: UIColor
  var tint: UIColor
  var lineHeight: CGFloat
  var kern: CGFloat

  @MainActor
  init(theme: VirgaTheme) {
    let size = theme.scaled(ComposerMeasure.editorSize)
    if theme.hasTypeface, let face = VirgaTypeface.face(size: size, weight: ComposerMeasure.editorWeight) {
      font = unsafeBitCast(face, to: UIFont.self)
    } else {
      font = UIFont.systemFont(ofSize: size, weight: .medium)
    }
    ink = UIColor(theme.ink)
    faint = UIColor(theme.faint)
    tint = UIColor(theme.accent)
    lineHeight = size * ComposerMeasure.editorLineHeight
    kern = size * ComposerMeasure.editorTracking
  }

  var base: [NSAttributedString.Key: Any] {
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
    return [
      .font: font, .foregroundColor: ink, .kern: kern, .paragraphStyle: paragraph,
      .baselineOffset: (lineHeight - font.lineHeight) / 4,
    ]
  }

  /// The text with its highlights: a line under what Bluesky will make a
  /// link of, the brackets of an inline link faint.
  func attributed(_ segments: [HighlightSegment], text: String) -> NSAttributedString {
    let out = NSMutableAttributedString(string: text, attributes: base)
    apply(segments, to: out)
    return out
  }

  func apply(_ segments: [HighlightSegment], to storage: NSMutableAttributedString) {
    let total = storage.length
    storage.setAttributes(base, range: NSRange(location: 0, length: total))
    var at = 0
    for segment in segments {
      let length = segment.text.utf16.count
      defer { at += length }
      guard at + length <= total, length > 0 else { continue }
      let range = NSRange(location: at, length: length)
      switch segment.kind {
      case "mention", "link", "tag":
        storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
      case "syntax":
        storage.addAttribute(.foregroundColor, value: faint, range: range)
      default:
        break
      }
    }
  }
}

/// A UITextView that hands its pastes (and ⌘↩) to the composer first.
final class ComposerTextView: UITextView {
  var pasteHandler: ((NSRange) -> Bool)?
  var sendHandler: (() -> Void)?

  override func paste(_ sender: Any?) {
    if pasteHandler?(selectedRange) == true { return }
    super.paste(sender)
  }

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(UIResponderStandardEditActions.paste(_:)), UIPasteboard.general.hasImages {
      return isEditable
    }
    return super.canPerformAction(action, withSender: sender)
  }

  override var keyCommands: [UIKeyCommand]? {
    let send = UIKeyCommand(input: "\r", modifierFlags: .command, action: #selector(sendFromKeys))
    return [send] + (super.keyCommands ?? [])
  }

  @objc func sendFromKeys() {
    sendHandler?()
  }
}

struct HighlightedTextView: UIViewRepresentable {
  @Binding var text: String
  var segments: [HighlightSegment]
  var style: EditorStyle
  var label: String
  var identifier: String
  var placeholder: String
  var disabled: Bool
  var caretRequest: Int?
  var focusRequest: Bool
  var onCaret: (Int) -> Void
  var onFocus: () -> Void
  var onRequestsDone: () -> Void
  var onPaste: (NSRange) -> Bool
  var onSend: () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> ComposerTextView {
    let view = ComposerTextView()
    view.delegate = context.coordinator
    view.isScrollEnabled = false
    view.backgroundColor = .clear
    view.textContainerInset = UIEdgeInsets(top: 2, left: 0, bottom: 2, right: 0)
    view.textContainer.lineFragmentPadding = 0
    view.adjustsFontForContentSizeCategory = false
    view.autocapitalizationType = .sentences
    view.spellCheckingType = .yes
    view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    view.attributedText = style.attributed(segments, text: text)
    view.typingAttributes = style.base
    return view
  }

  func updateUIView(_ view: ComposerTextView, context: Context) {
    context.coordinator.parent = self
    view.pasteHandler = onPaste
    view.sendHandler = onSend
    view.isEditable = !disabled
    view.tintColor = style.tint
    view.accessibilityLabel = label
    view.accessibilityIdentifier = identifier
    view.accessibilityHint = text.isEmpty ? placeholder : nil
    if view.text != text {
      let keep = view.selectedRange
      view.attributedText = style.attributed(segments, text: text)
      let length = text.utf16.count
      let caret = min(caretRequest ?? keep.location, length)
      view.selectedRange = NSRange(location: caret, length: 0)
    } else if view.markedTextRange == nil {
      let keep = view.selectedRange
      style.apply(segments, to: view.textStorage)
      view.selectedRange = keep
      if let caretRequest, caretRequest <= text.utf16.count {
        view.selectedRange = NSRange(location: caretRequest, length: 0)
      }
    }
    view.typingAttributes = style.base
    if caretRequest != nil || focusRequest {
      let done = onRequestsDone
      let focus = focusRequest || caretRequest != nil
      DispatchQueue.main.async {
        if focus, !view.isFirstResponder, view.isEditable { view.becomeFirstResponder() }
        done()
      }
    }
  }

  func sizeThatFits(_ proposal: ProposedViewSize, uiView: ComposerTextView, context: Context) -> CGSize? {
    let width = proposal.width ?? 320
    let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    return CGSize(width: width, height: max(ComposerMeasure.editorMinHeight, fitted.height))
  }

  final class Coordinator: NSObject, UITextViewDelegate {
    var parent: HighlightedTextView

    init(_ parent: HighlightedTextView) {
      self.parent = parent
    }

    func textViewDidChange(_ textView: UITextView) {
      parent.text = textView.text
      parent.onCaret(textView.selectedRange.location + textView.selectedRange.length)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
      let end = textView.selectedRange.location + textView.selectedRange.length
      let report = parent.onCaret
      DispatchQueue.main.async { report(end) }
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
      parent.onFocus()
    }
  }
}
#endif
