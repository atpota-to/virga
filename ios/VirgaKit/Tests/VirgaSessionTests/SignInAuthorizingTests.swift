// SignInOptions.onAuthorizing: the sign-in's "Still here?" covers only the
// wait for Virga's server to give the host's address, as the web's covers
// only the wait before the page leaves for the host. The session says when
// that wait is over, as the system's sheet opens, so the flow stops its
// stall timer there and doesn't speak over the host's page.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaSession

@MainActor
@Suite struct SignInAuthorizing {
  /// The sheet's stand-in, noting when it opens.
  struct Sheet: WebAuthenticator {
    let tabStorage: InMemoryKeyValueStore
    let log: Locked<[String]>

    func authenticate(url: String, callbackHost: String, callbackPath: String) async throws -> String {
      log.withLock { $0.append("sheet") }
      let nonce = BackendClient.readSigninPending(tabStorage)?["nonce"]?.stringValue ?? ""
      return "https://\(callbackHost)\(callbackPath)?n=\(nonce)#session=\(People.token)&did=\(People.mira)"
    }
  }

  private let authorize: World.Answer = { url, _ in
    url.contains("/api/oauth/login")
      ? .json(["success": true, "authUrl": "https://bsky.social/oauth/authorize?x=1"])
      : .json(["success": true, "authenticated": true, "scope": .string(AppConfig.oauthScope)])
  }

  @Test func toldOnceAsTheSheetOpens() async throws {
    let tab = InMemoryKeyValueStore()
    let log = Locked<[String]>([])
    let w = World(tabStorage: tab, authMode: "backend", authenticator: Sheet(tabStorage: tab, log: log), answer: authorize)
    let options = SignInOptions(onAuthorizing: { log.withLock { $0.append("authorizing") } })
    try await w.ctrl.signIn("mira.example.com", options)
    #expect(log.wrappedValue == ["authorizing", "sheet"])
    #expect(w.state.active.did == People.mira)
  }

  @Test func notToldWhenTheServerGivesNoAddress() async {
    let tab = InMemoryKeyValueStore()
    let log = Locked<[String]>([])
    let refuse: World.Answer = { url, _ in
      url.contains("/api/oauth/login") ? .json(["success": false, "error": "Handle not found"], status: 400) : .json(["success": true])
    }
    let w = World(tabStorage: tab, authMode: "backend", authenticator: Sheet(tabStorage: tab, log: log), answer: refuse)
    let options = SignInOptions(onAuthorizing: { log.withLock { $0.append("authorizing") } })
    let error = await thrown { try await w.ctrl.signIn("nobody.example.com", options) }
    #expect(error != nil)
    #expect(log.wrappedValue.isEmpty, "the stall still covers a server that doesn't answer")
  }

  @Test func theCallbackIsNotPartOfTheOptionsEquality() {
    let told = SignInOptions(mode: "backend", intent: "reauth", did: People.mira, onAuthorizing: {})
    #expect(told == SignInOptions(mode: "backend", intent: "reauth", did: People.mira))
    #expect(told.hashValue == SignInOptions(mode: "backend", intent: "reauth", did: People.mira).hashValue)
    #expect(told != SignInOptions(mode: "backend", intent: "add", did: People.mira))
  }
}
