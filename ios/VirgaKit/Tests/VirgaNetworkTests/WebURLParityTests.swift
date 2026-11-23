// WebURL against Node's own `new URL` (ios/parity/cases/network.url.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaNetwork

@Suite struct WebURLParity {
  static func parts(_ url: WebURL) -> JSONValue {
    [
      "href": .string(url.href),
      "protocol": .string(url.protocol),
      "username": .string(url.username),
      "password": .string(url.password),
      "host": .string(url.hostWithPort),
      "hostname": .string(url.hostname),
      "port": .string(url.portString),
      "pathname": .string(url.pathname),
      "search": .string(url.search),
      "hash": .string(url.hash),
      "origin": .string(url.origin),
    ]
  }

  static func outcome(_ body: () throws -> WebURL) -> JSONValue {
    do { return parts(try body()) } catch { return ["$throws": .string(jsMessage(error))] }
  }

  @Test func parse() throws {
    for c in try Parity.cases("network.url", fn: "parse") {
      let actual = Self.outcome { try WebURL(c["input"].stringValue ?? "") }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["input"]): \(d ?? "")")
    }
  }

  @Test func parseRelative() throws {
    for c in try Parity.cases("network.url", fn: "parseRelative") {
      let actual = Self.outcome { try WebURL(c["input"].stringValue ?? "", base: c["base"].stringValue ?? "") }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["input"]) on \(c["base"]): \(d ?? "")")
    }
  }

  @Test func setSearch() throws {
    for c in try Parity.cases("network.url", fn: "setSearch") {
      let actual = Self.outcome {
        var url = try WebURL(c["url"].stringValue ?? "")
        url.setSearch(c["search"].stringValue ?? "")
        return url
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func setSearchParam() throws {
    for c in try Parity.cases("network.url", fn: "setSearchParam") {
      let actual = Self.outcome {
        var url = try WebURL(c["url"].stringValue ?? "")
        url.setSearchParam(c["name"].stringValue ?? "", c["value"].stringValue ?? "")
        return url
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
