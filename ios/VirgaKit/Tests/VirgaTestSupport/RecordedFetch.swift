// Replaying a web function's network exchanges in a Swift test.
//
// A recorded case (ios/parity/cases/_fetch.js) holds every request the web
// code made, the answer it got, the waits it made and its result. The test
// builds `transport()`, a MockTransport that answers each recorded request
// with its recorded answer, runs the Swift port with it and a
// RecordingClock, and checks with `check(...)` that the port sent the same
// requests (in the same order, unless the code runs them side by side), waited
// the same waits, and reached the same result (or threw the same message).
//
// Requests are compared as the fixture records them: URL exactly (code unit
// for code unit), method, headers by lower-cased name, the body as JSON
// where it is JSON (JSONValue keeps an object's members unordered, so a JSON
// body is compared by value, not byte for byte), as text, or as bytes, and
// the deadline (`timeoutMs`, the AbortSignal.timeout the web attached, or
// null for none) where the fixture recorded one.

import Foundation
import VirgaCore
import VirgaNetwork

public struct RecordedFetch: Sendable {
  public struct Exchange: Sendable {
    public var request: JSONValue
    public var response: JSONValue
  }

  public var exchanges: [Exchange]
  public var waits: [Double]
  /// The result, or `{ "$throws": message }`.
  public var expected: JSONValue

  public init(_ output: JSONValue) {
    exchanges = (output["exchanges"]?.arrayValue ?? []).map {
      Exchange(request: $0["request"] ?? .null, response: $0["response"] ?? .null)
    }
    waits = (output["waits"]?.arrayValue ?? []).compactMap(\.doubleValue)
    if let message = output["$throws"] {
      expected = ["$throws": message]
    } else {
      expected = output["result"] ?? .null
    }
  }

  /// A transport answering each recorded request once, in any order; any
  /// other request fails loudly.
  public func transport() -> MockTransport {
    let transport = MockTransport()
    for (index, exchange) in exchanges.enumerated() {
      let recorded = exchange.request
      let response = exchange.response
      transport.on(.predicate("recorded request #\(index): \(recorded["url"]?.stringValue ?? "")", { request in
        RecordedFetch.difference(request, recorded) == nil
      }), times: 1) { _ in try RecordedFetch.answer(response) }
    }
    return transport
  }

  /// The recorded answer as a MockTransport response.
  static func answer(_ response: JSONValue) throws -> MockTransport.Response {
    if let message = response["$error"]?.stringValue { return .networkError(message) }
    var headers = HTTPHeaders()
    for (name, value) in (response["headers"]?.objectValue ?? [:]).sorted(by: { $0.key < $1.key }) {
      headers.append(name, value.stringValue ?? value.jsString)
    }
    var body = Data()
    if let text = response["body"]?["$text"]?.stringValue { body = Data(text.utf8) }
    if let base64 = response["body"]?["$bytes"]?.stringValue { body = Data(base64Encoded: base64) ?? Data() }
    return .response(HTTPResponse(status: response["status"]?.intValue ?? 200, headers: headers, body: body))
  }

  /// A request as the fixture records it.
  public static func canonical(_ request: HTTPRequest) -> JSONValue {
    var body: JSONValue = .null
    if let data = request.body {
      if let text = String(data: data, encoding: .utf8) {
        if let json = try? JSONValue.parse(text) { body = ["$json": json] } else { body = ["$text": .string(text)] }
      } else {
        body = ["$bytes": .string(data.base64EncodedString())]
      }
    }
    return [
      "url": .string(request.url),
      "method": .string(request.method),
      "headers": .object(request.headers.canonical.mapValues(JSONValue.string)),
      "body": body,
      "timeoutMs": request.timeoutMs.map(JSONValue.number) ?? .null,
    ]
  }

  /// Where `request` differs from the recorded one, or nil.
  public static func difference(_ request: HTTPRequest, _ recorded: JSONValue) -> String? {
    if !Optional(request.url).jsEquals(recorded["url"]?.stringValue) {
      return "url \(request.url) ≠ recorded \(recorded["url"]?.stringValue ?? "nil")"
    }
    if !Optional(request.method).jsEquals(recorded["method"]?.stringValue) {
      return "method \(request.method) ≠ recorded \(recorded["method"]?.stringValue ?? "nil")"
    }
    if let deadline = recorded["timeoutMs"], deadline.doubleValue != request.timeoutMs {
      return "deadline \(request.timeoutMs.map { "\($0) ms" } ?? "none") ≠ recorded \(deadline.doubleValue.map { "\($0) ms" } ?? "none")"
    }
    let headers: JSONValue = .object(request.headers.canonical.mapValues(JSONValue.string))
    if let d = Parity.diff(headers, recorded["headers"] ?? [:], path: "headers", strictNulls: true) { return d }
    let body = recorded["body"] ?? .null
    switch body {
    case .null:
      if let data = request.body { return "body of \(data.count) bytes where the web sent none" }
      return nil
    default:
      guard let data = request.body else { return "no body where the web sent \(body)" }
      if let json = body["$json"] {
        guard let actual = try? JSONValue.parse(data) else { return "body isn't JSON: \(String(decoding: data, as: UTF8.self))" }
        return Parity.diff(actual, json, path: "body", strictNulls: true)
      }
      if let text = body["$text"]?.stringValue {
        let actual = String(decoding: data, as: UTF8.self)
        return actual.jsEquals(text) ? nil : "body \(actual) ≠ recorded \(text)"
      }
      if let base64 = body["$bytes"]?.stringValue, let bytes = Data(base64Encoded: base64) {
        if bytes == data { return nil }
        // A JSON body the web sent as bytes (the Agent encodes its input):
        // the same JSON in another member order is the same request.
        if let a = try? JSONValue.parse(data), let b = try? JSONValue.parse(bytes) {
          return Parity.diff(a, b, path: "body", strictNulls: true)
        }
        return "body bytes \(data.base64EncodedString()) ≠ recorded \(base64)"
      }
      return "unreadable recorded body \(body)"
    }
  }

  /// Where the run differs from the recording, or nil: the requests sent
  /// (`ordered: false` for code that sends them side by side), the waits,
  /// and the result.
  public func check(sent: [HTTPRequest], result: JSONValue, waits: [Double]? = nil, ordered: Bool = true) -> String? {
    if sent.count != exchanges.count {
      let list = sent.map { "  \($0)" }.joined(separator: "\n")
      let recorded = exchanges.map { "  \($0.request["method"]?.stringValue ?? "") \($0.request["url"]?.stringValue ?? "")" }
        .joined(separator: "\n")
      return "sent \(sent.count) requests, the web sent \(exchanges.count)\nsent:\n\(list)\nrecorded:\n\(recorded)"
    }
    if ordered {
      for (index, (request, exchange)) in zip(sent, exchanges).enumerated() {
        if let d = Self.difference(request, exchange.request) { return "request #\(index): \(d)" }
      }
    } else {
      var unused = exchanges.map(\.request)
      for request in sent {
        guard let match = unused.firstIndex(where: { Self.difference(request, $0) == nil }) else {
          return "no recorded request matches \(request)"
        }
        unused.remove(at: match)
      }
    }
    if let waits, waits != self.waits {
      return "waited \(waits), the web waited \(self.waits)"
    }
    return Parity.diff(result, expected).map { "result: \($0)" }
  }

  /// The outcome of a port's call as a fixture records it: its result as
  /// JSON, or `{ "$throws": message }`.
  public static func outcome(_ body: () async throws -> JSONValue) async -> JSONValue {
    do { return try await body() } catch { return ["$throws": .string(jsMessage(error))] }
  }
}

/// A NetworkClock that never waits, reads a fixed time, and records every
/// wait it was asked for.
public final class RecordingClock: @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [Double] = []
  public let now: Double

  public init(now: Double = 1_773_576_000_000) {
    self.now = now
  }

  /// The waits asked for so far, in milliseconds.
  public var waits: [Double] {
    lock.lock()
    defer { lock.unlock() }
    return recorded
  }

  public var clock: NetworkClock {
    NetworkClock(
      now: { [now] in now },
      sleep: { [weak self] ms in
        self?.record(ms)
        await Task.yield()
      }
    )
  }

  private func record(_ ms: Double) {
    lock.lock()
    recorded.append(ms)
    lock.unlock()
  }
}
