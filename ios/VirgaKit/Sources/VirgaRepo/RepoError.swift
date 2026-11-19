// The errors VirgaRepo throws, carrying the messages the web code throws for
// the same input. The web's CAR, CBOR and CID code (@atcute) throws plain
// JavaScript errors whose `message` the dashboard shows when a sync fails
// ("HTTP 400 from getRepo", "CAR root block missing", "unexpected end of
// input"), so the Swift port keeps the words and the JavaScript class.

import Foundation

public struct RepoError: Error, LocalizedError, Hashable, Sendable, CustomStringConvertible {
  /// The JavaScript error class the web throws.
  public enum Kind: String, Hashable, Sendable {
    case error = "Error"
    case rangeError = "RangeError"
    case typeError = "TypeError"
    case syntaxError = "SyntaxError"
  }

  public var kind: Kind
  /// The web's `error.message`, word for word.
  public var message: String
  /// The HTTP status, for a failed download (the web's `err.status`).
  public var status: Int?

  public init(_ kind: Kind, _ message: String, status: Int? = nil) {
    self.kind = kind
    self.message = message
    self.status = status
  }

  public var errorDescription: String? { message }
  public var description: String { "\(kind.rawValue): \(message)" }

  static func range(_ message: String) -> RepoError { RepoError(.rangeError, message) }
  static func type(_ message: String) -> RepoError { RepoError(.typeError, message) }
  static func syntax(_ message: String) -> RepoError { RepoError(.syntaxError, message) }
  static func plain(_ message: String) -> RepoError { RepoError(.error, message) }
}
