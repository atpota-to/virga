// What the demo-network tests share: the Swift side of
// ios/parity/cases/_demoNetwork.js (an answer as a fixture keeps it, a
// thrown error as one records it, the repeatable randomness the fake
// server's tokens come from), and the worlds the generators run on.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDemo

enum DemoNetwork {
  /// The `now` the generators build at (_demoWorld.js's NOW).
  static let now: Double = DemoFixtures.now

  /// `shrink(value)`: whole when its canonical text is short; else its
  /// digest, each list member as a part, each other member whole (or by
  /// its digest when long too).
  static func shrink(_ value: JSONValue) -> JSONValue {
    let limit = CanonicalJSON.wholeLimit
    func short(_ v: JSONValue) -> Bool { CanonicalJSON.text(v).utf16.count <= limit }
    if short(value) { return value }
    switch value {
    case .array(let items): return ["$part": CanonicalJSON.part(items)]
    case .object(let members):
      var out: [String: JSONValue] = ["$sha256": .string(CanonicalJSON.sha256(value))]
      for (key, member) in members {
        if case .array(let items) = member {
          out[key] = ["$part": CanonicalJSON.part(items)]
        } else {
          out[key] = short(member) ? member : ["$sha256": .string(CanonicalJSON.sha256(member))]
        }
      }
      return .object(out)
    default:
      return ["$sha256": .string(CanonicalJSON.sha256(value))]
    }
  }

  /// `thrown(error)`: the message, and the name, status and error when it
  /// has them.
  static func thrown(_ error: any Error) -> JSONValue {
    var out: [String: JSONValue] = ["$throws": .string(jsMessage(error))]
    switch error {
    case let e as HarnessRepo.XrpcError:
      out["name"] = .string(e.name)
      out["status"] = .number(Double(e.status))
      out["error"] = .string(e.error)
    case let e as HarnessJSError:
      out["name"] = .string(e.name)
    case is JSURIError:
      out["name"] = "URIError"
    case is WebURLError:
      out["name"] = "TypeError"
    default:
      out["name"] = "Error"
    }
    return .object(out)
  }

  /// `outcome(fn, look)`.
  static func outcome(_ look: (JSONValue) -> JSONValue = { $0 }, _ body: () async throws -> JSONValue) async -> JSONValue {
    do {
      return ["result": shrink(look(try await body()))]
    } catch {
      return thrown(error)
    }
  }

  /// `answerOf(res)`: the status, the content type, and the body (JSON
  /// shrunk, bytes by length and digest); null for no answer.
  static func answerOf(_ res: HTTPResponse?) -> JSONValue {
    guard let res else { return .null }
    let type = res.headers.get("content-type")
    var out: [String: JSONValue] = ["status": .number(Double(res.status)), "type": type.map(JSONValue.string) ?? .null]
    if res.status == 204 { return .object(out) }
    if let type, type.contains("json") {
      out["json"] = shrink((try? JSONValue.parse(res.body)) ?? .null)
    } else {
      out["bytes"] = ["length": .number(Double(res.body.count)), "sha256": .string(CanonicalJSON.sha256(bytes: [UInt8](res.body)))]
    }
    if let length = res.headers.get("content-length") { out["length"] = .string(length) }
    return .object(out)
  }

  /// A fixture's request: `{ url, method?, headers?, body? }` (a body as bytes).
  static func request(_ step: JSONValue, url: String? = nil) -> HTTPRequest {
    var headers = HTTPHeaders()
    for (name, value) in (step["headers"]?.objectValue ?? [:]).sorted(by: { $0.key < $1.key }) {
      headers.append(name, value.stringValue ?? value.jsString)
    }
    var body: Data?
    if let bytes = step["body"]?.arrayValue { body = Data(bytes.map { UInt8($0.doubleValue ?? 0) }) }
    if let text = step["text"]?.stringValue { body = Data(text.utf8) }
    return HTTPRequest(
      method: step["method"]?.stringValue ?? "GET", url: url ?? step["url"]?.stringValue ?? "", headers: headers, body: body)
  }

  /// An agent's answer as JSON: `{ success, headers, data }`.
  static func json(_ answer: FakeXrpc.Answer) -> JSONValue {
    ["success": .bool(answer.success), "headers": .object(answer.headers.mapValues(JSONValue.string)), "data": answer.data]
  }

  /// The worlds `worldsFor(search, now)` builds, as a DemoWorld.
  static func world(_ search: String = "", now: Double = DemoNetwork.now) -> DemoWorld {
    let flags = Harness.readFlags(search)
    return DemoWorld(now: now, accounts: flags.accounts, scope: flags.scope)
  }
}

/// `repeatableRandom()`: the n-th byte asked for is `(n * 37 + 11) & 255`.
final class RepeatableBytes: Sendable {
  private let n = Locked(0)

  func next(_ count: Int) -> [UInt8] {
    n.withLock { n in
      (0..<count).map { _ in
        defer { n += 1 }
        return UInt8((n * 37 + 11) & 255)
      }
    }
  }

  var generator: @Sendable (Int) -> [UInt8] { { count in self.next(count) } }
}
