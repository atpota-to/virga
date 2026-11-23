// src/defense/command.js and dmMessage.js against the web code
// (ios/parity/cases/defense-early.command.js and defense-early.dmMessage.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense-early.command"

/// A parsed command as the web writes it, or null.
func json(_ cmd: ParsedCommand?) throws -> JSONValue {
  try cmd.map { try JSONValue(encoding: $0) } ?? .null
}

/// What a case records: the value, or `{ $throws: message }` when it threw.
func outcome(_ body: () throws -> JSONValue) -> JSONValue {
  do {
    return try body()
  } catch {
    return ["$throws": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")]
  }
}

@Suite struct CommandParity {
  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    var kinds: [String: JSONValue] = [:]
    for name in Command.kindNames {
      kinds[name] = Command.kinds[name]!.map { .array($0.map(JSONValue.string)) } ?? .null
    }
    let actual: JSONValue = ["KINDS": .object(kinds), "HELP": .string(Command.help)]
    let d = Parity.diff(actual, c.output, strictNulls: true)
    #expect(d == nil, "\(c): \(d ?? "")")
    #expect(Command.kinds.count == Command.kindNames.count)
  }

  @Test func parseActor() throws {
    for c in try Parity.cases(fixture, fn: "parseActor") {
      let actual: JSONValue = Command.parseActor(c.input["token"]?.stringValue).map(JSONValue.string) ?? .null
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func parseCommand() throws {
    for c in try Parity.cases(fixture, fn: "parseCommand") {
      let cmd = Command.parseCommand(
        c.input["text"]?.stringValue,
        embedUri: c.input["embedUri"]?.stringValue,
        links: c["links"].strings,
        mentions: c["mentions"].strings)
      let d = Parity.diff(try json(cmd), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func parsePostScan() throws {
    for c in try Parity.cases(fixture, fn: "parsePostScan") {
      let target = Command.parsePostScan(
        c.input["text"]?.stringValue, embedUri: c.input["embedUri"]?.stringValue, links: c["links"].strings)
      let d = Parity.diff(target.map(JSONValue.string) ?? .null, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func extractTargets() throws {
    for c in try Parity.cases(fixture, fn: "extractTargets") {
      let actual = JSONValue.array(Command.extractTargets(c.input["text"]?.stringValue).map(JSONValue.string))
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func looksLikeTarget() throws {
    for c in try Parity.cases(fixture, fn: "looksLikeTarget") {
      let d = Parity.diff(.bool(Command.looksLikeTarget(c.input["input"]?.stringValue)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func authorOf() throws {
    for c in try Parity.cases(fixture, fn: "authorOf") {
      let actual: JSONValue = Command.authorOf(c.input["uri"]?.stringValue).map(JSONValue.string) ?? .null
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func shortCode() throws {
    for c in try Parity.cases(fixture, fn: "shortCode") {
      let d = Parity.diff(.string(Command.shortCode(c.input["uuid"]?.stringValue)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func facetLinksAndMentions() throws {
    for c in try Parity.cases(fixture, fn: "facetLinks") {
      let actual = outcome { .array(try Command.facetLinks(c.input["message"]).map(JSONValue.string)) }
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
    for c in try Parity.cases(fixture, fn: "facetMentions") {
      let actual = outcome { .array(try Command.facetMentions(c.input["message"]).map(JSONValue.string)) }
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func isWrite() throws {
    for c in try Parity.cases(fixture, fn: "isWrite") {
      let cmd = Command.parseCommand(c.input["text"]?.stringValue)
      let d = Parity.diff(.bool(Command.isWrite(cmd)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
    #expect(!Command.isWrite(nil))
  }
}

@Suite struct DmMessageParity {
  private let fixture = "defense-early.dmMessage"

  @Test func sharedUri() throws {
    for c in try Parity.cases(fixture, fn: "sharedUri") {
      let actual: JSONValue = DmMessage.sharedUri(c.input["message"]).map(JSONValue.string) ?? .null
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func composeMessage() throws {
    for c in try Parity.cases(fixture, fn: "composeMessage") {
      let actual = outcome { .string(try DmMessage.composeMessage(c.input["message"])) }
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func isDirect() throws {
    for c in try Parity.cases(fixture, fn: "isDirect") {
      let d = Parity.diff(.bool(DmMessage.isDirect(c.input["convo"])), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func answerTo() throws {
    for c in try Parity.cases(fixture, fn: "answerTo") {
      // `String(text || '')`.
      let text = c.input["text"].map { $0.isTruthy ? $0.jsString : "" }
      let actual: JSONValue = DmMessage.answerTo(text).map { .string($0.rawValue) } ?? .null
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }
}
