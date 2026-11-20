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
      let actual = JSURI.encodeURIComponent(c["text"].stringValue ?? "")
      #expect(Parity.diff(.string(actual), c.output) == nil, "\(c)")
    }
  }

  @Test func decodeURIComponent() throws {
    for c in try Parity.cases("posting-text.url", fn: "decodeURIComponent") {
      let actual = Self.outcome { .string(try JSURI.decodeURIComponent(c["text"].stringValue ?? "")) }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}

/// Hosts character by character (ios/parity/cases/posting-text.idna.js):
/// the generated UTS #46 table and Node's validity rules.
@Suite struct IDNAParity {
  static func hostname(_ label: String) -> String {
    (try? WHATWGURL("https://\(label).com"))?.hostname ?? "-"
  }

  @Test func host() throws {
    for c in try cases("posting-text.idna", "host") {
      guard let scalar = Unicode.Scalar(UInt32(c.int("cp"))) else { continue }
      let ch = String(scalar)
      let forms = [ch, "a\(ch)a", "\(ch)\u{05D0}\u{05D0}", "\u{05D0}\(ch)", "\u{05D0}\u{0661}\(ch)"]
      check(.string(forms.map(Self.hostname).joined(separator: " ")), c)
    }
  }

  @Test func bidiShapes() throws {
    for c in try cases("posting-text.idna", "bidiShapes") {
      let first = c.string("first") ?? ""
      let chars = [""] + c.strings("chars")
      var bits = ""
      for second in chars {
        for third in chars where !(second.isEmpty && !third.isEmpty) {
          bits += IDNA.domainToASCII(first + second + third) == nil ? "0" : "1"
        }
      }
      check(.string(bits), c)
    }
  }
}

/// Where Node's URL parser (Ada 2.9.2) leaves the URL Standard, the port
/// follows the Standard, as browsers do, so these can't be Node fixtures.
/// Neither reaches the posting code, which acts only on http(s) URLs.
@Suite struct URLStandardBehaviour {
  /// A path that ends in `..` straight after a non-special URL's root keeps
  /// the root (the Standard's path state appends an empty segment at the end
  /// of the input). Ada gives "foo:" and "foo://h".
  @Test func aDoubleDotAtTheRootKeepsTheRoot() throws {
    #expect(try WHATWGURL("foo:/..").href == "foo:/")
    #expect(try WHATWGURL("foo:/.%2E").href == "foo:/")
    #expect(try WHATWGURL("foo://h/..").href == "foo://h/")
    #expect(try WHATWGURL("foo://h/.%2e?q#f").href == "foo://h/?q#f")
    #expect(try WHATWGURL("C:/.%2E", base: "https://example.com/a").href == "c:/")
    #expect(try WHATWGURL("a+b:////.a/./").href == "a+b:////.a/")
    // Special URLs agree with Node.
    #expect(try WHATWGURL("https://h/.%2e").href == "https://h/")
    #expect(try WHATWGURL("foo:/a/..").href == "foo:/")
  }

  /// Against a base with an opaque path only a lone fragment resolves; Ada
  /// also resolves any input that holds a `#` somewhere.
  @Test func anOpaqueBaseTakesOnlyAFragment() throws {
    #expect(try WHATWGURL("#y", base: "mailto:a").href == "mailto:a#y")
    for input in ["x#y", "/p#f", "//h/p#f", "x?q"] {
      #expect(throws: WHATWGURLError.self, "\(input)") { try WHATWGURL(input, base: "mailto:a") }
    }
    #expect(throws: WHATWGURLError.self) { try WHATWGURL("/intent/compose", base: "data:text/plain,hi") }
  }
}
