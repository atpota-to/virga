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
//
// Both lists take the web's keys (onKeyDown, SuggestionKeys): ↑ and ↓ move
// the marked row (--hover, read as selected), round at the ends; Return or
// Tab takes it; Escape closes the list, which stays closed until the
// mention or shortcut changes. The text view asks for them only while a
// list is up, and leaves them to an input method that is composing. The
// web hears every key once, at keydown; UIKit can hand a hardware key in
// by a key command or by its press, so the text view takes Return, Tab and
// Escape by whichever comes first and never twice. The software keyboard's
// Return takes the marked row too, as Safari sends keydown Enter for it.

#if canImport(UIKit)
import CoreText
import QuartzCore
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

  /// The lookup as it starts for `partial`: loading, with the accounts it
  /// had only while the query is the same (the web's effect).
  static func starting(_ partial: PartialMention, after previous: MentionLookup?) -> MentionLookup {
    let same = previous.map { $0.range.query.jsEquals(partial.query) } ?? false
    return MentionLookup(range: partial, status: .loading, items: same ? previous?.items ?? [] : [])
  }

  /// True when this is the lookup for `partial`: the same place and query,
  /// what the lookup's task is keyed on.
  func isFor(_ partial: PartialMention) -> Bool {
    range.start == partial.start && range.query.jsEquals(partial.query)
  }

  /// What the lookup's task is keyed on: the mention's place and query.
  static func key(_ partial: PartialMention) -> String { "\(partial.start):\(partial.query)" }
}

/// The "/" list's marked row, for the shortcut it was marked in: the web's
/// `slashIndex`, set back to 0 as the shortcut changes.
struct SlashMark: Equatable {
  var start: Int
  var query: String
  var index: Int

  /// What the web's effect watches: the shortcut's place and query.
  static func key(_ slash: SlashCommand) -> String { "\(slash.start):\(slash.query)" }
}

/// The keys an open suggestion list takes from its field: the lists as
/// they are when a key comes in, and what to do with the key's action
/// (PostEditor's). ComposerTextView asks as each key comes in, so a key
/// acts on what is drawn at that moment.
struct SuggestionKeyHandler {
  var lists: () -> SuggestionKeys.Lists
  var act: (SuggestionKeys.Action) -> Void
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
  /// The mention (MentionLookup.key) whose list Escape closed: it stays
  /// closed, its lookup still running included, until the mention changes.
  @State private var closedMention: String?
  @State private var slashMark: SlashMark?
  /// Where the shortcut starts whose list Escape closed: closed until the
  /// caret leaves it (the web's `slashDismissed`).
  @State private var slashDismissed: Int?
  @State private var pasteNote = ""
  @State private var focusTick = 0

  private var text: String {
    controller.state.posts.first { $0.id.jsEquals(postId) }?.text ?? ""
  }

  private var partial: PartialMention? {
    guard let m = Mentions.detectPartialMention(text, caret), m.query.utf16.count >= 1 else { return nil }
    return m
  }

  /// What the "@" list shows: nothing once the mention is done or the list
  /// was closed. It stays up while the mention is typed, as the web's does;
  /// a key the lookup hasn't caught up with shows what the lookup will start
  /// with. A key never takes the list down to put it back when the lookup
  /// starts, which would read its status out again, scroll to it and change
  /// the height of an iPad's sheet.
  private var shownMention: MentionLookup? {
    guard let mention, let partial else { return nil }
    return mention.isFor(partial) ? mention : MentionLookup.starting(partial, after: mention)
  }

  /// The "/shortcut" being typed, while no mention is, unless Escape
  /// closed its list.
  private var slash: SlashCommand? {
    guard partial == nil, let found = Library.detectSlashCommand(text, caret) else { return nil }
    return found.start == slashDismissed ? nil : found
  }

  /// The templates the shortcut could mean.
  private func slashMatches(_ slash: SlashCommand) -> [PostTemplate] {
    SlashList.matches(controller, slash)
  }

  /// The "/" list's marked row: 0 until the arrows move it in this shortcut.
  private func slashIndex(_ slash: SlashCommand) -> Int {
    guard let slashMark, slashMark.start == slash.start, slashMark.query.jsEquals(slash.query) else { return 0 }
    return slashMark.index
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
      if let shown = shownMention {
        MentionList(mention: shown, anchor: suggestAnchor) { actor in pick(actor, from: shown) }
          .onAppear { TypingProbe.note("post-editor-\(index)", "L+") }
          .onDisappear { TypingProbe.note("post-editor-\(index)", "L-") }
      }
      if let slash {
        SlashList(
          controller: controller, slash: slash, matches: slashMatches(slash), marked: slashIndex(slash),
          anchor: suggestAnchor,
          onOpenLibrary: { controller.openLibrary(postId, range: TextSelection(start: slash.start, end: slash.end)) }
        ) { template in
          controller.applyTemplate(postId, template, range: TextSelection(start: slash.start, end: slash.end))
        }
      }
    }
    .task(id: text) { await detect(text) }
    .task(id: partial.map(MentionLookup.key)) { await lookUp(partial) }
    // The web's effect: a "/" list Escape closed opens again once the caret
    // has left the shortcut.
    .onChange(of: Library.detectSlashCommand(text, caret) == nil) { _, gone in
      if gone && slashDismissed != nil { slashDismissed = nil }
    }
    // The web's other effect: the "/" list's mark goes back to the first row
    // whenever the shortcut changes, even back to the one it was moved in (a
    // letter typed and taken out, the caret leaving and coming back,
    // Escape). slashIndex's own check covers the moment before this runs.
    .onChange(of: slash.map(SlashMark.key)) { _, _ in
      if slashMark != nil { slashMark = nil }
    }
  }

  // MARK: Keys

  /// The lists as they are now, for a key coming in.
  private func keyLists() -> SuggestionKeys.Lists {
    let shown = shownMention
    var lists = SuggestionKeys.Lists(
      mentionOpen: shown != nil, mentionRows: shown?.items.count ?? 0, mentionIndex: shown?.index ?? 0)
    if let slash {
      lists.slashOpen = true
      lists.slashRows = slashMatches(slash).count
      lists.slashIndex = slashIndex(slash)
    }
    return lists
  }

  /// A key's action on the lists, as the web's onKeyDown takes it: a row
  /// taken goes in as a press on it would, and the row marked is read out
  /// (the web's aria-activedescendant).
  private func act(_ action: SuggestionKeys.Action) {
    switch action {
    case .field:
      return
    case .markMention(let row):
      guard var shown = shownMention, shown.items.indices.contains(row) else { return }
      shown.index = row
      mention = shown
      AccessibilityNotification.Announcement(MentionList.spoken(shown.items[row])).post()
    case .pickMention(let row):
      guard let shown = shownMention, shown.items.indices.contains(row) else { return }
      pick(shown.items[row], from: shown)
    case .markSlash(let row):
      guard let slash else { return }
      let matches = slashMatches(slash)
      guard matches.indices.contains(row) else { return }
      slashMark = SlashMark(start: slash.start, query: slash.query, index: row)
      AccessibilityNotification.Announcement(SlashList.spoken(matches[row])).post()
    case .pickSlash(let row):
      guard let slash else { return }
      let matches = slashMatches(slash)
      guard matches.indices.contains(row) else { return }
      controller.applyTemplate(postId, matches[row], range: TextSelection(start: slash.start, end: slash.end))
    case .close(let closesMention, let closesSlash):
      if closesMention, let partial {
        mention = nil
        closedMention = MentionLookup.key(partial)
      }
      if closesSlash, let slash { slashDismissed = slash.start }
    }
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
        onSend: { controller.sendFromKeyboard() },
        suggestionKeys: SuggestionKeyHandler(lists: { keyLists() }, act: { act($0) }))
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
    // A list Escape closed stays closed for its own mention only.
    let key = partial.map(MentionLookup.key)
    if closedMention != nil && closedMention != key { closedMention = nil }
    guard let partial else {
      mention = nil
      return
    }
    // Closed by Escape while this lookup was on its way, so its answer
    // doesn't bring the list back (the web's would, a beat after Escape).
    func closed() -> Bool { closedMention == key }
    if closed() { return }
    mention = .starting(partial, after: mention)
    try? await Task.sleep(nanoseconds: 150_000_000)
    if Task.isCancelled || closed() { return }
    do {
      let body = try await PublicAppView.publicXrpc(
        "app.bsky.actor.searchActorsTypeahead", ["q": .string(partial.query), "limit": 5],
        transport: controller.transport)
      if Task.isCancelled || closed() { return }
      let items = (body["actors"]?.arrayValue ?? []).filter { !($0["handle"]?.stringValue ?? "").isEmpty }
      mention = MentionLookup(range: partial, status: .ready, items: Array(items.prefix(5)))
    } catch {
      if !Task.isCancelled && !closed() { mention = MentionLookup(range: partial, status: .error, items: []) }
    }
  }

  /// `actor` picked from the list as it was drawn (`lookup`), over the
  /// mention it was drawn for.
  private func pick(_ actor: JSONValue, from lookup: MentionLookup) {
    guard mention != nil, let handle = actor["handle"]?.stringValue, !handle.isEmpty else { return }
    let edit = ComposerEditing.insertMention(text, lookup.range, handle)
    mention = nil
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

/// `.suggest-item`'s fill: --hover on the row the arrow keys are on
/// (`aria-selected`), and on the one under the pointer or a finger. The
/// "@" and "/" lists and the language picker's suggestions wear it.
struct SuggestItemStyle: ButtonStyle {
  var marked = false

  func makeBody(configuration: Configuration) -> some View {
    SuggestItemBody(label: configuration.label, lit: marked || configuration.isPressed)
  }
}

struct SuggestItemBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  let label: Label
  let lit: Bool
  @State private var hovered = false

  var body: some View {
    label
      .background(RoundedRectangle(cornerRadius: theme.radius).fill(lit || hovered ? theme.hover : Color.clear))
      .onHover { hovered = $0 }
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

/// Scrolls the least it can so a view (by its id) is wholly in view: a
/// ScrollViewReader handed down, the composer sheet's round its body, or
/// `composerScrolling()`'s round a page or dialog holding a language picker.
struct ComposerScroller {
  let reveal: @MainActor (String) -> Void
}

private struct ComposerScrollerKey: EnvironmentKey {
  static let defaultValue: ComposerScroller? = nil
}

extension EnvironmentValues {
  /// The scroller of the scroll view this is in, where one is lent
  /// (ComposerSheet, and `composerScrolling()` in Settings' pages and the
  /// Language dialog).
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

/// `.suggest-pop`: who the mention might be, and its status line. The row
/// `mention.index` is marked: the one Return takes.
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
          ForEach(Array(mention.items.enumerated()), id: \.offset) { index, actor in
            row(actor, index: index)
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
    .accessibilityIdentifier("mention-list")
    .composerReveals(anchor, when: mention.items.count)
  }

  static func handle(_ actor: JSONValue) -> String { actor["handle"]?.stringValue ?? "" }

  static func name(_ actor: JSONValue) -> String {
    actor["displayName"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? handle(actor)
  }

  /// A row as VoiceOver reads it: the name, then the handle.
  static func spoken(_ actor: JSONValue) -> String { "\(name(actor)), @\(handle(actor))" }

  private var status: String {
    switch mention.status {
    case .error: return "Couldn’t look up accounts just now."
    case .loading: return "Looking…"
    case .ready: return "No one found for “\(mention.range.query)”."
    }
  }

  private func row(_ actor: JSONValue, index: Int) -> some View {
    let handle = Self.handle(actor)
    let name = Self.name(actor)
    let marked = index == mention.index
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
    .buttonStyle(SuggestItemStyle(marked: marked))
    .accessibilityLabel(Self.spoken(actor))
    .accessibilityAddTraits(marked ? .isSelected : [])
    .accessibilityIdentifier("mention-option-\(index)")
  }
}

/// `.suggest-pop` for "/": the templates the shortcut could mean (the row
/// `marked` is the one Return takes), or why there are none, and Open the
/// library at its foot.
struct SlashList: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let slash: SlashCommand
  /// `SlashList.matches(controller, slash)`.
  let matches: [PostTemplate]
  let marked: Int
  /// Its place in the composer's scroll.
  let anchor: String
  let onOpenLibrary: () -> Void
  let pick: (PostTemplate) -> Void

  /// The templates the shortcut could mean, at most five
  /// (rankTemplatesForSlash, matchShortcut).
  static func matches(_ controller: ComposerController, _ slash: SlashCommand) -> [PostTemplate] {
    let replying = controller.state.reply != nil
    let ranked = Library.rankTemplatesForSlash(
      controller.templates.templates, parentText: controller.state.reply?.text ?? "",
      usage: controller.templateUsage(), replying: replying)
    return PostTemplates.matchShortcut(ranked, slash.query, replying: replying, limit: 5)
  }

  /// A row as VoiceOver reads it: the name, then the shortcut.
  static func spoken(_ template: PostTemplate) -> String {
    let name = template.name.isEmpty ? "Untitled template" : template.name
    return template.shortcut.isEmpty ? name : "\(name), /\(template.shortcut)"
  }

  var body: some View {
    let templates = controller.templates.templates
    VStack(alignment: .leading, spacing: 0) {
      if !matches.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(matches.enumerated()), id: \.offset) { index, template in
            row(template, marked: index == marked)
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

  private func row(_ template: PostTemplate, marked: Bool) -> some View {
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
    .buttonStyle(SuggestItemStyle(marked: marked))
    .accessibilityLabel(Self.spoken(template))
    .accessibilityAddTraits(marked ? .isSelected : [])
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

/// A UITextView that hands its pastes (and ⌘↩) to the composer first, and
/// its keys to a suggestion list that is up.
final class ComposerTextView: UITextView {
  var pasteHandler: ((NSRange) -> Bool)?
  var sendHandler: (() -> Void)?
  /// The "@" and "/" lists' keys (PostEditor.jsx's onKeyDown).
  var suggestionKeys: SuggestionKeyHandler?
  /// The hardware presses of Return, Tab and Escape a list took in
  /// pressesBegan (and a key-less twin UIKit sends beside some keys in the
  /// same set), until each ends: no phase of them goes on to the text view,
  /// and while one is down its key command and insertText don't take the
  /// key again.
  private var heldListPresses: [UIPress: SuggestionKeys.Key] = [:]
  /// The list key a key command last acted on, and when (CACurrentMediaTime,
  /// the clock of a press's timestamp). A press of that key stamped no later
  /// is the one the command took, should UIKit hand it to pressesBegan too.
  /// Forgotten when a press of that key ends or is cancelled: a key's press
  /// ends before its next press begins, so a press that begins after that
  /// is a new one, even one stamped before a command that waited on a busy
  /// main thread.
  private var commandTook: (key: SuggestionKeys.Key, at: CFTimeInterval)?
  /// True while insertText hands a letter to UIKit's own insertText: the
  /// typing probe's way of telling a new line that came that way from one
  /// that reached the delegate by another.
  private(set) var insertingThrough = false

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
    return [send] + listCommands() + (super.keyCommands ?? [])
  }

  /// A hardware keyboard's keys for a list that is up, ahead of the text
  /// view's own use of them (the caret's moves, a new line): ↑ and ↓ with
  /// or without a modifier (the web reads none), Return and Tab while it
  /// has rows (⇧⇥ too: the web's Tab is taken with anything held but ⌘ or
  /// ⌃), Escape while it is up. Only then, so every other key reaches the
  /// text view as before, and none while an input method is composing.
  /// Return, Tab and Escape are taken from their press as well
  /// (pressesBegan), should UIKit not hand them to these.
  private func listCommands() -> [UIKeyCommand] {
    guard let handler = suggestionKeys else { return [] }
    guard markedTextRange == nil else {
      if TypingProbe.isOn, let id = accessibilityIdentifier {
        TypingProbe.commands(id, handler.lists().takesEscape ? "composing" : "none")
      }
      return []
    }
    let lists = handler.lists()
    var commands: [UIKeyCommand] = []
    if lists.takesArrows {
      for flags in Self.arrowModifiers {
        commands.append(Self.listCommand(UIKeyCommand.inputUpArrow, flags, #selector(listUp)))
        commands.append(Self.listCommand(UIKeyCommand.inputDownArrow, flags, #selector(listDown)))
      }
      commands.append(Self.listCommand("\r", [], #selector(listReturn)))
      commands.append(Self.listCommand("\t", [], #selector(listTab)))
      commands.append(Self.listCommand("\t", .shift, #selector(listBackTab)))
    }
    if lists.takesEscape {
      commands.append(Self.listCommand(UIKeyCommand.inputEscape, [], #selector(listEscape)))
    }
    if TypingProbe.isOn, let id = accessibilityIdentifier {
      TypingProbe.commands(id, commands.isEmpty ? "none" : lists.takesArrows ? "rows" : "escape")
    }
    return commands
  }

  private static let arrowModifiers: [UIKeyModifierFlags] = [[], .shift, .alternate, .command, .control]

  private static func listCommand(_ input: String, _ flags: UIKeyModifierFlags, _ action: Selector) -> UIKeyCommand {
    let command = UIKeyCommand(input: input, modifierFlags: flags, action: action)
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  @objc func listUp() { commandKey(.up, "up") }
  @objc func listDown() { commandKey(.down, "down") }
  @objc func listEscape() { commandKey(.escape, "esc") }
  // Should the list have gone between the key and its command, the key is
  // typed as it would have been.
  @objc func listReturn() { commandKey(.enter, "ret", typing: "\n") }
  @objc func listTab() { commandKey(.tab, "tab", typing: "\t") }
  // ⇧⇥ has no letter to type, so should the list have gone it does nothing.
  @objc func listBackTab() { commandKey(.tab, "btab") }

  /// A list key from its key command: nothing while its press, taken in
  /// pressesBegan, is still down (that was this key); otherwise the key
  /// goes to the lists as they are now, or is typed. Noted, so that its
  /// press goes no further should UIKit hand that on to pressesBegan after
  /// the command.
  private func commandKey(_ key: SuggestionKeys.Key, _ name: String, typing: String? = nil) {
    if isHeld(key) {
      noteListKey("c", name, "dup")
      return
    }
    if !takeListKey(key, "c", name), let typing { insertText(typing) }
    commandTook = (key, CACurrentMediaTime())
  }

  /// The key's action on the lists as they are now (SuggestionKeys); true
  /// when the key was theirs. `command` and `control` are what the press
  /// held, where it came by its press; `route` and `name` are for the
  /// typing probe.
  @discardableResult
  private func takeListKey(
    _ key: SuggestionKeys.Key, _ route: String, _ name: String, command: Bool = false, control: Bool = false
  ) -> Bool {
    guard let handler = suggestionKeys else { return false }
    let lists = handler.lists()
    let action = SuggestionKeys.action(key, lists: lists, composing: markedTextRange != nil, command: command, control: control)
    if TypingProbe.isOn { noteListKey(route, name, probeResult(action, lists)) }
    if action == .field { return false }
    handler.act(action)
    return true
  }

  @objc func sendFromKeys() {
    // ⌘↩ keeps the field focused (as the web's textarea keeps focus), so
    // the field hands on any words its post hasn't had yet before the post
    // is read to send it.
    (delegate as? HighlightedTextView.Coordinator)?.handOnIfAhead(self)
    sendHandler?()
  }

  // A Return or Tab a list with rows takes goes no further: the software
  // keyboard's Return on a phone (Safari sends keydown Enter for it, so
  // the web takes the marked row too) and a hardware key that came this
  // way. One that comes while the list's own press of that key is still
  // down is that key, taken already. Every other key, and these with no
  // list, as before. Then the UI tests' typing probe (TypingProbe): what
  // reached the field.
  override func insertText(_ text: String) {
    if text == "\n" || text == "\t" {
      let key: SuggestionKeys.Key = text == "\n" ? .enter : .tab
      let name = text == "\n" ? "ret" : "tab"
      if isHeld(key) {
        noteListKey("i", name, "dup")
        return
      }
      if takeListKey(key, "i", name) { return }
    }
    if TypingProbe.isOn, let id = accessibilityIdentifier { TypingProbe.insert(id, text, in: self) }
    let through = insertingThrough
    insertingThrough = true
    super.insertText(text)
    insertingThrough = through
  }

  // MARK: Presses

  /// A hardware keyboard's Return (the keypad's Enter too), Tab and Escape,
  /// taken from the press as it comes in when the lists take the key
  /// (SuggestionKeys, with the ⌘ and ⌃ it holds), so they reach the lists
  /// however UIKit would have handed them on. A press its key command took
  /// already goes no further and does nothing more. Every other press, and
  /// these when the lists don't take them, go on to the text view as before.
  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if TypingProbe.isOn, let id = accessibilityIdentifier {
      TypingProbe.press(id, presses.compactMap { $0.key?.characters }.joined())
    }
    var taken: [UIPress: SuggestionKeys.Key] = [:]
    for press in presses {
      // A press that begins now isn't one held before, should UIKit ever
      // hand a press object on to a new press.
      heldListPresses[press] = nil
      guard let uiKey = press.key else { continue }
      if TypingProbe.isOn { noteArrow(uiKey, press) }
      guard let key = Self.pressKey(uiKey) else { continue }
      let flags = uiKey.modifierFlags
      let name = key == .tab && flags.contains(.shift) ? "btab" : Self.probeName(key)
      // A new press of the key: one of it still held ended out of sight.
      heldListPresses = heldListPresses.filter { $0.value != key }
      if let took = commandTook, took.key == key, took.at >= press.timestamp {
        commandTook = nil
        noteListKey("p", name, "dup")
        taken[press] = key
      } else if takeListKey(key, "p", name, command: flags.contains(.command), control: flags.contains(.control)) {
        taken[press] = key
      }
    }
    let twinOf = taken.values.first
    if TypingProbe.isOn {
      for press in presses where press.key == nil {
        noteListKey("p", "keyless\(press.type.rawValue)", twinOf == nil ? "passed" : "held")
      }
    }
    guard let key = twinOf else {
      super.pressesBegan(presses, with: event)
      return
    }
    // The key-less twin of a key taken (its semantic press, a select or a
    // menu) goes no further either, when it comes in the same set. One that
    // comes in a set of its own goes on, as it did before.
    for press in presses where press.key == nil { taken[press] = key }
    heldListPresses.merge(taken) { _, new in new }
    let rest = presses.filter { taken[$0] == nil }
    if !rest.isEmpty { super.pressesBegan(rest, with: event) }
  }

  override func pressesChanged(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    guard !heldListPresses.isEmpty else { return super.pressesChanged(presses, with: event) }
    let rest = presses.filter { heldListPresses[$0] == nil }
    if !rest.isEmpty { super.pressesChanged(rest, with: event) }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if TypingProbe.isOn { noteEnded(presses, "") }
    forgetCommand(presses)
    guard !heldListPresses.isEmpty else { return super.pressesEnded(presses, with: event) }
    let rest = release(presses)
    if !rest.isEmpty { super.pressesEnded(rest, with: event) }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if TypingProbe.isOn { noteEnded(presses, "cancel-") }
    forgetCommand(presses)
    guard !heldListPresses.isEmpty else { return super.pressesCancelled(presses, with: event) }
    let rest = release(presses)
    if !rest.isEmpty { super.pressesCancelled(rest, with: event) }
  }

  /// A press of the key a key command last took has ended, so the press
  /// that command took is over (a key's press ends before its next press
  /// begins): the next press of that key is a new one, whatever its stamp.
  private func forgetCommand(_ presses: Set<UIPress>) {
    guard let took = commandTook else { return }
    if presses.contains(where: { $0.key.flatMap(Self.listKey) == took.key }) { commandTook = nil }
  }

  /// The presses not held, once those held are let go.
  private func release(_ presses: Set<UIPress>) -> Set<UIPress> {
    var rest = Set<UIPress>()
    for press in presses {
      if heldListPresses.removeValue(forKey: press) == nil { rest.insert(press) }
    }
    return rest
  }

  /// Whether a press of `key` a list took is down now.
  private func isHeld(_ key: SuggestionKeys.Key) -> Bool {
    heldListPresses.contains { $0.value == key && $0.key.phase != .ended && $0.key.phase != .cancelled }
  }

  /// The list key a hardware key is when it is taken from its press. The
  /// arrows are left to their key commands, which take them.
  private static func pressKey(_ key: UIKey) -> SuggestionKeys.Key? {
    switch key.keyCode {
    case .keyboardReturnOrEnter, .keyboardReturn, .keypadEnter: return .enter
    case .keyboardTab: return .tab
    case .keyboardEscape: return .escape
    default: return nil
    }
  }

  /// The list key a hardware key is, the arrows included.
  private static func listKey(_ key: UIKey) -> SuggestionKeys.Key? {
    if let key = pressKey(key) { return key }
    switch key.keyCode {
    case .keyboardUpArrow: return .up
    case .keyboardDownArrow: return .down
    default: return nil
    }
  }

  // MARK: Typing probe

  /// A list key in the typing probe: how it came in (c, a key command; p,
  /// its press; i, insertText), which, and what came of it.
  private func noteListKey(_ route: String, _ name: String, _ result: String) {
    guard TypingProbe.isOn, let id = accessibilityIdentifier else { return }
    TypingProbe.listKey(id, route: route, key: name, result: result)
  }

  private static func probeName(_ key: SuggestionKeys.Key) -> String {
    switch key {
    case .up: return "up"
    case .down: return "down"
    case .enter: return "ret"
    case .tab: return "tab"
    case .escape: return "esc"
    }
  }

  /// What a list key came to: the action, "field" with whether a list was
  /// up, or "composing" with the length of the marked text.
  private func probeResult(_ action: SuggestionKeys.Action, _ lists: SuggestionKeys.Lists) -> String {
    if let marked = markedTextRange { return "composing\(offset(from: marked.start, to: marked.end))" }
    switch action {
    case .field: return lists.takesEscape ? "field-listup" : "field-nolist"
    case .markMention(let row): return "markMention\(row)"
    case .pickMention(let row): return "pickMention\(row)"
    case .markSlash(let row): return "markSlash\(row)"
    case .pickSlash(let row): return "pickSlash\(row)"
    case .close(let mention, let slash): return "close\(mention ? "M" : "")\(slash ? "S" : "")"
    }
  }

  /// An arrow's press, which always goes on: "after-command" when its key
  /// command took it first.
  private func noteArrow(_ key: UIKey, _ press: UIPress) {
    guard let arrow = Self.listKey(key), arrow == .up || arrow == .down else { return }
    let after = commandTook.map { $0.key == arrow && $0.at >= press.timestamp } ?? false
    noteListKey("p", Self.probeName(arrow), after ? "after-command" : "passed")
  }

  /// The end of a press of Return, Tab or Escape: "held" when its list took
  /// it, "passed" when not, after `prefix` ("cancel-" for a cancelled one).
  private func noteEnded(_ presses: Set<UIPress>, _ prefix: String) {
    for press in presses {
      guard let uiKey = press.key, let key = Self.pressKey(uiKey) else { continue }
      noteListKey("u", Self.probeName(key), prefix + (heldListPresses[press] != nil ? "held" : "passed"))
    }
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
  /// The "@" and "/" lists' keys, handed to the text view as its paste and
  /// send handlers are.
  var suggestionKeys: SuggestionKeyHandler?

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
    view.suggestionKeys = suggestionKeys
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
      if TypingProbe.isOn, text == "\n" || text == "\t" {
        // A new line or tab that reaches the delegate without coming through
        // ComposerTextView.insertText never met the lists.
        let through = (textView as? ComposerTextView)?.insertingThrough ?? false
        TypingProbe.listKey(
          parent.identifier, route: "d", key: text == "\n" ? "ret" : "tab", result: through ? "via-insert" : "bypassed")
      }
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
