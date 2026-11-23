// ui/backendAccess.js and ui/postPreview.js held to adviser.ui.

import Foundation
import Testing
import VirgaCore
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct PostPreviewParity {
  static let f = "adviser.ui"

  @Test func backendAccess() throws {
    for c in try cases(Self.f, "backendAccess") {
      check(
        BackendAccess.backendAccess(c.input["account"], authMode: c.input["authMode"], canSchedule: c.input["canSchedule"])
          .json, c)
    }
    for c in try cases(Self.f, "backendAccessNoOptions") {
      check(BackendAccess.backendAccess(["mode": "backend"]).json, c)
    }
  }

  @Test func typedAccounts() {
    let backend = SessionAccount(did: "did:plc:a", mode: "backend")
    let browser = SessionAccount(did: "did:plc:b", mode: "browser")
    #expect(BackendAccess.backendAccess(backend, authMode: "backend", canSchedule: true) == BackendAccessState(ready: true, action: nil))
    #expect(BackendAccess.backendAccess(backend, authMode: "backend", canSchedule: false).action == "signBackIn")
    #expect(BackendAccess.backendAccess(browser, authMode: "backend", canSchedule: false).action == "reconnect")
    #expect(BackendAccess.backendAccess(browser, authMode: "browser", canSchedule: false).action == "unavailable")
    #expect(BackendAccess.backendAccess(nil, authMode: "backend", canSchedule: true).action == "none")
  }

  @Test func embeds() throws {
    for c in try cases(Self.f, "embedSummary") {
      check(PostPreview.embedSummary(c.input["embed"], locale: c.string("locale")).map(JSONValue.string) ?? .null, c)
    }
  }

  @Test func previews() throws {
    for c in try cases(Self.f, "postPreviewModel") {
      let model = PostPreview.postPreviewModel(
        view: c.input["view"], record: c.input["record"], uri: c.input["uri"], compact: c["compact"].boolValue ?? false,
        locale: c.string("locale"))
      check(model.json, c)
    }
  }
}
