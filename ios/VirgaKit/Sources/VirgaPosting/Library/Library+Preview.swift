// Ports src/posting/library/model.js
//
// What using an item does: the use button's verb and the one-line effect,
// the template context from the composer, what a post already carries, the
// preview, the plan, caret-aware insertion and "/shortcut" detection.
//
// The composer's state is taken as the web's ComposerState object
// (JSONValue): the composer is another chain's port, and the merge can add
// an overload over its Swift type.

import Foundation
import VirgaCore
import VirgaNetwork

extension Library {
  // MARK: - Verbs and effects

  /// The use button's label.
  public static func verbFor(_ item: LibraryItem?, replying: Bool = false) -> String? {
    switch item?.kind {
    case "template": return replying ? "Put in reply" : "Put in post"
    case "post": return "Quote"
    case "link": return "Attach link"
    case "feed": return "Attach feed"
    case "list": return "Attach list"
    default: return nil
    }
  }

  // What a template's embed would attach, as a lower-case phrase; '' when it
  // attaches nothing (gone, or a kind the composer can't attach).
  static func templateAttachPhrase(_ item: LibraryItem, _ context: TemplateContext?) -> String {
    if isString(item.embedView, missing) { return "" }
    let view = viewOf(item.embedView)
    switch EditorDrafts.templateEmbedKind(item.source?["embed"]) {
    case "post": return isOwnHandle(view?["author"]?["handle"], context) ? "quotes your post" : "quotes a post"
    case "feed": return "attaches a feed"
    case "list": return "attaches a list"
    case "link": return "attaches a link card"
    default: return ""
    }
  }

  /// One plain line saying what using the item does.
  public static func effectFor(_ item: LibraryItem?, _ context: TemplateContext? = nil) -> String {
    guard let item else { return "" }
    switch item.kind {
    case "template":
      let template = item.source?.truthy ?? .object([:])
      let questions = PostTemplates.describeTemplate(template, context).questions
      let hasText = !str(template["text"]).jsTrimmed().isEmpty
      let attach = templateAttachPhrase(item, context)
      if questions > 0 {
        let asks = questions == 1 ? "one question" : "\(questions) questions"
        return "Asks \(asks), then adds text\(attach.isEmpty ? "" : " and \(attach)")"
      }
      if hasText && !attach.isEmpty { return "Adds text and \(attach)" }
      if hasText { return context?.their != nil ? "Adds text to your reply" : "Adds text to your post" }
      if !attach.isEmpty { return capitalise(attach) }
      return "Has nothing to add here"
    case "post": return "Attaches this post as a quote"
    case "link": return "Attaches a link card"
    case "feed": return "Attaches the feed as a card people can open"
    case "list": return "Attaches the list as a card"
    default: return ""
    }
  }

  // MARK: - Context and attachments from the composer

  /// The template context for a library opened from the composer: the post
  /// being replied to (ComposerState.reply carries its `author` and `text`)
  /// and the handle the post goes out as. `reply` nil means the state's;
  /// pass `.null` for none. `now` and `locale` are buildTemplateContext's.
  public static func libraryContext(
    state: JSONValue? = nil, reply: JSONValue? = nil, selfHandle: String? = nil, now: Date = Date(),
    locale: String? = nil, timeZone: TimeZone? = nil
  ) -> TemplateContext {
    let reply = reply ?? state?["reply"]
    var replyTo: JSONValue?
    if let author = reply?["author"], author.isTruthy {
      replyTo = ["author": author, "record": ["text": .string(str(reply?["text"]))]]
    }
    let handle: JSONValue = selfHandle.map { $0.isEmpty ? .null : .string($0) } ?? .null
    return PostTemplates.buildTemplateContext(
      replyTo: replyTo, self: ["handle": handle], now: now, locale: locale, timeZone: timeZone)
  }

  // A template context passes through; the dialog's `{ state, reply }` is
  // made into one, so callers can hand the dialog's context straight on.
  static func asTemplateContext(_ context: LibraryContextInput?, _ state: JSONValue?, _ clock: LibraryClock) -> TemplateContext {
    if case .template(let ctx)? = context { return ctx }
    var ownState: JSONValue?
    var reply: JSONValue?
    var selfHandle: String?
    if case .dialog(let s, let r, let h)? = context {
      ownState = s
      reply = r
      selfHandle = h
    }
    return libraryContext(
      state: ownState?.truthy ?? state, reply: reply, selfHandle: selfHandle, now: clock.now, locale: clock.locale,
      timeZone: clock.timeZone)
  }

  /// A JSON value's `length` (an array's or a string's), as `x?.length` reads it.
  static func jsLength(_ value: JSONValue?) -> Int {
    switch value {
    case .array(let items)?: return items.count
    case .string(let s)?: return s.utf16.count
    default: return 0
    }
  }

  /// What a post in the composer already carries, as previewFor wants it.
  public static func attachmentsFromState(_ state: JSONValue?, _ postIndex: Int = 0) -> LibraryCarried {
    guard let post = state?["posts"]?[postIndex], post.isTruthy else { return LibraryCarried() }
    var record: LibraryCard?
    if post["record"]?["uri"]?.isTruthy == true {
      let view = post["record"]?["view"]
      let kind = text(post["record"]?["kind"]) ?? "post"
      let handle = text(view?["author"]?["handle"]) ?? text(view?["creator"]?["handle"])
      let nouns = ["post": "Post", "feed": "Feed", "list": "List", "starterpack": "Starter pack"]
      let noun = nouns.jsValue(kind) ?? "Post"
      let title: String
      if kind == "post" {
        title = postTitle(view?.truthy ?? .object([:]))
      } else {
        title = oneLine(view?["displayName"]?.truthy ?? view?["name"]?.truthy ?? view?["record"]?["name"])
      }
      record = LibraryCard(by: handle.map { "\(noun) by @\($0)" } ?? noun, title: title)
    }
    var link: LibraryLinkSummary?
    if let url = text(post["card"]?["url"]) {
      let title = str(post["card"]?["title"])
      link = LibraryLinkSummary(url: url, title: title.isEmpty ? url : title)
    }
    let media: String? = post["video"]?.isTruthy == true ? "video" : jsLength(post["images"]) > 0 ? "images" : nil
    return LibraryCarried(record: record, link: link, media: media)
  }

  // MARK: - Inserting text

  /// `Number.isFinite(value) ? clamp(trunc(value)) : fallback`.
  static func clampIndex(_ value: Double?, _ max: Int, _ fallback: Int) -> Int {
    guard let value, value.isFinite else { return fallback }
    return Swift.max(0, Swift.min(Int(clamping: Int64(value.rounded(.towardZero).clamped(-9e15, 9e15))), max))
  }

  // A range holding just a "/shortcut", as detectSlashCommand reports one:
  // /^\/[A-Za-z0-9-]{0,32}$/.
  static func isSlashRange(_ units: ArraySlice<UInt16>) -> Bool {
    guard units.first == 0x2F, units.count <= 33 else { return false }
    return units.dropFirst().allSatisfy(isShortcutUnit)
  }

  static func isShortcutUnit(_ unit: UInt16) -> Bool {
    (0x30...0x39).contains(unit) || (0x41...0x5A).contains(unit) || (0x61...0x7A).contains(unit) || unit == 0x2D
  }

  struct Pieces {
    var before: [UInt16]
    var lead: String
    var addition: String
    var trail: String
    var after: [UInt16]
  }

  // The pieces insertText joins, so the preview can tell existing text from added.
  static func insertPieces(_ text: String?, _ addition: String?, start rawStart: Double?, end rawEnd: Double?) -> Pieces {
    let source = Array((text ?? "").utf16)
    let add = addition ?? ""
    var start = clampIndex(rawStart, source.count, source.count)
    var end = clampIndex(rawEnd, source.count, start)
    if end < start { swap(&start, &end) }
    // With nothing to put in its place (a quote or a card alone), a
    // selection of the writer's own words stays; only a "/shortcut" is taken out.
    if add.isEmpty && end > start && !isSlashRange(source[start..<end]) { start = end }
    let before = Array(source[..<start])
    var after = Array(source[end...])
    if add.isEmpty {
      // Taking "/word" out of "a /word b" would otherwise leave two spaces.
      let tab: Set<UInt16> = [0x20, 0x09]
      if end > start, let last = before.last, tab.contains(last), let first = after.first, tab.contains(first) {
        after.removeFirst()
      }
      return Pieces(before: before, lead: "", addition: "", trail: "", after: after)
    }
    let addUnits = Array(add.utf16)
    let lead = !before.isEmpty && !PostingJS.isSpace(before.last!) && !PostingJS.isSpace(addUnits[0]) ? " " : ""
    let trail = !after.isEmpty && !PostingJS.isSpace(after[0]) && !PostingJS.isSpace(addUnits.last!) ? " " : ""
    return Pieces(before: before, lead: lead, addition: add, trail: trail, after: after)
  }

  /// `insertion` put over `[start, end)` of `text`. One space joins it to
  /// the text on either side, except at the edges of the text or next to
  /// whitespace already there. A missing range means the end of the text. A
  /// nil insertion takes a "/shortcut" range out and leaves any other
  /// range's text as it is, with the caret at its end. The caret sits after
  /// the addition. Offsets are UTF-16 code units.
  public static func insertText(_ text: String?, _ insertion: String?, _ range: TextSelection? = nil) -> TextInsertion {
    insertText(text, insertion, start: range.map { Double($0.start) }, end: range.map { Double($0.end) })
  }

  /// insertText with the range's ends as the web may get them (fractional,
  /// out of range, or not numbers: nil).
  public static func insertText(_ text: String?, _ insertion: String?, start: Double?, end: Double?) -> TextInsertion {
    let p = insertPieces(text, insertion, start: start, end: end)
    // Joined as code units: a range can fall inside a surrogate pair, and
    // the halves meet again as they do in JavaScript.
    let joined = p.before + Array(p.lead.utf16) + Array(p.addition.utf16) + Array(p.trail.utf16) + p.after
    return TextInsertion(text: String(jsUnits: joined), caret: p.before.count + p.lead.utf16.count + p.addition.utf16.count)
  }

  /// The reply's text without the "/shortcut" that opened the library, for
  /// "Save this reply as a template"; anything else in the range is kept.
  public static func replyTextWithoutSlash(_ text: String?, _ insertion: TextSelection?) -> String {
    replyTextWithoutSlash(text, start: insertion.map { Double($0.start) }, end: insertion.map { Double($0.end) })
  }

  public static func replyTextWithoutSlash(_ text: String?, start: Double?, end: Double?) -> String {
    let source = text ?? ""
    guard let start, let end, end > start else { return source }
    let units = Array(source.utf16)
    // `source.slice(start, end)`.
    func relative(_ n: Double) -> Int {
      let i = n.rounded(.towardZero)
      if i < 0 { return Swift.max(0, units.count + Int(Swift.max(i, -9e15))) }
      return Swift.min(units.count, Int(Swift.min(i, 9e15)))
    }
    let from = relative(start)
    let to = relative(end)
    guard from < to, units[from] == 0x2F else { return source }
    return insertText(source, nil, start: start, end: end).text
  }

  // MARK: - Preview

  /// Preview parts as code units, so halves of a pair split by a range
  /// join again when their parts merge.
  struct UnitPart {
    var units: [UInt16]
    var kind: String
  }

  static func pushPart(_ parts: inout [UnitPart], _ units: [UInt16], _ kind: String) {
    if units.isEmpty { return }
    if let last = parts.last, last.kind == kind {
      parts[parts.count - 1].units += units
    } else {
      parts.append(UnitPart(units: units, kind: kind))
    }
  }

  static func pushPart(_ parts: inout [UnitPart], _ text: String, _ kind: String) {
    pushPart(&parts, Array(text.utf16), kind)
  }

  // A template's addition as kinded parts. templatePreviewParts closes the
  // gaps of empty blanks as fillTemplate does, so a filled addition joins
  // to its text.
  static func templateAdditionParts(
    _ template: JSONValue, _ answers: JSONValue, _ context: TemplateContext?
  ) -> [UnitPart] {
    var parts: [UnitPart] = []
    for part in PostTemplates.templatePreviewParts(template, answers, context) {
      pushPart(&parts, part.text, part.kind == "text" ? "added" : part.kind)
    }
    return parts
  }

  /// What the item attaches, for the preview's mini card, or nil.
  static func attachmentFor(_ item: LibraryItem, _ context: TemplateContext?) -> LibraryCard? {
    let source = item.source
    switch item.kind {
    case "post":
      let handle = text(source?["author"]?["handle"])
      let by = isOwnHandle(source?["author"]?["handle"], context) ? "Your post" : handle.map { "Post by @\($0)" } ?? "Post"
      return LibraryCard(by: by, title: postTitle(source))
    case "feed":
      return LibraryCard(by: text(source?["creator"]?["handle"]).map { "Feed by @\($0)" } ?? "Feed", title: item.title)
    case "list":
      return LibraryCard(by: text(source?["creator"]?["handle"]).map { "List by @\($0)" } ?? "List", title: item.title)
    case "link":
      let host = hostOf(source?["url"])
      return LibraryCard(by: host.isEmpty ? "Link" : host, title: item.title)
    case "template":
      if isString(item.embedView, missing) { return nil }
      let embed = source?["embed"]
      let view = viewOf(item.embedView)
      switch EditorDrafts.templateEmbedKind(embed) {
      case "post":
        guard let view else { return LibraryCard(by: "Quoted post", title: "") }
        return attachmentFor(LibraryItem(kind: "post", source: view), context)
      case "feed":
        guard let view else { return LibraryCard(by: "Feed", title: "") }
        return attachmentFor(LibraryItem(kind: "feed", title: oneLine(view["displayName"]), source: view), context)
      case "list":
        guard let view else { return LibraryCard(by: "List", title: "") }
        return attachmentFor(LibraryItem(kind: "list", title: oneLine(view["name"]), source: view), context)
      case "link":
        let external = embed?["external"]
        let host = hostOf(external?["uri"])
        let title = oneLine(external?["title"])
        return LibraryCard(by: host.isEmpty ? "Link" : host, title: title.isEmpty ? str(external?["uri"]) : title)
      default:
        return nil
      }
    default:
      return nil
    }
  }

  // 'record' | 'link' | nil: which attachment slot the item would fill.
  static func slotFor(_ item: LibraryItem) -> String? {
    if isRecordKind(item.kind) { return "record" }
    if item.kind == "link" { return "link" }
    if item.kind == "template" && !isString(item.embedView, missing) {
      let kind = EditorDrafts.templateEmbedKind(item.source?["embed"])
      if isRecordKind(kind) { return "record" }
      if kind == "link" { return "link" }
    }
    return nil
  }

  static let noteReplaces = "A post holds one attachment, so this replaces the one already there."
  static let noteImages = "Your images take the attachment space, so a link card won't show."
  static let noteVideo = "Your video takes the attachment space, so a link card won't show."
  static let noteGone = [
    "post": "The post this template quotes is gone, so only its text will be added.",
    "feed": "The feed this template attaches is gone, so only its text will be added.",
    "list": "The list this template attaches is gone, so only its text will be added.",
  ]
  static let noteUnsupported = "What this template attaches can't be added here, so only its text will be added."
  static let blockedLocked = "This post already quotes something, so only the text can be added."
  public static let blockedQuotesOff = "Its author doesn't allow quotes, so it can't be attached."
  static let blockedLockedEmpty = "This post already quotes something, so this can't be added."
  static let blockedGoneEmpty = [
    "post": "The post this template quotes is gone, so there's nothing to add.",
    "feed": "The feed this template attaches is gone, so there's nothing to add.",
    "list": "The list this template attaches is gone, so there's nothing to add.",
  ]
  static let blockedUnsupportedEmpty = "What this template attaches can't be added here, and it has no text."

  /// What the post would look like with the item used.
  ///
  /// `parts` are the existing text before the insertion, the addition, and
  /// the existing text after it, joined as insertText joins them, so for a
  /// filled addition the parts' text is `insertText(currentText, added,
  /// insertion).text`. A blank still to be answered shows as a 'blank' part
  /// holding its label.
  ///
  /// With `state` (and `postIndex`), the post's text and what it already
  /// carries come from the composer, unless `currentText` or `attachments`
  /// are given too; with `state` and no `context`, the context is made from
  /// it on `clock`.
  public static func previewFor(
    _ item: LibraryItem?, state: JSONValue? = nil, postIndex: Int = 0, currentText: String? = nil,
    insertion: TextSelection? = nil, answers: JSONValue = .object([:]), context: TemplateContext? = nil,
    attachments: LibraryCarried? = nil, quoteSlotLocked: Bool = false, maxLength: Int = 300,
    clock: LibraryClock = LibraryClock()
  ) -> LibraryPreview {
    previewFor(
      item, state: state, postIndex: postIndex, currentText: currentText,
      start: insertion.map { Double($0.start) }, end: insertion.map { Double($0.end) }, answers: answers,
      context: context, attachments: attachments, quoteSlotLocked: quoteSlotLocked, maxLength: Double(maxLength),
      clock: clock)
  }

  /// previewFor with the insertion's ends as the web may get them.
  public static func previewFor(
    _ item: LibraryItem?, state: JSONValue? = nil, postIndex: Int = 0, currentText: String? = nil,
    start: Double?, end: Double?, answers: JSONValue = .object([:]), context: TemplateContext? = nil,
    attachments: LibraryCarried? = nil, quoteSlotLocked: Bool = false, maxLength: Double = 300,
    clock: LibraryClock = LibraryClock()
  ) -> LibraryPreview {
    let text = currentText ?? str(state?["posts"]?[postIndex]?["text"])
    let carried = attachments ?? (state?.isTruthy == true ? attachmentsFromState(state, postIndex) : nil)
    let ctx = context == nil && state?.isTruthy == true ? asTemplateContext(nil, state, clock) : context
    let isTemplate = item?.kind == "template"
    let template: JSONValue = isTemplate ? (item?.source?.truthy ?? .object([:])) : .null
    let addedParts = isTemplate ? templateAdditionParts(template, answers, ctx) : []
    let filled = isTemplate ? PostTemplates.fillTemplate(template, answers, ctx) : ""
    let hasText = isTemplate && !str(template["text"]).jsTrimmed().isEmpty

    // The tidied addition never starts or ends with whitespace, so any one
    // character stands in for it when choosing the joining spaces.
    let pieces = insertPieces(text, addedParts.isEmpty ? "" : "x", start: start, end: end)
    var unitParts: [UnitPart] = []
    pushPart(&unitParts, pieces.before, "existing")
    if !addedParts.isEmpty {
      pushPart(&unitParts, pieces.lead, "added")
      for p in addedParts { pushPart(&unitParts, p.units, p.kind) }
      pushPart(&unitParts, pieces.trail, "added")
    }
    pushPart(&unitParts, pieces.after, "existing")
    let parts = unitParts.map { LibraryPreviewPart(text: String(jsUnits: $0.units), kind: $0.kind) }

    let full = insertText(text, filled, start: start, end: end).text
    let count = InlineLinks.countComposerGraphemes(full)

    guard let item else {
      return LibraryPreview(
        parts: parts, count: count, overLimit: Double(count) > maxLength, attachment: nil,
        replacesAttachment: false, notes: [], blocked: nil, usable: false)
    }
    let slot = slotFor(item)
    let embedKind = isTemplate ? EditorDrafts.templateEmbedKind(template["embed"]) : nil
    var notes: [String] = []
    var blocked: String?
    var attachment = attachmentFor(item, ctx)
    var replacesAttachment = false

    let quotesOff = item.kind == "post" && item.quotesOff == true
    if quotesOff {
      blocked = blockedQuotesOff
      attachment = nil
    } else if slot == "record" && quoteSlotLocked {
      blocked = isTemplate && hasText ? blockedLocked : blockedLockedEmpty
      attachment = nil
    } else if slot == "record" && carried?.record != nil {
      replacesAttachment = true
    } else if slot == "link" && carried?.link != nil {
      replacesAttachment = true
    }
    if replacesAttachment { notes.append(noteReplaces) }
    if slot == "link", let media = carried?.media { notes.append(media == "video" ? noteVideo : noteImages) }

    if isTemplate, isRecordKind(embedKind), let embedKind, isString(item.embedView, missing) {
      if hasText { notes.append(noteGone[embedKind]!) } else { blocked = blocked ?? blockedGoneEmpty[embedKind] }
    } else if isTemplate && embedKind == "unsupported" {
      if hasText { notes.append(noteUnsupported) } else { blocked = blocked ?? blockedUnsupportedEmpty }
    }

    let attaches = slot != nil && !quotesOff && !(slot == "record" && quoteSlotLocked)
    let usable = !item.kind.isEmpty && (hasText || attaches)

    return LibraryPreview(
      parts: parts, count: count, overLimit: Double(count) > maxLength, attachment: attachment,
      replacesAttachment: replacesAttachment, notes: notes, blocked: blocked, usable: usable)
  }

  // MARK: - Plans

  // A template's stored embed as an attachment, with the hydrated view when
  // there is one (its cid is the post as it now is).
  static func templateAttachment(_ embed: JSONValue?, _ embedView: JSONValue?) -> LibraryAttachment? {
    let view = viewOf(embedView)
    let kind = EditorDrafts.templateEmbedKind(embed)
    if kind == "link" {
      let external = embed?["external"]?.truthy ?? .object([:])
      return LibraryAttachment(
        kind: "link", url: text(external["uri"]), title: str(external["title"]),
        description: str(external["description"]))
    }
    guard let kind, isRecordKind(kind) else { return nil }
    return LibraryAttachment(
      kind: kind, uri: text(embed?["record"]?["uri"]),
      cid: text(view?["cid"]) ?? text(embed?["record"]?["cid"]), view: view)
  }

  /// What the composer should do when the item is used: a LibraryPlan.
  ///
  /// `insertText` is the filled template text, nil when there is none (pass
  /// `plan.insertText` to insertText, which still takes a "/shortcut"
  /// insertion range out and leaves a selection be). `attach` is a record
  /// or a link; a post from the archive has no cid until
  /// LibrarySources.hydratePick has read it. A record is dropped while the
  /// quote slot is locked, and a template's embed when what it quotes is
  /// gone or can't be attached.
  ///
  /// `context` is a template context (libraryContext), or the dialog's
  /// `{ state, reply }` to make one from (on `clock`).
  public static func applyPlanFor(
    _ item: LibraryItem?, state: JSONValue? = nil, context: LibraryContextInput? = nil,
    answers: JSONValue = .object([:]), quoteSlotLocked: Bool = false, clock: LibraryClock = LibraryClock()
  ) -> LibraryPlan {
    let ctx = asTemplateContext(context, state, clock)
    var plan = LibraryPlan(title: item?.title ?? "", templateRkey: nil)
    guard let item else { return plan }
    let source = item.source
    switch item.kind {
    case "template":
      let filled = PostTemplates.fillTemplate(source ?? .null, answers, ctx)
      if !filled.isEmpty { plan.insertText = filled }
      plan.template = source?.truthy ?? .null
      plan.answers = .object(TemplateJS.spread(answers))
      plan.templateRkey = text(source?["rkey"])
      let kind = EditorDrafts.templateEmbedKind(source?["embed"])
      let attachable = kind == "link" || (isRecordKind(kind) && !quoteSlotLocked)
      if attachable && !isString(item.embedView, missing), let attach = templateAttachment(source?["embed"], item.embedView) {
        plan.attach = attach
      }
    case "post", "feed", "list":
      if !quoteSlotLocked, let uri = item.uri, !uri.isEmpty {
        let view = item.view?.truthy
        plan.attach = LibraryAttachment(kind: item.kind, uri: uri, cid: item.cid?.isEmpty == false ? item.cid : nil, view: view)
      }
    case "link":
      if let url = item.url, !url.isEmpty { plan.attach = LibraryAttachment(kind: "link", url: url) }
    default:
      break
    }
    return plan
  }

  /// applyPlanFor with a template context.
  public static func applyPlanFor(
    _ item: LibraryItem?, context: TemplateContext, answers: [String: String] = [:], quoteSlotLocked: Bool = false
  ) -> LibraryPlan {
    applyPlanFor(
      item, context: .template(context), answers: .object(answers.mapValues(JSONValue.string)),
      quoteSlotLocked: quoteSlotLocked)
  }

  // MARK: - Slash shortcuts

  /// The "/shortcut" being typed at the caret: a slash at the start of the
  /// text or after whitespace, then up to 32 letters, digits or dashes
  /// running to the caret, or nil. "a/b", URLs and "w/" are not shortcuts,
  /// and neither is a caret inside a word ("/sta|mina"). A nil caret is the
  /// end of the text.
  public static func detectSlashCommand(_ text: String?, _ caret: Int?) -> SlashCommand? {
    detectSlashCommand(text, caret: caret.map(Double.init))
  }

  public static func detectSlashCommand(_ text: String?, caret: Double?) -> SlashCommand? {
    let source = Array((text ?? "").utf16)
    let at = clampIndex(caret, source.count, source.count)
    // /(?:^|\s)\/([A-Za-z0-9-]{0,32})$/ on the text before the caret.
    var run = 0
    while run < at, isShortcutUnit(source[at - 1 - run]) { run += 1 }
    let slash = at - run - 1
    guard run <= 32, slash >= 0, source[slash] == 0x2F, slash == 0 || PostingJS.isSpace(source[slash - 1]) else {
      return nil
    }
    if at < source.count, isShortcutUnit(source[at]) { return nil }
    let query = String(jsUnits: source[(slash + 1)..<at]).jsLowercased()
    return SlashCommand(start: slash, end: at, query: query)
  }
}

extension Double {
  func clamped(_ low: Double, _ high: Double) -> Double { Swift.min(Swift.max(self, low), high) }
}
