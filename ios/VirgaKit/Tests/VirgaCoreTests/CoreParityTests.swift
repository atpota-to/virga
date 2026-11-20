// Parity with the web app for VirgaCore's worked examples: graphemes, TIDs
// and the app's constants. The pattern every parity test follows: load a
// fixture written by the web code, run the Swift port on each case's input,
// and compare with the case's output.

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

@Suite struct GraphemesParity {
  @Test func countGraphemes() throws {
    for c in try Parity.cases("core.graphemes", fn: "countGraphemes") {
      let actual = Graphemes.countGraphemes(c["text"].stringValue)
      #expect(Parity.diff(.number(Double(actual)), c.output) == nil, "\(c)")
    }
  }

  @Test func truncateGraphemes() throws {
    for c in try Parity.cases("core.graphemes", fn: "truncateGraphemes") {
      let actual = Graphemes.truncateGraphemes(c["text"].stringValue, c["max"].intValue ?? 0)
      #expect(Parity.diff(.string(actual), c.output) == nil, "\(c)")
    }
  }
}

@Suite struct TIDParity {
  @Test func isTid() throws {
    for c in try Parity.cases("core.tid", fn: "isTid") {
      #expect(Parity.diff(.bool(TID.isTid(c["rkey"].stringValue)), c.output) == nil, "\(c)")
    }
  }

  @Test func tidTimestamp() throws {
    for c in try Parity.cases("core.tid", fn: "tidTimestamp") {
      let actual: JSONValue = TID.tidTimestamp(c["rkey"].stringValue).map { .number(Double($0)) } ?? .null
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func mintedKeysRoundTripAndIncrease() {
    let clock = TIDClock(clockId: 7)
    let at = Date(timeIntervalSince1970: 1_773_576_000)  // 2026-03-15T12:00:00Z
    let first = clock.next(at)
    let second = clock.next(at)
    #expect(TID.isTid(first))
    #expect(first < second, "keys minted at the same instant still sort in order")
    #expect(TID.tidTimestamp(first) == 1_773_576_000_000)
  }
}

@Suite struct AppConfigParity {
  @Test func constants() throws {
    let c = try Parity.cases("core.config", fn: "constants")[0]
    let actual: JSONValue = [
      "APP_NAME": .string(AppConfig.appName),
      "APPVIEW": .string(AppConfig.appview),
      "PLC_DIRECTORY": .string(AppConfig.plcDirectory),
      "OAUTH_CALLBACK_PATH": .string(AppConfig.oauthCallbackPath),
      "OAUTH_RETURN_PATH": .string(AppConfig.oauthReturnPath),
    ]
    #expect(Parity.diff(actual, c.output) == nil)
  }

  @Test func permissionGroupsAreWordForWord() throws {
    let c = try Parity.cases("core.config", fn: "PERMISSION_GROUPS")[0]
    #expect(Parity.diff(encoding: AppConfig.permissionGroups, c.output) == nil)
  }

  @Test func scopes() throws {
    let c = try Parity.cases("core.config", fn: "scopes")[0]
    let actual: JSONValue = [
      "OAUTH_SCOPE": .string(AppConfig.oauthScope),
      "DEFENSE_TOKENS": .array(AppConfig.defenseTokens.map(JSONValue.string)),
      "DEFENSE_SCOPE": .string(AppConfig.defenseScope),
      "LIST_TOKENS": .array(AppConfig.listTokens.map(JSONValue.string)),
      "LISTS_SCOPE": .string(AppConfig.listsScope),
      "DECLARED_SCOPE": .string(AppConfig.declaredScope),
      "POSTING_TOKENS": .array(AppConfig.postingTokens.map(JSONValue.string)),
    ]
    #expect(Parity.diff(actual, c.output) == nil)
  }

  @Test func defenseLevel() throws {
    for c in try Parity.cases("core.config", fn: "defenseLevel") {
      let level = AppConfig.defenseLevel(c["value"])
      // The web returns `false` for none.
      let actual: JSONValue = level.map { .string($0.rawValue) } ?? .bool(false)
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func signInScope() throws {
    for c in try Parity.cases("core.config", fn: "signInScope") {
      let scope = AppConfig.signInScope(defense: AppConfig.defenseLevel(c["defense"]))
      #expect(Parity.diff(.string(scope), c.output) == nil, "\(c)")
    }
  }
}

@Suite struct JSONValueBehaviour {
  @Test func integralNumbersEncodeWithoutAFraction() throws {
    let value: JSONValue = ["n": 3, "f": 1.5, "nan": .number(.nan)]
    #expect(value.jsonString() == #"{"f":1.5,"n":3,"nan":null}"#)
  }

  @Test func decodesWhatItEncodes() throws {
    let value: JSONValue = ["a": [1, "two", true, nil], "b": ["c": 2.25]]
    #expect(try JSONValue.parse(value.jsonString()) == value)
  }

  @Test func facetEncodesAsTheWebWritesIt() throws {
    let facet = Facet(byteStart: 0, byteEnd: 5, feature: .tag(tag: "bees"))
    let json = try JSONValue(encoding: facet)
    #expect(json["$type"] == "app.bsky.richtext.facet")
    #expect(json["features"]?[0]?["$type"] == "app.bsky.richtext.facet#tag")
    #expect(try json.decode(Facet.self) == facet)
  }
}
