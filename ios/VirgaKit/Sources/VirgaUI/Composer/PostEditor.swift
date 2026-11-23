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
import CoreText
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

  /// The open suggestion list's place in the composer's scroll.
  private var suggestAnchor: String { "composer-suggest-\(postId)" }

  var body: some View {
    let text = self.text
    // Until detection catches up, the text is drawn plain: never stale
    // colours on characters that moved.
    let segments = detected.text == text ? detected.segments : []
    let notes = ComposerEditing.misleadingLinkNotes(.string(text)) + (pasteNote.isEmpty ? [] : [pasteNote])
    let note = notes.joined(separator: " ")
    VStack(alignment: .leading, spacing: ComposerMeasure.suggestTop) {
      field(text: text, segments: segments)
      if !notes.isEmpty {
        // role="status": a misleading link, or a paste refused, read out.
        Text(note)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .composerAnnounces(note)
      }
      if let mention, mention.range.query.jsEquals(partial?.query ?? "\u{0}") {
        MentionList(mention: mention, anchor: suggestAnchor) { actor in pick(actor) }
          .onAppear { TypingProbe.note("post-editor-\(index)", "L+") }
          .onDisappear { TypingProbe.note("post-editor-\(index)", "L-") }
      }
      if let slash {
        SlashList(
          controller: controller, slash: slash, anchor: suggestAnchor,
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
          set: { next in controller.typed(postId, next) }),
        current: { self.text },
        textChanges: { controller.textChangeCount(postId) },
        segments: segments,
        segmentsText: text,
        style: EditorStyle(theme: theme),
        label: label,
        identifier: "post-editor-\(index)",
        placeholder: placeholder,
        disabled: disabled,
        caretRequest: caretRequest,
        focusRequest: focus,
        onCaret: { caret = $0 },
        onSelection: { range in
          controller.selections[postId] = TextSelection(start: range.location, end: range.location + range.length)
        },
        onFocus: {
          controller.activeIndex = controller.indexOfPost(postId)
          controller.editingPostId = postId
        },
        onBlur: {
          if controller.editingPostId.map({ $0.jsEquals(postId) }) ?? false { controller.editingPostId = nil }
          // Who to mention closes as the field loses focus, a beat later so
          // a press on one of them still lands.
          Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(ComposerMeasure.suggestCloseDelay * 1_000_000_000))
            mention = nil
          }
        },
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

/// UIPasteboard's items as media.js reads a clipboard: one file per pasted
/// picture (written to a temporary file, its ref the path), each string as
/// one. A pasteboard item often holds the same picture under several types
/// (PNG, JPEG, UIKit's image), where a browser's clipboard has one file:
/// each item gives one picture, its first of PNG, JPEG, HEIC or GIF, else
/// its image as PNG.
enum PasteboardItems {
  static let preferred: [UTType] = [.png, .jpeg, .heic, .gif]

  static func read(_ board: UIPasteboard) -> [PastedItem] {
    var out: [PastedItem] = []
    for item in board.items {
      if let picture = picture(item) {
        out.append(picture)
      } else if item.keys.contains(where: { UTType($0)?.conforms(to: .text) ?? false }) {
        out.append(PastedItem(kind: "string", type: "text/plain", file: nil))
      }
    }
    return out
  }

  /// The item's one picture, or nil when it holds none.
  static func picture(_ item: [String: Any]) -> PastedItem? {
    for type in preferred {
      if let data = item[type.identifier] as? Data {
        let mime = type.preferredMIMEType ?? "image/png"
        return PastedItem(kind: "file", type: mime, file: TemporaryComposerFiles.write(data, mime: mime, name: "pasted"))
      }
    }
    for (identifier, value) in item {
      guard let type = UTType(identifier), type.conforms(to: .image) else { continue }
      if let data = value as? Data {
        let mime = type.preferredMIMEType ?? "image/png"
        return PastedItem(kind: "file", type: mime, file: TemporaryComposerFiles.write(data, mime: mime, name: "pasted"))
      }
      if let image = value as? UIImage {
        let mime = UTType.png.preferredMIMEType ?? "image/png"
        return PastedItem(kind: "file", type: mime, file: image.pngData().flatMap { TemporaryComposerFiles.write($0, mime: mime, name: "pasted") })
      }
    }
    return nil
  }
}

/// `.suggest-pop`: on the surface, with a hairline edge and the medium
/// shadow, its list 6 in from the edge.
struct SuggestPopStyle: ViewModifier {
  @Environment(\.virgaTheme) private var theme

  func body(content: Content) -> some View {
    content
      .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.radiusLg))
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusLg))
      .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
      .virgaShadow(theme.shadow(theme.tokens.shadowMd))
  }
}

/// `.suggest-item`: a row of a list of suggestions, 40 tall at least, on the radius.
struct SuggestRowStyle: ViewModifier {
  @Environment(\.virgaTheme) private var theme

  func body(content: Content) -> some View {
    content
      .padding(ComposerMeasure.suggestItemPadding)
      .frame(maxWidth: .infinity, minHeight: ComposerMeasure.suggestItemHeight, alignment: .leading)
      .contentShape(RoundedRectangle(cornerRadius: theme.radius))
  }
}

/// `.suggest-status`: why there's nothing to suggest (role="status").
struct SuggestStatus: View {
  @Environment(\.virgaTheme) private var theme
  let text: String

  var body: some View {
    Text(text)
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .padding(ComposerMeasure.suggestStatusPadding)
      .composerAnnounces(text)
  }
}

/// Scrolls the composer's body the least it can so a view of it (by its
/// id) is wholly in view: the sheet's ScrollViewReader, handed down.
struct ComposerScroller {
  let reveal: @MainActor (String) -> Void
}

private struct ComposerScrollerKey: EnvironmentKey {
  static let defaultValue: ComposerScroller? = nil
}

extension EnvironmentValues {
  /// The composer sheet's scroller (ComposerSheet sets it).
  var composerScroller: ComposerScroller? {
    get { self[ComposerScrollerKey.self] }
    set { self[ComposerScrollerKey.self] = newValue }
  }
}

/// The web's `.suggest-pop` is in the post's flow under the editor, and the
/// dialog grows to hold it, so it is on screen as it opens. The sheet's
/// body scrolls, and its foot and the keyboard can cover what's under the
/// post: the list is brought into view as it opens, and again as its rows
/// come in (`key`).
struct ComposerReveals<Key: Equatable>: ViewModifier {
  @Environment(\.composerScroller) private var scroller
  let anchor: String
  let key: Key

  func body(content: Content) -> some View {
    content
      .id(anchor)
      .onAppear { scroller?.reveal(anchor) }
      .onChange(of: key) { _, _ in scroller?.reveal(anchor) }
  }
}

extension View {
  func suggestPop() -> some View { modifier(SuggestPopStyle()) }
  func suggestRow() -> some View { modifier(SuggestRowStyle()) }
  func composerReveals<Key: Equatable>(_ anchor: String, when key: Key) -> some View {
    modifier(ComposerReveals(anchor: anchor, key: key))
  }
}

/// `.suggest-pop`: who the mention might be, and its status line.
struct MentionList: View {
  @Environment(\.virgaTheme) private var theme
  let mention: MentionLookup
  /// Its place in the composer's scroll.
  let anchor: String
  let pick: (JSONValue) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if !mention.items.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(mention.items.enumerated()), id: \.offset) { _, actor in
            row(actor)
          }
        }
        .padding(ComposerMeasure.suggestListPadding)
      } else {
        SuggestStatus(text: status)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .suggestPop()
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Accounts to mention")
    .composerReveals(anchor, when: mention.items.count)
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
      HStack(spacing: ComposerMeasure.suggestItemGap) {
        Avatar(src: actor["avatar"]?.stringValue, name: name, size: .small)
        VStack(alignment: .leading, spacing: 0) {
          Text(name).virgaText(.textBase, weight: VirgaWeight.medium, lineHeight: ComposerMeasure.suggestLineHeight)
            .foregroundStyle(theme.ink).lineLimit(1)
          Text("@\(handle)").virgaText(.textSm, lineHeight: ComposerMeasure.suggestLineHeight)
            .foregroundStyle(theme.muted).lineLimit(1)
        }
        Spacer(minLength: 0)
      }
      .suggestRow()
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(name), @\(handle)")
  }
}

/// `.suggest-pop` for "/": the templates the shortcut could mean, or why
/// there are none, and Open the library at its foot.
struct SlashList: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let slash: SlashCommand
  /// Its place in the composer's scroll.
  let anchor: String
  let onOpenLibrary: () -> Void
  let pick: (PostTemplate) -> Void

  var body: some View {
    let replying = controller.state.reply != nil
    let templates = controller.templates.templates
    let ranked = Library.rankTemplatesForSlash(
      templates, parentText: controller.state.reply?.text ?? "", usage: controller.templateUsage(), replying: replying)
    let matches = PostTemplates.matchShortcut(ranked, slash.query, replying: replying, limit: 5)
    VStack(alignment: .leading, spacing: 0) {
      if !matches.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(matches.enumerated()), id: \.offset) { _, template in
            row(template)
          }
        }
        .padding(ComposerMeasure.suggestListPadding)
      } else {
        SuggestStatus(text: status(templates))
      }
      Rectangle().fill(theme.line).frame(height: 1)
      Button(action: onOpenLibrary) {
        Label("Open the library", systemImage: ComposerGlyph.library)
          .virgaText(.textSm, weight: VirgaWeight.medium)
          .foregroundStyle(theme.ink)
          .padding(ComposerMeasure.suggestFootPadding)
          .frame(maxWidth: .infinity, minHeight: ComposerMeasure.suggestFootHeight, alignment: .leading)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("slash-open-library")
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .suggestPop()
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Templates")
    .accessibilityIdentifier("slash-templates")
    .composerReveals(anchor, when: matches.count)
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
      HStack(spacing: ComposerMeasure.suggestItemGap) {
        // `.suggest-text`: the name over its shortcut, a column at line-height 1.3.
        VStack(alignment: .leading, spacing: 0) {
          Text(name).virgaText(.textBase, weight: VirgaWeight.medium, lineHeight: ComposerMeasure.suggestLineHeight)
            .foregroundStyle(theme.ink).lineLimit(1)
          if !template.shortcut.isEmpty {
            Text("/\(template.shortcut)").virgaText(.textSm, lineHeight: ComposerMeasure.suggestLineHeight)
              .foregroundStyle(theme.muted).lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
      .suggestRow()
    }
    .buttonStyle(.plain)
    .accessibilityLabel(template.shortcut.isEmpty ? name : "\(name), /\(template.shortcut)")
    .accessibilityIdentifier("slash-template-\(template.shortcut)")
  }
}

/// The editor's type: composer.css's `.post-editor-input`, in UIKit's terms.
/// Two are equal when they draw the same letters in the same colours.
struct EditorStyle: Equatable {
  var font: UIFont
  var ink: UIColor
  var faint: UIColor
  var tint: UIColor
  var lineHeight: CGFloat
  var kern: CGFloat

  @MainActor
  init(theme: VirgaTheme) {
    let size = theme.scaled(ComposerMeasure.editorSize)
    if theme.hasTypeface, let face = Self.face(size: size, weight: ComposerMeasure.editorWeight) {
      font = face
    } else {
      font = UIFont.systemFont(ofSize: size, weight: .medium)
    }
    ink = UIColor(theme.ink)
    faint = UIColor(theme.faint)
    // `caret-color: var(--ink)`. A text view's selection follows its tint
    // too, so the selection is ink where the web's is the accent at 28%.
    tint = UIColor(theme.ink)
    lineHeight = size * ComposerMeasure.editorLineHeight
    kern = size * ComposerMeasure.editorTracking
  }

  @MainActor private static var faces: [String: UIFont] = [:]

  /// The face in its own figures (`font-variant-numeric: normal`): a post's
  /// words aren't a table, so unlike the rest of Virga they aren't tabular.
  @MainActor
  static func face(size: CGFloat, weight: Double) -> UIFont? {
    guard VirgaTypeface.isRegistered else { return nil }
    let key = "\(size)|\(weight)"
    if let held = faces[key] { return held }
    let attributes: [String: Any] = [
      kCTFontNameAttribute as String: VirgaTypeface.postScriptName,
      kCTFontVariationAttribute as String: [NSNumber(value: VirgaTypeface.weightAxis): NSNumber(value: weight)],
    ]
    let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
    let made = unsafeBitCast(CTFontCreateWithFontDescriptor(descriptor, size, nil), to: UIFont.self)
    faces[key] = made
    return made
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
    // ⌘↩ keeps the field focused (as the web's textarea keeps focus), so
    // the field hands on any words its post hasn't had yet before the post
    // is read to send it.
    (delegate as? HighlightedTextView.Coordinator)?.handOnIfAhead(self)
    sendHandler?()
  }

  // The UI tests' typing probe (TypingProbe): what reached the field.
  override func insertText(_ text: String) {
    if TypingProbe.isOn, let id = accessibilityIdentifier { TypingProbe.insert(id, text, in: self) }
    super.insertText(text)
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if TypingProbe.isOn, let id = accessibilityIdentifier {
      TypingProbe.press(id, presses.compactMap { $0.key?.characters }.joined())
    }
    super.pressesBegan(presses, with: event)
  }
}

struct HighlightedTextView: UIViewRepresentable {
  /// Where the field hands its text on: textViewDidChange, and
  /// handOnIfAhead (as the field loses focus, and before ⌘↩ sends). Read
  /// only in updateUIView, to note in the typing probe when it disagrees
  /// with the post.
  @Binding var text: String
  /// The post's text as it is at the moment of asking. makeUIView and
  /// updateUIView decide from this, not the binding: in CI run 88 an update read the binding a
  /// key behind the field, after the field had handed that key to the post,
  /// and put the older text back over it (TypingProbe's R events, all while
  /// the "@" list was up). The post already has every key the field has
  /// handed on.
  var current: () -> String
  /// ComposerController.textChangeCount: how many times something other than
  /// its field has changed this post's text.
  var textChanges: () -> Int
  /// The highlights, found for `segmentsText` (the post's text when
  /// PostEditor's body ran).
  var segments: [HighlightSegment]
  var segmentsText: String
  var style: EditorStyle
  var label: String
  var identifier: String
  var placeholder: String
  var disabled: Bool
  var caretRequest: Int?
  var focusRequest: Bool
  var onCaret: (Int) -> Void
  /// The whole selection, as it changes (the controller's `selectionOf`).
  var onSelection: (NSRange) -> Void
  var onFocus: () -> Void
  /// The field lost focus (the web's blur).
  var onBlur: () -> Void
  var onRequestsDone: () -> Void
  var onPaste: (NSRange) -> Bool
  var onSend: () -> Void

  /// What the field's attributes were last set from.
  struct Drawn: Equatable {
    var text: String
    var segments: [HighlightSegment]
    var style: EditorStyle
  }

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
    // From the post itself, so a new field never starts behind it.
    let text = current()
    let segments = segmentsText == text ? self.segments : []
    view.attributedText = style.attributed(segments, text: text)
    view.typingAttributes = style.base
    context.coordinator.changes = textChanges()
    context.coordinator.drawn = Drawn(text: text, segments: segments, style: style)
    return view
  }

  /// Runs on every redraw while typing (the text, the caret, a lookup, the
  /// highlights), several times a keystroke, so it changes the field only
  /// where something changed: the attributes when what they're drawn from
  /// did, the selection when it moved. Either is an edit the keyboard didn't
  /// make, landing between its keys.
  func updateUIView(_ view: ComposerTextView, context: Context) {
    let coordinator = context.coordinator
    coordinator.parent = self
    let seen = self.text
    let text = current()
    // Highlights found for other text would underline the wrong letters:
    // plain until the redraw that catches up.
    let segments = segmentsText == text ? self.segments : []
    if TypingProbe.isOn, seen != text {
      TypingProbe.note(identifier, "B\(seen.utf16.count)>\(text.utf16.count)")
      TypingProbe.count(identifier, "staleBinding")
    }
    let changes = textChanges()
    view.pasteHandler = onPaste
    view.sendHandler = onSend
    view.isEditable = !disabled
    view.tintColor = style.tint
    view.accessibilityLabel = label
    view.accessibilityIdentifier = identifier
    view.accessibilityHint = text.isEmpty ? placeholder : nil
    let drawn = Drawn(text: text, segments: segments, style: style)
    // The post's text goes in the field only when something other than the
    // field has changed it since they last agreed. Otherwise a field that
    // differs is ahead of the post, not wrong: its last keys haven't reached
    // the post yet, part way through UIKit's edit or not, and putting the
    // post's text back would take them out or put the caret in front of them
    // (CI run 90: "garden-nots e").
    let ahead = changes == coordinator.changes
    if TypingProbe.isOn {
      let branch = view.text == text ? "same" : ahead ? "ahead" : "reset"
      TypingProbe.update(
        identifier, editing: coordinator.editing, branch: branch, field: view.text.utf16.count, model: text.utf16.count)
    }
    if view.text == text {
      coordinator.changes = changes
      if view.markedTextRange == nil {
        let keep = view.selectedRange
        if coordinator.drawn != drawn {
          let storage = view.textStorage
          storage.beginEditing()
          style.apply(segments, to: storage)
          storage.endEditing()
          coordinator.drawn = drawn
          TypingProbe.count(identifier, "attributes")
        }
        var caret = keep
        if let caretRequest, caretRequest <= text.utf16.count {
          caret = NSRange(location: caretRequest, length: 0)
        }
        if view.selectedRange != caret {
          view.selectedRange = caret
          TypingProbe.note(identifier, "S\(caret.location)")
        }
      }
    } else if ahead {
      // The field keeps its text, and the post gets it from the field's own
      // next textViewDidChange, or when the field loses focus. An update
      // never writes to the post: CI run 92's iPad, which handed the field's
      // text on from here, never went idle again once a composer opened a
      // second time.
      if !coordinator.editing {
        TypingProbe.note(identifier, "K\(view.text.utf16.count)>\(text.utf16.count)")
        TypingProbe.count(identifier, "kept")
      }
    } else {
      let keep = view.selectedRange
      view.attributedText = style.attributed(segments, text: text)
      coordinator.changes = changes
      coordinator.drawn = drawn
      let length = text.utf16.count
      let caret = min(caretRequest ?? keep.location, length)
      view.selectedRange = NSRange(location: caret, length: 0)
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

  @MainActor
  final class Coordinator: NSObject, UITextViewDelegate {
    var parent: HighlightedTextView
    /// UIKit has asked to change the text and not yet said it did.
    var editing = false
    /// ComposerController.textChanges when the field and the post last
    /// agreed, or the field last took the post's text.
    var changes = 0
    /// What the field's attributes were last set from, or nil once an edit
    /// of UIKit's own may have changed them since.
    var drawn: Drawn?

    init(_ parent: HighlightedTextView) {
      self.parent = parent
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
      editing = true
      TypingProbe.shouldChange(parent.identifier, in: textView, range: range, text: text)
      return true
    }

    func textViewDidChange(_ textView: UITextView) {
      editing = false
      TypingProbe.didChange(parent.identifier, in: textView)
      // The letters UIKit put in took the typing attributes, not the
      // highlights, so the next redraw sets them again even when the text
      // came out the same (a paste or a retyped letter over itself).
      drawn = nil
      parent.text = textView.text
      parent.onCaret(textView.selectedRange.location + textView.selectedRange.length)
      parent.onSelection(textView.selectedRange)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
      let range = textView.selectedRange
      let end = range.location + range.length
      let report = parent.onCaret
      let select = parent.onSelection
      DispatchQueue.main.async {
        report(end)
        select(range)
      }
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
      parent.onFocus()
    }

    func textViewDidEndEditing(_ textView: UITextView) {
      handOnIfAhead(textView)
      parent.onBlur()
    }

    /// A field still ahead of its post hands its words on, once, unless
    /// something else has changed the post since they last agreed (then the
    /// next update puts the post's text in the field). As the field loses
    /// focus (a send button takes it first, ComposerController.runAction),
    /// and before ⌘↩ sends.
    func handOnIfAhead(_ textView: UITextView) {
      let field = textView.text ?? ""
      guard parent.current() != field, parent.textChanges() == changes else { return }
      TypingProbe.note(parent.identifier, "H\(field.utf16.count)")
      TypingProbe.count(parent.identifier, "handedOn")
      parent.text = field
    }
  }
}
#endif
