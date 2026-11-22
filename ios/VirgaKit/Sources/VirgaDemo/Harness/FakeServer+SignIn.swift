// Ports harness/fakeSession.jsx (signIn: who a sign-in lands as) and
// harness/fakeServer.js (mintToken), as server/oauth/handlers/login.js and
// callback.js answer a sign-in
//
// The demo's sign-in, through the app's own code: SessionController asks
// /api/oauth/login for the address of the account's host
// (BackendClient.startBackendSignIn), opens it in the sign-in sheet, and
// takes the return page's `#session=…&did=…`. Here the "host" is the fake
// server itself: `authorize(_:)` is the trip there and back, which
// DemoAuthenticator makes in the sheet's place.
//
// Who a sign-in lands as is fakeSession.jsx's rule: Field Lab by its handle
// or DID, anyone else as Mira (a host's address included, as making an
// account there), and an input starting "nobody" (or an account the demo
// doesn't have) is a handle that can't be resolved. The scope granted is
// the session's own with Defense's permission at the level the sign-in
// asked for (`defense=1` the read, `defense=lists` the list writes too,
// none for neither), as the real server's scopeFor reads `defense`; the
// web fake's "unsaid keeps the grant" can't be told apart here, since the
// app always says.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

extension DemoServer {
  /// The path the sheet is sent to: the account's "host".
  public static let authorizePath = "/harness/authorize"

  /// fakeSession.jsx's `signIn(input)`: the account a sign-in for `input`
  /// lands as, or nil when it can't be resolved.
  public func accountFor(_ input: String) -> WorldAccount? {
    let units = Array(input.utf16)
    let nobody = Array("nobody".utf16)
    if units.count >= nobody.count, zip(units.prefix(nobody.count), nobody).allSatisfy({ $0.0 < 0x80 && ($0.0 | 0x20) == $0.1 }) {
      return nil
    }
    let bare = units.first == 0x40 ? String(decoding: units.dropFirst(), as: UTF16.self) : input
    let id = bare.jsEquals(World.lab.handle) || input.jsEquals(World.lab.did) ? World.lab : World.me
    return world.world(id.did) == nil ? nil : id
  }

  /// GET /api/oauth/login: the address that starts a sign-in, as JSON.
  func loginRoute(_ query: [(String, String)]) -> ServerAnswer {
    let handle = (Self.get(query, "handle") ?? "").jsTrimmed()
    if handle.isEmpty {
      return ServerAnswer(400, FakeServer.failure("A handle is required.", code: "HANDLE_REQUIRED"))
    }
    guard let redirect = Self.get(query, "redirect_uri"), let url = try? WebURL(redirect),
      url.pathname == AppConfig.oauthReturnPath
    else {
      return ServerAnswer(
        400,
        FakeServer.failure("redirect_uri must be Virga's /oauth/return page on an allowed origin.", code: "REDIRECT_NOT_ALLOWED"))
    }
    guard let account = accountFor(handle) else {
      return ServerAnswer(400, FakeServer.failure("That handle could not be found.", code: "HANDLE_NOT_FOUND"))
    }
    var pairs = [("did", account.did), ("redirect_uri", redirect)]
    if let defense = Self.get(query, "defense"), defense == "1" || defense == "lists" { pairs.append(("defense", defense)) }
    return ServerAnswer(
      200, ["success": true, "authUrl": .string("\(FakeServer.serverOrigin)\(Self.authorizePath)?\(JSURI.searchParams(pairs))")])
  }

  /// The trip to the account's host and back: the account is signed in
  /// (a new token, and the grant at the level asked for) and the sheet
  /// comes back to the return page with `#session=<token>&did=<did>`, the
  /// page's own query (its nonce) kept. Throws for an address that isn't
  /// one `/api/oauth/login` gave.
  public func authorize(_ authUrl: String) throws -> String {
    let url = try WebURL(authUrl)
    guard url.origin == FakeServer.serverOrigin, url.pathname == Self.authorizePath,
      let did = Self.get(url.searchParams, "did"), let redirect = Self.get(url.searchParams, "redirect_uri")
    else {
      throw WebAuthenticationError.failed("The account's host could not start a sign-in.")
    }
    let level: Harness.DefenseLevel
    switch Self.get(url.searchParams, "defense") {
    case "1": level = .scan
    case "lists": level = .lists
    default: level = .none
    }
    try world.regrant(did, defense: level)
    let token = mintToken(did)
    note("\(did) signed in")
    var page = redirect
    if let hash = page.firstIndex(of: "#") { page = String(page[..<hash]) }
    return "\(page)#\(JSURI.searchParams([("session", token), ("did", did)]))"
  }
}

/// The sign-in sheet in the demo: it "visits" the account's host (the fake
/// server's `authorize`), after the half second fakeSession.jsx's sign-in
/// takes, and comes back with the return page's address. Cancelling the
/// task calls it off, as closing the sheet does.
public struct DemoAuthenticator: WebAuthenticator {
  public var server: DemoServer
  public var clock: NetworkClock
  public var delayMs: Double

  public init(server: DemoServer, clock: NetworkClock = .live, delayMs: Double = 500) {
    self.server = server
    self.clock = clock
    self.delayMs = delayMs
  }

  public func authenticate(url: String, callbackHost: String, callbackPath: String) async throws -> String {
    await clock.sleep(delayMs)
    if Task.isCancelled { throw WebAuthenticationError.cancelled }
    return try server.authorize(url)
  }
}
