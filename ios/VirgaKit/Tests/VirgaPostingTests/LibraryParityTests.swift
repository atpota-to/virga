// Parity for src/posting/library/model.js (fixture library.model): every
// case of every function, items named in an input (`{ $item: name }`)
// read from the fixture's ITEMS case.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// The library generators' clock: model.test.js's NOW.
let libraryNow = "2026-10-14T12:00:00.000Z"

/// The clock a case runs on: its `now`, `locale` and `zone`, or the
/// generator's defaults (NOW, en-US, UTC).
func libraryClock(_ c: ParityCase) -> LibraryClock {
  LibraryClock(
    now: fixtureDate(c.input["now"] ?? .string(libraryNow)), locale: c.string("locale") ?? "en-US",
    timeZone: TimeZone(identifier: c.string("zone") ?? "UTC")!)
}

/// A fixture's item table, and its inputs with `{ $item: name }` put back.
struct LibraryItems {
  let table: [String: JSONValue]

  init(_ fixture: String) throws {
    table = try cases(fixture, "ITEMS")[0].output.objectValue ?? [:]
  }

  func resolve(_ value: JSONValue?) -> JSONValue? {
    guard let value else { return nil }
    switch value {
    case .object(let members):
      if members.count == 1, let name = members["$item"]?.stringValue { return table[name] ?? .null }
      return .object(members.mapValues { resolve($0) ?? .null })
    case .array(let items):
      return .array(items.map { resolve($0) ?? .null })
    default:
      return value
    }
  }

  func item(_ value: JSONValue?) -> LibraryItem? {
    guard let value = resolve(value), !value.isNull else { return nil }
    return LibraryItem(json: value)
  }

  func items(_ value: JSONValue?) -> [LibraryItem]? {
    resolve(value)?.arrayValue.map { $0.map { LibraryItem(json: $0) } }
  }
}

/// `String(v)` as insertText reads its text: null and undefined are ''.
func jsText(_ value: JSONValue?) -> String? {
  guard let value, !value.isNull else { return nil }
  return value.stringValue ?? value.jsString
}

/// A range's ends as numbers (anything else is not a finite number).
func rangeEnds(_ range: JSONValue?) -> (Double?, Double?) {
  (range?["start"]?.doubleValue, range?["end"]?.doubleValue)
}

/// The generator's `marked`: members that are the input itself as `marker`.
func marked(_ made: JSONValue, _ input: JSONValue?, _ marker: String) -> JSONValue {
  guard let input, case .object(var members) = made else { return made }
  for key in ["source", "template", "view"] {
    if let value = members[key], Parity.diff(value, input, strictNulls: true) == nil { members[key] = .string(marker) }
  }
  return .object(members)
}

@Suite struct LibraryModelParity {
  static let f = "library.model"
  let items: LibraryItems

  init() throws {
    items = try LibraryItems(Self.f)
  }

  @Test func constants() throws {
    check(.string(Library.libraryName), try cases(Self.f, "LIBRARY_NAME")[0])
    check(json(Library.libraryShelves), try cases(Self.f, "LIBRARY_SHELVES")[0])
    check(.string(Library.blockedQuotesOff), try cases(Self.f, "BLOCKED_QUOTES_OFF")[0])
    for c in try cases(Self.f, "shelvesFor") {
      check(json(Library.shelvesFor(replying: c.input["replying"]?.isTruthy == true)), c)
    }
    for c in try cases(Self.f, "openingShelf") {
      check(.string(Library.openingShelf(replying: c.input["replying"]?.isTruthy == true)), c)
    }
  }

  @Test func posts() throws {
    for c in try cases(Self.f, "postMedia") { check(json(Library.postMedia(c.input["post"])), c) }
    for c in try cases(Self.f, "engagementScore") { check(.number(Library.engagementScore(c.input["post"])), c) }
    for c in try cases(Self.f, "isOwnThreadPost") { check(.bool(Library.isOwnThreadPost(c.input["post"])), c) }
    for c in try cases(Self.f, "isOwnThreadRow") {
      check(.bool(Library.isOwnThreadRow(c.input["row"], c.string("selfDid"))), c)
    }
  }

  @Test func itemFromTemplate() throws {
    for c in try cases(Self.f, "itemFromTemplate") {
      let made = Library.itemFromTemplate(
        c.input["template"], TemplateContext(json: c.input["context"]), embedView: c.input["embedView"])
      check(marked(made.json, c.input["template"], "$template"), c, strictNulls: true)
    }
  }

  @Test func itemFromPost() throws {
    for c in try cases(Self.f, "itemFromPost") {
      let made = Library.itemFromPost(
        c.input["view"], shelf: c.string("shelf") ?? "posts", selfDid: c.string("selfDid"),
        parentView: c.input["parentView"], clock: libraryClock(c))
      check(marked(made.json, c.input["view"], "$view"), c, strictNulls: true)
    }
  }

  @Test func otherItems() throws {
    for c in try cases(Self.f, "markQuotesOff") {
      check(Library.markQuotesOff(items.item(c.input["item"])!).json, c, strictNulls: true)
    }
    for c in try cases(Self.f, "itemFromArchiveRow") {
      let made = Library.itemFromArchiveRow(
        c.input["row"], shelf: c.string("shelf"), selfDid: c.string("selfDid"), clock: libraryClock(c))
      check(made.json, c, strictNulls: true)
    }
    for c in try cases(Self.f, "itemFromLink") { check(Library.itemFromLink(c.input["link"]).json, c, strictNulls: true) }
    for c in try cases(Self.f, "itemFromFeed") {
      check(Library.itemFromFeed(c.input["view"], group: c.string("group") ?? "yours").json, c, strictNulls: true)
    }
    for c in try cases(Self.f, "itemFromList") { check(Library.itemFromList(c.input["view"]).json, c, strictNulls: true) }
  }

  @Test func sortItems() throws {
    for c in try cases(Self.f, "sortItems") {
      let sorted = Library.sortItems(
        items.items(c.input["items"]), by: c.string("by") ?? "date", timeZone: TimeZone(identifier: c.string("zone") ?? "UTC"))
      check(json(sorted.map(\.id)), c)
    }
  }

  @Test func suggestItems() throws {
    for c in try cases(Self.f, "suggestItems") {
      func list(_ name: String) -> [JSONValue] { items.resolve(c.input[name])?.arrayValue ?? [] }
      let out = Library.suggestItems(
        templates: list("templates"), posts: list("posts"), feeds: list("feeds"), lists: list("lists"),
        parentText: c.string("parentText"), parentUri: c.string("parentUri"), limit: c.input["limit"]?.intValue ?? 5,
        context: TemplateContext(json: c.input["context"]), selfDid: c.string("selfDid"), clock: libraryClock(c))
      check(.array(out.map { ["id": .string($0.id), "shelf": .string($0.shelf), "reason": .string($0.reason)] }), c)
    }
  }

  @Test func searchAndDedupe() throws {
    for c in try cases(Self.f, "searchItems") {
      let found = Library.searchItems(
        items.items(c.input["items"]), c.string("query"), replying: c.input["replying"]?.isTruthy == true)
      check(json(found.map(\.id)), c)
    }
    for c in try cases(Self.f, "dedupeById") {
      check(json(Library.dedupeById(items.items(c.input["items"]), c.strings("seenIds")).map(\.id)), c)
    }
  }

  @Test func verbsAndEffects() throws {
    for c in try cases(Self.f, "verbFor") {
      check(json(Library.verbFor(items.item(c.input["item"]), replying: c.input["replying"]?.isTruthy == true)), c)
    }
    for c in try cases(Self.f, "effectFor") {
      check(.string(Library.effectFor(items.item(c.input["item"]), TemplateContext(json: c.input["context"]))), c)
    }
  }

  @Test func composerSide() throws {
    for c in try cases(Self.f, "libraryContext") {
      let context = Library.libraryContext(
        state: c.input["state"], reply: c.input["reply"], selfHandle: c.string("selfHandle"),
        now: fixtureDate(c.input["now"]), locale: c.string("locale"), timeZone: TimeZone(identifier: "UTC"))
      check(json(context), c)
    }
    for c in try cases(Self.f, "attachmentsFromState") {
      check(json(Library.attachmentsFromState(c.input["state"], c.input["postIndex"]?.intValue ?? 0)), c)
    }
  }

  @Test func insertText() throws {
    for c in try cases(Self.f, "insertText") {
      let (start, end) = rangeEnds(c.input["range"])
      let out = (c.input["insertions"]?.arrayValue ?? []).map { insertion in
        json(Library.insertText(jsText(c.input["text"]), jsText(insertion), start: start, end: end))
      }
      check(.array(out), c)
    }
    for c in try cases(Self.f, "replyTextWithoutSlash") {
      let (start, end) = rangeEnds(c.input["insertion"])
      check(.string(Library.replyTextWithoutSlash(c.string("text"), start: start, end: end)), c)
    }
  }

  @Test func previewFor() throws {
    for c in try cases(Self.f, "previewFor") {
      let opts = items.resolve(c.input["opts"])
      let (start, end) = rangeEnds(opts?["insertion"])
      let attachments = opts?["attachments"].flatMap { $0.isNull ? nil : LibraryCarried(json: $0) }
      let preview = Library.previewFor(
        items.item(c.input["item"]), state: opts?["state"], postIndex: opts?["postIndex"]?.intValue ?? 0,
        currentText: opts?["currentText"]?.stringValue, start: start, end: end,
        answers: opts?["answers"] ?? .object([:]), context: TemplateContext(json: opts?["context"]),
        attachments: attachments, quoteSlotLocked: opts?["quoteSlotLocked"]?.isTruthy == true,
        maxLength: opts?["maxLength"]?.doubleValue ?? 300, clock: libraryClock(c))
      check(json(preview), c, strictNulls: true)
    }
  }

  @Test func applyPlanFor() throws {
    for c in try cases(Self.f, "applyPlanFor") {
      let opts = items.resolve(c.input["opts"])
      let context = opts?["context"].map { LibraryContextInput(json: $0) }
      let plan = Library.applyPlanFor(
        items.item(c.input["item"]), state: opts?["state"], context: context,
        answers: opts?["answers"] ?? .object([:]), quoteSlotLocked: opts?["quoteSlotLocked"]?.isTruthy == true,
        clock: libraryClock(c))
      check(plan.json, c, strictNulls: true)
    }
  }

  @Test func slash() throws {
    for c in try cases(Self.f, "detectSlashCommand") {
      check(json(Library.detectSlashCommand(c.string("text"), caret: c.input["caret"]?.doubleValue)), c)
    }
    for c in try cases(Self.f, "rankTemplatesForSlash") {
      let ranked = Library.rankTemplatesForSlash(
        c.input["templates"]?.arrayValue, parentText: c.string("parentText") ?? "", usage: c.input["usage"],
        replying: c.input["replying"]?.isTruthy == true)
      check(.array(ranked.map { $0["rkey"] ?? .null }), c)
    }
  }
}
