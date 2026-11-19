// The WHATWG URL parser, URLSearchParams and the URI component functions the
// posting ports use, held to Node's (ios/parity/cases/posting-text.url.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct URLParity {
  static func parts(_ url: WHATWGURL) -> JSONValue {
    [
      "href": .string(url.href),
      "protocol": .string(url.protocolString),
      "username": .string(url.username),
      "password": .string(url.password),
      "host": .string(url.host),
      "hostname": .string(url.hostname),
      "port": .string(url.portString),
      "pathname": .string(url.pathname),
      "search": .string(url.search),
      "hash": .string(url.hash),
    ]
  }

  static func outcome(_ body: () throws -> JSONValue) -> JSONValue {
    do { return try body() } catch { return ["$throws": .string(String(describing: (error as? LocalizedError)?.errorDescription ?? "\(error)"))] }
  }

  @Test func parse() throws {
    for c in try Parity.cases("posting-text.url", fn: "parse") {
      let actual = Self.outcome { Self.parts(try WHATWGURL(c["input"].stringValue ?? "")) }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["input"]): \(d ?? "")")
    }
  }

  @Test func parseWithBase() throws {
    for c in try Parity.cases("posting-text.url", fn: "parseWithBase") {
      let actual = Self.outcome {
        Self.parts(try WHATWGURL(c["input"].stringValue ?? "", base: c["base"].stringValue ?? ""))
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["input"]) on \(c["base"]): \(d ?? "")")
    }
  }

  @Test func searchParams() throws {
    for c in try Parity.cases("posting-text.url", fn: "searchParams") {
      let params = URLSearchParams(c["query"].stringValue ?? "")
      let actual: JSONValue = [
        "pairs": .array(params.pairs.map { [.string($0.name), .string($0.value)] }),
        "serialized": .string(params.description),
      ]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func searchParamsSet() throws {
    for c in try Parity.cases("posting-text.url", fn: "searchParamsSet") {
      var params = URLSearchParams(c["query"].stringValue ?? "")
      params.set(c["name"].stringValue ?? "", c["value"].stringValue ?? "")
      let d = Parity.diff(.string(params.description), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func encodeURIComponent() throws {
    for c in try Parity.cases("posting-text.url", fn: "encodeURIComponent") {
      let actual = URIComponent.encodeURIComponent(c["text"].stringValue ?? "")
      #expect(Parity.diff(.string(actual), c.output) == nil, "\(c)")
    }
  }

  @Test func decodeURIComponent() throws {
    for c in try Parity.cases("posting-text.url", fn: "decodeURIComponent") {
      let actual = Self.outcome { .string(try URIComponent.decodeURIComponent(c["text"].stringValue ?? "")) }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
