// JSON.parse and the case mappings against Node's own
// (ios/parity/cases/core.jsjson.js and core.jsstring.js).

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

/// A parsed value as the generator's toJSON writes it: non-finite numbers
/// are null and -0 is 0.
private func asWritten(_ value: JSONValue) -> JSONValue {
  switch value {
  case .number(let n): return n.isFinite ? .number(n == 0 ? 0 : n) : .null
  case .array(let items): return .array(items.map(asWritten))
  case .object(let members): return .object(members.mapValues(asWritten))
  default: return value
  }
}

@Suite struct JSONParseParity {
  @Test func parse() throws {
    for c in try Parity.cases("core.jsjson", fn: "parse") {
      let text = c["text"].stringValue ?? ""
      let webThrows = c.output["$throws"] != nil
      do {
        let value = try JSONValue.parse(text)
        var number: JSONValue = .null
        if case .number(let n) = value {
          if !n.isFinite {
            number = .string(n > 0 ? "Infinity" : "-Infinity")
          } else if n == 0 && n.sign == .minus {
            number = "-0"
          } else {
            number = .number(n)
          }
        }
        let actual: JSONValue = ["value": asWritten(value), "number": number]
        #expect(!webThrows, "\(c) \(text.debugDescription): JSON.parse refuses it, the port read \(value)")
        if !webThrows {
          let d = Parity.diff(actual, c.output)
          #expect(d == nil, "\(c) \(text.debugDescription): \(d ?? "")")
        }
      } catch {
        #expect(webThrows, "\(c) \(text.debugDescription): JSON.parse reads it, the port refused: \(error)")
      }
    }
  }
}

@Suite struct JSONParseBehaviour {
  @Test func deepNestingDoesNotOverflowTheStack() throws {
    let depth = 100_000
    let text = String(repeating: "[", count: depth) + String(repeating: "]", count: depth)
    var value = try JSONValue.parse(text)
    var seen = 1
    while case .array(let items) = value, let first = items.first {
      value = first
      seen += 1
    }
    #expect(seen == depth)
    #expect(throws: JSONParseError.self) { try JSONValue.parse(String(repeating: "[", count: depth)) }
  }

  @Test func aBodyIsReadAsResponseJsonReadsIt() throws {
    // response.json() drops a byte-order mark; JSON.parse on a string doesn't.
    let bom = Data([0xEF, 0xBB, 0xBF]) + Data(#"{"a":1}"#.utf8)
    #expect(try JSONValue.parse(bom) == ["a": 1])
    #expect(throws: JSONParseError.self) { try JSONValue.parse("\u{FEFF}{\"a\":1}") }
    // A malformed UTF-8 byte inside a string is U+FFFD, not a refusal.
    let bad = Data(#"{"a":""#.utf8) + Data([0xFF]) + Data(#""}"#.utf8)
    #expect(try JSONValue.parse(bad) == ["a": "\u{FFFD}"])
  }

  @Test func refusalsSayWhere() {
    #expect(throws: JSONParseError(message: "Expected property name or '}'", position: 7)) {
      try JSONValue.parse(#"{"a":1,}"#)
    }
    #expect(throws: JSONParseError(message: "Unexpected end of JSON input", position: 0)) { try JSONValue.parse("") }
  }

  @Test func aStoredValueReadsAsTheWebReadsIt() throws {
    let store = InMemoryKeyValueStore()
    try store.setItem("k", #"{"name":"jo","count":3,}"#)
    #expect(store.getJSON("k") == nil, "a trailing comma is not JSON to JSON.parse")
    #expect(store.getJSON("k", as: Thing.self) == nil)
    try store.setItem("k", #"{"name":"jo","count":3,"name":"al"}"#)
    #expect(store.getJSON("k", as: Thing.self) == Thing(name: "al", count: 3), "the last of two equal keys wins")
  }
}

@Suite struct CaseMappingParity {
  @Test func toLowerCase() throws {
    for c in try Parity.cases("core.jsstring", fn: "toLowerCase") {
      let text = c["text"].stringValue ?? ""
      let d = Parity.diff(.string(text.jsLowercased()), c.output)
      #expect(d == nil, "\(c) \(text.debugDescription): \(d ?? "")")
    }
  }

  @Test func toUpperCase() throws {
    for c in try Parity.cases("core.jsstring", fn: "toUpperCase") {
      let text = c["text"].stringValue ?? ""
      let d = Parity.diff(.string(text.jsUppercased()), c.output)
      #expect(d == nil, "\(c) \(text.debugDescription): \(d ?? "")")
    }
  }

  @Test func swiftsOwnLowercasingMissesTheFinalSigma() {
    #expect("ΟΔΟΣ".lowercased() == "οδοσ")
    #expect("ΟΔΟΣ".jsLowercased() == "οδος")
  }
}
