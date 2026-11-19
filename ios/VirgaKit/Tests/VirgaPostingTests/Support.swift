// Helpers for the posting parity tests.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// Any Encodable as the JSON the fixtures hold.
func json<T: Encodable>(_ value: T) -> JSONValue {
  (try? JSONValue(encoding: value)) ?? ["$encodeFailed": .string("\(value)")]
}

/// An optional Encodable, nil as null.
func json<T: Encodable>(_ value: T?) -> JSONValue {
  value.map { json($0) } ?? .null
}

/// The value `body` returns, or `{ $throws: message }` for what it throws, as
/// the case generators record a throw.
func outcome(_ body: () throws -> JSONValue) -> JSONValue {
  do { return try body() } catch { return ["$throws": .string(message(of: error))] }
}

func outcome(_ body: () async throws -> JSONValue) async -> JSONValue {
  do { return try await body() } catch { return ["$throws": .string(message(of: error))] }
}

func message(of error: Error) -> String {
  (error as? LocalizedError)?.errorDescription ?? "\(error)"
}

/// Fails the test, showing the case and where `actual` differs.
func check(_ actual: JSONValue, _ c: ParityCase, strictNulls: Bool = false, sourceLocation: SourceLocation = #_sourceLocation) {
  let d = Parity.diff(actual, c.output, strictNulls: strictNulls)
  #expect(d == nil, "\(c) input \(short(c.input)): \(d ?? "")", sourceLocation: sourceLocation)
}

func short(_ value: JSONValue) -> String {
  let text = value.jsonString()
  return text.count > 300 ? String(text.prefix(300)) + "…" : text
}

extension ParityCase {
  /// A string argument, or nil when the fixture holds another type (the
  /// Swift ports take nil where the web refuses non-strings).
  func string(_ key: String) -> String? { self[key].stringValue }

  func int(_ key: String) -> Int { self[key].intValue ?? 0 }

  func strings(_ key: String) -> [String] { self[key].arrayValue?.compactMap(\.stringValue) ?? [] }
}

/// Cases of `fn`, failing the test (rather than passing over nothing) when
/// there are none.
func cases(_ fixture: String, _ fn: String) throws -> [ParityCase] {
  try Parity.cases(fixture, fn: fn)
}
