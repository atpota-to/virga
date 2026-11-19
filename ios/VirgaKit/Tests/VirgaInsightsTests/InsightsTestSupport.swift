// Small helpers the insights parity tests share.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport

/// A value as JSON, through its Codable conformance.
func encoded<T: Encodable>(_ value: T) -> JSONValue {
  do {
    return try JSONValue(encoding: value)
  } catch {
    Issue.record("could not encode \(value): \(error)")
    return .null
  }
}

/// An optional value as JSON: null for nil.
func encoded<T: Encodable>(_ value: T?) -> JSONValue {
  value.map { encoded($0) } ?? .null
}

/// What a call gives, or `{ "$throws": message }` when it throws, as the
/// generators record a web function that throws.
func outcome(_ body: () throws -> JSONValue) -> JSONValue {
  do {
    return try body()
  } catch {
    return ["$throws": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")]
  }
}

/// The strings of a JSON array.
func strings(_ value: JSONValue) -> [String] {
  (value.arrayValue ?? []).compactMap(\.stringValue)
}

/// Decodes a fixture input, recording a failure (and returning nil) when it
/// doesn't decode.
func decoded<T: Decodable>(_ value: JSONValue, as type: T.Type, _ c: ParityCase) -> T? {
  do {
    return try value.decode(T.self)
  } catch {
    Issue.record("\(c): input doesn't decode as \(T.self): \(error)")
    return nil
  }
}

/// Expects `actual` to be the case's output.
func expectOutput(
  _ actual: JSONValue, _ c: ParityCase, strictNulls: Bool = false, sourceLocation: SourceLocation = #_sourceLocation
) {
  let d = Parity.diff(actual, c.output, strictNulls: strictNulls)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
}
