// Ports src/posting/library/libraryUi.js
//
// The library's browsing decisions, outside the views: what a shelf says
// when it's empty, which row the arrow keys land on, whether what was typed
// in the search box is a link to read, the template context a dialog's
// `context` stands for, the shelf it opens on, and the sections a shelf's
// list is grouped into.

import Foundation
import VirgaCore
import VirgaNetwork

public enum LibraryUI {
  /// What each shelf says when it has nothing, and what to do about it.
  public static let shelfEmpty: [String: String] = [
    "suggested": "Nothing here matches the post you’re replying to. Look through the other shelves.",
    "templates": "No templates yet. Make one on the Templates page, then use it here.",
    "posts": "No posts of yours yet. Once you’ve posted, they’re here to quote.",
    "replies": "No replies of yours yet.",
    "saved": "Nothing saved. Posts you save on Bluesky are here to quote.",
    "links": "No links in your recent posts. Paste a link in the search box to attach one.",
    "feeds": "No feeds of your own or saved. Paste a feed’s link in the search box to attach it.",
    "lists": "No lists of your own. Paste a list’s link in the search box to attach it.",
    "search": "Type at least two letters to search Bluesky.",
  ]

  /// What each shelf is, one line.
  public static let shelfHint: [String: String] = [
    "suggested": "Picked for the post you’re replying to.",
    "templates": "Posts and replies to start from.",
    "posts": "Your own posts, to quote.",
    "replies": "Your replies, to quote.",
    "saved": "Posts you saved on Bluesky.",
    "links": "Links from your recent posts, as cards.",
    "feeds": "Feeds you made or saved.",
    "lists": "Lists you made.",
    "search": "Posts from all of Bluesky.",
  ]

  // /^at:\/\/did:[a-z]+:[^/]+\/[a-z0-9.]+\/[^/]+$/i
  static let atRecord = JSRegex(#"^[aA][tT]://[dD][iI][dD]:[a-zA-Z]+:[^/]+/[a-zA-Z0-9.]+/[^/]+\z"#)

  /// Whether `text` is a link worth reading as an item (a web address or an
  /// at:// URI), rather than words to search for.
  public static func looksLikeLink(_ text: String?) -> Bool {
    let t = (text ?? "").jsTrimmed()
    if t.isEmpty || PostingJS.hasSpace(t) { return false }
    if atRecord.test(t) { return true }
    guard let url = WHATWGURL.parse(t) else { return false }
    return (url.protocolString == "https:" || url.protocolString == "http:") && url.hostname.jsIndexOf(".") >= 0
  }

  /// Where the arrow keys go: a step (1 or -1, wrapping), or Home and End.
  public enum Move: Hashable, Sendable {
    case by(Double)
    case first
    case last
  }

  /// The id the arrow keys move to from `activeId` among `ids`. With
  /// nothing active, a step down lands on the first and a step up on the
  /// last. Nil when there is nowhere to go.
  public static func moveActive(_ ids: [String?]?, _ activeId: String?, _ delta: Move) -> String? {
    let list = (ids ?? []).compactMap { $0 }.filter { !$0.isEmpty }
    if list.isEmpty { return nil }
    let step: Double
    switch delta {
    case .first: return list[0]
    case .last: return list[list.count - 1]
    case .by(let d): step = d
    }
    guard let at = activeId.flatMap({ id in list.firstIndex { $0.jsEquals(id) } }) else {
      return step < 0 ? list[list.count - 1] : list[0]
    }
    // `list[(at + delta + list.length) % list.length]`, undefined off the list.
    let index = (Double(at) + step + Double(list.count)).truncatingRemainder(dividingBy: Double(list.count))
    guard index >= 0, index.rounded() == index, index < Double(list.count) else { return nil }
    return list[Int(index)]
  }

  /// The template context (who is replied to, the handle, today) for what a
  /// dialog or page was handed: a template context passes through; a
  /// LibraryDialog `context` (`{ state, reply? }`) is made into one.
  public static func templateContextFrom(
    _ context: LibraryContextInput?, selfHandle: String? = nil, clock: LibraryClock = LibraryClock()
  ) -> TemplateContext {
    if case .template(let ctx)? = context { return ctx }
    var state: JSONValue?
    var reply: JSONValue?
    if case .dialog(let s, let r, _)? = context {
      state = s
      reply = r
    }
    return Library.libraryContext(
      state: state, reply: reply.nonNull ?? state?["reply"], selfHandle: selfHandle, now: clock.now,
      locale: clock.locale, timeZone: clock.timeZone)
  }

  /// The shelf a library opens on: the one asked for (`context.shelf`),
  /// else the default.
  public static func initialShelf(_ asked: String?, replying: Bool) -> String {
    if let asked, !asked.isEmpty {
      if asked == "suggested" && !replying { return Library.openingShelf(replying: replying) }
      return asked
    }
    return Library.openingShelf(replying: replying)
  }

  /// Library items grouped for a list with headings: feeds as yours and
  /// saved, the rest as given. `templateSections` (the store's
  /// templateShelf) takes the template shelf's own grouping.
  public static func sectionsFor(
    _ shelfId: String, _ items: [LibraryItem], templateSections: [LibrarySection]? = nil
  ) -> [LibrarySection] {
    if shelfId == "templates", let templateSections { return templateSections }
    if shelfId == "feeds" {
      func isSaved(_ i: LibraryItem) -> Bool {
        Library.isString(i.source?["group"], "saved") || i.group == "saved"
      }
      let yours = items.filter { !isSaved($0) }
      let saved = items.filter(isSaved)
      var out: [LibrarySection] = []
      if !yours.isEmpty {
        out.append(LibrarySection(id: "yours", heading: saved.isEmpty ? nil : "Yours", muted: false, items: yours))
      }
      if !saved.isEmpty { out.append(LibrarySection(id: "saved", heading: "Saved", muted: false, items: saved)) }
      return out
    }
    return items.isEmpty ? [] : [LibrarySection(id: shelfId, heading: nil, muted: false, items: items)]
  }
}
