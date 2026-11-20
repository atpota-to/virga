// Ports src/session/browserDriver.js (its interface)
//
// Browser sign-ins: atproto OAuth held by the browser itself, through
// @atproto/oauth-client-browser. The iOS app never has one (it signs in only
// through Virga's server), but the session controller is the web's, browser
// branches and all, so it takes the driver's interface: `BrowserSessionDriver`.
// The app passes `NoBrowserSessions`, under which a browser-session row
// (which nothing on iOS writes) reads as one that has to sign in again.
// Tests stand a fake in, as the web's tests do.
//
// Not ported: createBrowserDriver and its helpers (classifyRestoreError,
// isRevokedCause, grantedScopeOf, isCallbackResult), which wrap that library.

import Foundation
import VirgaCore
import VirgaNetwork

/// A browser session (the library's OAuthSession): whose it is, and the
/// fetch handler an Agent is built over.
public protocol BrowserOAuthSession: Sendable {
  var sub: String { get }
  var fetchHandler: any XRPCFetchHandler { get }
}

/// Why a restore failed: 'expired' (definitive: only a new sign-in brings it
/// back) or 'unknown' (no network, a server that didn't answer).
public struct BrowserRestoreError: Error, Sendable, Hashable, LocalizedError {
  public var restoreFailure: String
  public var message: String

  public init(restoreFailure: String, message: String) {
    self.restoreFailure = restoreFailure
    self.message = message
  }

  public var errorDescription: String? { message }
}

/// The browser driver's interface, as the controller uses it.
public protocol BrowserSessionDriver: Sendable {
  /// On the callback path: finish the sign-in, or nil when there was none.
  func finishCallback() async throws -> (session: any BrowserOAuthSession, intent: String)?
  /// The library's own current session, for a browser from before the account list.
  func legacySession() async throws -> (any BrowserOAuthSession)?
  /// An account's session. Throws BrowserRestoreError.
  func restore(_ did: String) async throws -> any BrowserOAuthSession
  /// Leaves for the account's authorization server.
  func signIn(_ input: String, scope: String, intent: String, prompt: String?) async throws
  /// Ends one account's session here. Never throws.
  func signOut(_ did: String, session: (any BrowserOAuthSession)?) async
  /// The scope a session was granted, without a round trip, or nil.
  func grantedScope(_ session: (any BrowserOAuthSession)?) async -> String?
  /// Calls `handler(sub, revoked)` whenever the library drops a session.
  @MainActor func onDeleted(_ handler: @escaping @MainActor (_ sub: String?, _ revoked: Bool) -> Void)
}

/// The app's: there are no browser sessions on iOS.
public struct NoBrowserSessions: BrowserSessionDriver {
  public init() {}

  public func finishCallback() async throws -> (session: any BrowserOAuthSession, intent: String)? { nil }
  public func legacySession() async throws -> (any BrowserOAuthSession)? { nil }

  public func restore(_ did: String) async throws -> any BrowserOAuthSession {
    throw BrowserRestoreError(restoreFailure: "expired", message: "There are no browser sessions in the app.")
  }

  public func signIn(_ input: String, scope: String, intent: String, prompt: String?) async throws {
    throw BackendError(message: "The app signs in through Virga’s server.", code: "REDIRECT_NOT_ALLOWED")
  }

  public func signOut(_ did: String, session: (any BrowserOAuthSession)?) async {}
  public func grantedScope(_ session: (any BrowserOAuthSession)?) async -> String? { nil }
  @MainActor public func onDeleted(_ handler: @escaping @MainActor (_ sub: String?, _ revoked: Bool) -> Void) {}
}
