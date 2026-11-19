// JSDate, JSURI, Number() and Math.round against Node
// (ios/parity/cases/core.jsdate.js and core.jsuri.js).

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

/// A number as a fixture holds it: NaN and ±∞ are null (JSON.stringify), -0 is 0.
func fixtureNumber(_ value: Double) -> JSONValue {
  value.isFinite ? .number(value + 0) : .null
}

func zone(_ c: ParityCase) -> TimeZone {
  TimeZone(identifier: c["zone"].stringValue ?? "UTC")!
}

@Suite struct JSDateParity {
  @Test func parse() throws {
    var failures: [String] = []
    for c in try Parity.cases("core.jsdate", fn: "parse") {
      let actual = JSDate.parse(c["text"].stringValue ?? "", timeZone: zone(c))
      if let d = Parity.diff(fixtureNumber(actual), c.output) {
        failures.append("\(c["zone"].stringValue ?? "") \(c["text"]): \(d)")
      }
    }
    #expect(failures.isEmpty, "\(failures.count) cases:\n\(failures.prefix(40).joined(separator: "\n"))")
  }

  @Test func local() throws {
    for c in try Parity.cases("core.jsdate", fn: "local") {
      let p = (c["parts"].arrayValue ?? []).map { $0.doubleValue ?? 0 }
      func at(_ i: Int, _ fallback: Double) -> Double { i < p.count ? p[i] : fallback }
      let actual = JSDate.local(
        at(0, 0), at(1, 0), at(2, 1), at(3, 0), at(4, 0), at(5, 0), at(6, 0), timeZone: zone(c))
      let d = Parity.diff(fixtureNumber(actual), c.output)
      #expect(d == nil, "\(c) \(c["zone"]) \(c["parts"]): \(d ?? "")")
    }
  }

  @Test func utc() throws {
    for c in try Parity.cases("core.jsdate", fn: "utc") {
      let p = (c["parts"].arrayValue ?? []).map { $0.doubleValue ?? 0 }
      func at(_ i: Int, _ fallback: Double) -> Double { i < p.count ? p[i] : fallback }
      let actual = JSDate.utc(at(0, 0), at(1, 0), at(2, 1), at(3, 0), at(4, 0), at(5, 0), at(6, 0))
      let d = Parity.diff(fixtureNumber(actual), c.output)
      #expect(d == nil, "\(c) \(c["parts"]): \(d ?? "")")
    }
  }

  @Test func fields() throws {
    for c in try Parity.cases("core.jsdate", fn: "fields") {
      let time = c["time"].doubleValue ?? .nan
      let actual: JSONValue
      if let f = JSDate.fields(time, timeZone: zone(c)) {
        actual = [
          "year": .number(Double(f.year)), "month": .number(Double(f.month)), "date": .number(Double(f.date)),
          "day": .number(Double(f.day)), "hours": .number(Double(f.hours)), "minutes": .number(Double(f.minutes)),
          "seconds": .number(Double(f.seconds)), "milliseconds": .number(Double(f.milliseconds)),
          "timezoneOffset": fixtureNumber(JSDate.timezoneOffset(time, timeZone: zone(c))),
        ]
      } else {
        actual = .null
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["zone"]) \(c["time"]): \(d ?? "")")
    }
  }

  @Test func toISOString() throws {
    for c in try Parity.cases("core.jsdate", fn: "toISOString") {
      let iso = JSDate.toISOString(c["time"].doubleValue ?? .nan)
      // JavaScript throws a RangeError for an invalid date.
      let actual: JSONValue = iso.map(JSONValue.string) ?? ["$throws": "Invalid time value"]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["time"]): \(d ?? "")")
    }
  }
}

@Suite struct JSURIParity {
  private func check(_ fn: String, _ body: (String) throws -> String) throws {
    for c in try Parity.cases("core.jsuri", fn: fn) {
      let actual: JSONValue
      do {
        actual = .string(try body(c["s"].stringValue ?? ""))
      } catch {
        actual = ["$throws": .string("\(error)")]
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["s"]): \(d ?? "")")
    }
  }

  @Test func encodeURIComponent() throws { try check("encodeURIComponent", JSURI.encodeURIComponent) }
  @Test func encodeURI() throws { try check("encodeURI", JSURI.encodeURI) }
  @Test func decodeURIComponent() throws { try check("decodeURIComponent", JSURI.decodeURIComponent) }
  @Test func decodeURI() throws { try check("decodeURI", JSURI.decodeURI) }
}

/// A number as the coercion cases write it: 'NaN', 'Infinity', '-0' or the value.
func signedNumber(_ n: Double) -> JSONValue {
  if n.isNaN { return "NaN" }
  if n.isInfinite { return n > 0 ? "Infinity" : "-Infinity" }
  if n == 0 && n.sign == .minus { return "-0" }
  return .number(n)
}

@Suite struct JSCoercionParity {
  @Test func number() throws {
    for c in try Parity.cases("core.jsuri", fn: "Number") {
      let d = Parity.diff(signedNumber(c.input["value"].jsNumber), c.output)
      #expect(d == nil, "\(c) \(c["value"]): \(d ?? "")")
    }
  }

  @Test func round() throws {
    for c in try Parity.cases("core.jsuri", fn: "round") {
      let d = Parity.diff(signedNumber((c["n"].doubleValue ?? 0).jsRounded), c.output)
      #expect(d == nil, "\(c) \(c["n"]): \(d ?? "")")
    }
  }
}
