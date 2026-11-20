// An XRPC call's query parameters, and the path they make, as @atproto/xrpc
// (constructMethodCallUrl, encodeQueryParam) writes them for the web's
// Agent. The lexicon tells the SDK each parameter's type; here the value's
// case says it:
//
//   .string     String(value)
//   .integer    String(Number(value) | 0), a 32-bit integer
//   .float      String(Number(value))
//   .boolean    'true' / 'false'
//   .datetime   the string as given
//   .array      repeated keys, `uris=a&uris=b`, in order
//
// A nil value is left out, as the SDK leaves out `undefined`. The order is
// the order given (a Swift dictionary literal keeps it), as the web's
// object literals keep theirs.

import Foundation
import VirgaCore

public indirect enum XRPCParamValue: Sendable, Hashable, ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
  ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral, ExpressibleByFloatLiteral
{
  case string(String)
  case integer(Int)
  case float(Double)
  case boolean(Bool)
  case datetime(String)
  case array([XRPCParamValue])

  public init(stringLiteral value: String) { self = .string(value) }
  public init(integerLiteral value: Int) { self = .integer(value) }
  public init(booleanLiteral value: Bool) { self = .boolean(value) }
  public init(floatLiteral value: Double) { self = .float(value) }
  public init(arrayLiteral elements: XRPCParamValue...) { self = .array(elements) }

  /// An array of strings (`uris`, `actors`).
  public static func strings(_ values: [String]) -> XRPCParamValue { .array(values.map(XRPCParamValue.string)) }

  /// `encodeQueryParam(type, value)` for one value.
  public var encoded: String {
    switch self {
    case .string(let text), .datetime(let text): return text
    case .integer(let number): return String(Int32(truncatingIfNeeded: number))
    case .float(let number): return JSNumber.format(number)
    case .boolean(let flag): return flag ? "true" : "false"
    case .array(let items): return items.map(\.encoded).joined(separator: ",")
    }
  }
}

public struct XRPCParams: Sendable, Hashable, ExpressibleByDictionaryLiteral {
  public struct Item: Sendable, Hashable {
    public var name: String
    public var value: XRPCParamValue?
  }

  public var items: [Item]

  public init(_ items: [(String, XRPCParamValue?)] = []) {
    self.items = items.map { Item(name: $0.0, value: $0.1) }
  }

  public init(dictionaryLiteral elements: (String, XRPCParamValue?)...) {
    self.init(elements)
  }

  /// Sets `name` (replacing it where it is, appending it where it isn't).
  public subscript(name: String) -> XRPCParamValue? {
    get { items.first { $0.name.jsEquals(name) }?.value }
    set {
      if let index = items.firstIndex(where: { $0.name.jsEquals(name) }) {
        items[index].value = newValue
      } else {
        items.append(Item(name: name, value: newValue))
      }
    }
  }

  /// The name-value pairs of the query, arrays expanded, nils left out.
  public var pairs: [(String, String)] {
    var out: [(String, String)] = []
    for item in items {
      guard let value = item.value else { continue }
      if case .array(let values) = value {
        for element in values { out.append((item.name, element.encoded)) }
      } else {
        out.append((item.name, value.encoded))
      }
    }
    return out
  }

  /// `new URLSearchParams(pairs).toString()`.
  public var queryString: String { JSURI.searchParams(pairs) }

  public static func == (lhs: XRPCParams, rhs: XRPCParams) -> Bool { lhs.items == rhs.items }
}

public enum XRPCPath {
  /// `constructMethodCallUrl(nsid, schema, params)`: `/xrpc/<nsid>` and,
  /// when there are any, `?` and the parameters.
  public static func methodCallURL(_ nsid: String, _ params: XRPCParams?) -> String {
    let path = "/xrpc/\(JSURI.encodeURIComponent(nsid))"
    guard let params else { return path }
    let pairs = params.pairs
    return pairs.isEmpty ? path : "\(path)?\(JSURI.searchParams(pairs))"
  }
}
