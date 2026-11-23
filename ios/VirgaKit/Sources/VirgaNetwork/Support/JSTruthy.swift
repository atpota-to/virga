// `value || fallback` for JSONValue.
//
// JSONValue is ExpressibleByNilLiteral, so a closure such as
// `{ $0.isTruthy ? $0 : nil }` can read its `nil` as JSONValue.null, a value,
// rather than as "nothing": a falsy value then comes back as `.null` and the
// fallback after `??` is never used. These say what they mean.

import Foundation
import VirgaCore

extension JSONValue {
  /// The value when JavaScript reads it as truthy, else nil:
  /// `value.truthy ?? fallback` is `value || fallback`.
  public var truthy: JSONValue? {
    isTruthy ? self : Optional<JSONValue>.none
  }
}

extension Optional where Wrapped == JSONValue {
  /// A present value JavaScript reads as truthy, else nil.
  public var truthy: JSONValue? {
    switch self {
    case .some(let value) where value.isTruthy: return value
    default: return Optional<JSONValue>.none
    }
  }

  /// A present value that isn't null, else nil: `value ?? fallback` is
  /// `value.nonNull ?? fallback`.
  public var nonNull: JSONValue? {
    switch self {
    case .some(let value) where !value.isNull: return value
    default: return Optional<JSONValue>.none
    }
  }

  /// Whether a value is present at all (not `undefined`), however falsy.
  public var isPresent: Bool {
    switch self {
    case .some: return true
    case .none: return false
    }
  }
}
