// Helpers shared by the VirgaRepo tests.

import Foundation
import VirgaCore
import VirgaTestSupport
@testable import VirgaRepo

enum Hex {
  static func decode(_ hex: String) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      out.append(UInt8(hex[index..<next], radix: 16)!)
      index = next
    }
    return out
  }

  static func encode(_ bytes: some Sequence<UInt8>) -> String {
    SHA256.hex(bytes)
  }
}

extension ParityCase {
  /// A hex-encoded input as bytes.
  func bytes(_ key: String) -> [UInt8] {
    Hex.decode(self[key].stringValue ?? "")
  }

  /// A base64-encoded input as bytes.
  func base64(_ key: String) -> [UInt8] {
    [UInt8](Data(base64Encoded: self[key].stringValue ?? "") ?? Data())
  }

  /// The message a case expects the call to throw, if it expects one.
  var expectedThrow: String? {
    output["$throws"]?.stringValue
  }
}

/// Runs `body` and turns what it returned or threw into the fixture's
/// shape: the value, or `{ "$throws": message }`.
func outcome(_ body: () throws -> JSONValue) -> JSONValue {
  do {
    return try body()
  } catch let error as RepoError {
    return ["$throws": .string(error.message)]
  } catch {
    return ["$throws": .string("\(error)")]
  }
}

func outcome(_ body: () async throws -> JSONValue) async -> JSONValue {
  do {
    return try await body()
  } catch let error as RepoError {
    return ["$throws": .string(error.message)]
  } catch {
    return ["$throws": .string("\(error)")]
  }
}

/// A Codable value as JSON.
func json<T: Encodable>(_ value: T) -> JSONValue {
  (try? JSONValue(encoding: value)) ?? .null
}
