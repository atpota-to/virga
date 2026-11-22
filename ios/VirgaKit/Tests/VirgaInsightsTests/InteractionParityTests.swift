// The Interaction lookup (ios/parity/cases/insights.interaction.js): one
// account's history each way over the lookup's own tests' archives, the
// harness's account and hand-made edges; the index, the directory and its
// search, the filters, the words, the export and naming an account.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

/// An event as a fixture holds it.
func interactionEvent(_ e: JSONValue) -> InteractionEvent {
  InteractionEvent(
    key: e["key"]?.stringValue ?? "", dir: e["dir"]?.stringValue ?? "", kind: e["kind"]?.stringValue ?? "",
    at: e["at"]?.stringValue ?? "", atMs: e["atMs"]?.doubleValue ?? .nan, uri: e["uri"]?.stringValue ?? "",
    subject: e["subject"]?.stringValue, url: e["url"]?.stringValue, urlOwner: e["urlOwner"]?.stringValue,
    text: e["text"]?.stringValue ?? "")
}

/// A card as a fixture holds it.
func card(_ did: String, _ value: JSONValue?) -> ActorCard? {
  guard let value, !value.isNull else { return nil }
  return ActorCard(
    did: did, handle: value["handle"]?.stringValue, displayName: value["displayName"]?.stringValue,
    avatar: value["avatar"]?.stringValue)
}

@Suite struct InteractionParity {
  let fixture = "insights.interaction"

  @Test func interactionModel() throws {
    for c in try Parity.cases(fixture, fn: "interactionModel") {
      guard let archive = ReportFixtures.archive(c) else { continue }
      let m = InteractionModel.interactionModel(archive, c["who"].stringValue ?? "", formats: c.formats)
      expectReport(m.json, c)
    }
  }

  @Test func interactionIndex() throws {
    for c in try Parity.cases(fixture, fn: "interactionIndex") {
      guard let archive = ReportFixtures.archive(c) else { continue }
      expectReport(InteractionModel.interactionIndex(archive, formats: c.formats).json, c)
    }
  }

  @Test func keepsMentions() throws {
    for c in try Parity.cases(fixture, fn: "keepsMentions") {
      guard let archive = ReportFixtures.archive(c) else { continue }
      expectOutput(.bool(InteractionModel.keepsMentions(archive, formats: c.formats)), c)
    }
  }

  @Test func peopleDirectory() throws {
    for c in try Parity.cases(fixture, fn: "peopleDirectory") {
      guard let archive = ReportFixtures.archive(c) else { continue }
      var cards: [JSKey: JSONValue] = [:]
      for pair in c["cards"].arrayValue ?? [] {
        if let did = pair[0]?.stringValue { cards[JSKey(did)] = pair[1] }
      }
      let people = InteractionModel.peopleDirectory(archive, cardOf: { card($0, cards[JSKey($0)]) }, formats: c.formats)
      expectOutput(.array(people.map(\.json)), c)
    }
  }

  func directory() throws -> [DirectoryPerson] {
    let value = try Parity.cases(fixture, fn: "directory")[0].output
    return (value.arrayValue ?? []).map { p in
      DirectoryPerson(
        did: p["did"]?.stringValue ?? "", handle: p["handle"]?.stringValue ?? "",
        displayName: p["displayName"]?.stringValue ?? "", avatar: p["avatar"]?.stringValue ?? "",
        in: p["in"]?.intValue ?? 0, out: p["out"]?.intValue ?? 0, total: p["total"]?.intValue ?? 0,
        followsYou: p["followsYou"]?.boolValue ?? false, youFollow: p["youFollow"]?.boolValue ?? false)
    }
  }

  @Test func matchPeople() throws {
    let people = try directory()
    for c in try Parity.cases(fixture, fn: "matchPeople") {
      let hits = InteractionModel.matchPeople(people, c["query"].stringValue, limit: c["limit"].intValue ?? 8)
      expectOutput(.array(hits.map(\.json)), c)
    }
  }

  func events() throws -> [InteractionEvent] {
    (try Parity.cases(fixture, fn: "events")[0].output.arrayValue ?? []).map(interactionEvent)
  }

  @Test func filterEvents() throws {
    let all = try events()
    for c in try Parity.cases(fixture, fn: "filterEvents") {
      let kept = InteractionModel.filterEvents(
        all, direction: c["direction"].stringValue ?? "all", kind: c["kind"].stringValue ?? "all")
      expectOutput(.array(kept.map(\.json)), c)
    }
  }

  @Test func eventPhrase() throws {
    for c in try Parity.cases(fixture, fn: "eventPhrase") {
      let phrase = InteractionModel.eventPhrase(dir: c["dir"].stringValue, kind: c["kind"].stringValue)
      if c.output.isNull {
        // A kind Object.prototype carries ('toString'): the web's lookup finds
        // the function and gives it back (recorded as null); here, no phrase.
        #expect(phrase == "", "\(c)")
        #expect(c["kind"].stringValue == "toString", "\(c): only an inherited name gives the web a function")
        continue
      }
      expectOutput(.string(phrase), c)
    }
  }

  @Test func eventsCsvRows() throws {
    for c in try Parity.cases(fixture, fn: "eventsCsvRows") {
      let list = (c["events"].arrayValue ?? []).map(interactionEvent)
      let handle: String? = c.input["handle"] == nil ? "" : c["handle"].stringValue
      let rows = InteractionModel.eventsCsvRows(list, did: c["did"].stringValue, handle: handle)
      expectOutput(.array(rows.map { .array($0.map(JSONValue.string)) }), c)
    }
  }

  @Test func kindsLine() throws {
    for c in try Parity.cases(fixture, fn: "kindsLine") {
      let entries = c.input["entries"]?.arrayValue.map { pairs in
        pairs.map { (key: $0[0]?.stringValue ?? "", value: $0[1]?.doubleValue ?? .nan) }
      }
      let line = InteractionModel.kindsLine(
        entries: entries, byCount: c["byCount"].boolValue ?? false, locale: c["locale"].stringValue ?? "en-US")
      expectOutput(.string(line), c)
    }
  }

  @Test func parseActorInput() throws {
    for c in try Parity.cases(fixture, fn: "parseActorInput") {
      expectOutput(InteractionModel.parseActorInput(c["text"].stringValue)?.json ?? .null, c)
    }
  }

  @Test func isDid() throws {
    for c in try Parity.cases(fixture, fn: "isDid") {
      expectOutput(.bool(InteractionModel.isDid(c["text"].stringValue)), c)
    }
  }

  @Test func lookupHref() throws {
    for c in try Parity.cases(fixture, fn: "lookupHref") {
      expectOutput(.string(InteractionModel.lookupHref(c["who"].stringValue, c["search"].stringValue ?? "")), c)
    }
  }

  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let actual: JSONValue = [
      "LOOKUP_PATH": .string(InteractionModel.lookupPath),
      "LOOKUP_KINDS": .array(InteractionModel.lookupKinds.map(JSONValue.string)),
      "OUTBOUND_KINDS": .array(InteractionModel.outboundKinds.map(JSONValue.string)),
      "KIND_LABEL": .object(InteractionModel.kindLabel.mapValues(JSONValue.string)),
      "KIND_NOUN": .array(
        InteractionModel.lookupKinds.map { k in
          let noun = InteractionModel.kindNoun[k]!
          return [.string(k), [.string(noun.one), .string(noun.many)]]
        }),
      "DIRECTIONS": .array(InteractionModel.directions.map { ["key": .string($0.key), "label": .string($0.label)] }),
    ]
    expectOutput(actual, c, strictNulls: true)
  }
}
