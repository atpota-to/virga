// Ports src/posting/ui/backendAccess.js
//
// What the "needs a long session" panel offers an account. Scheduling, the
// weekly queue, timers and the adviser run on Virga's server, so they need
// the account signed in through it.

import Foundation
import VirgaCore
import VirgaSession

/// `{ ready, action }`:
///   ready: true             the account can use the server's features
///   action: 'reconnect'     a browser session, and this copy of Virga offers
///                           long sessions: sign in again through it
///   action: 'signBackIn'    a long session that has ended
///   action: 'unavailable'   a browser session, and long sessions aren't
///                           offered here
///   action: 'none'          no such account
public struct BackendAccessState: Codable, Hashable, Sendable {
  public var ready: Bool
  /// nil when ready (the web's null).
  public var action: String?

  public var json: JSONValue { ["ready": .bool(ready), "action": action.map(JSONValue.string) ?? .null] }
}

public enum BackendAccess {
  /// `backendAccess(account, { authMode, canSchedule })` for an account as
  /// the web holds it (`account.mode` is read).
  public static func backendAccess(_ account: JSONValue?, authMode: JSONValue? = nil, canSchedule: JSONValue? = nil)
    -> BackendAccessState
  {
    guard let account, account.isTruthy else { return BackendAccessState(ready: false, action: "none") }
    if canSchedule?.isTruthy == true { return BackendAccessState(ready: true, action: nil) }
    if account["mode"]?.stringValue == "backend" { return BackendAccessState(ready: false, action: "signBackIn") }
    return BackendAccessState(ready: false, action: authMode?.stringValue == "backend" ? "reconnect" : "unavailable")
  }

  /// backendAccess for one of the session's accounts.
  public static func backendAccess(_ account: SessionAccount?, authMode: String?, canSchedule: Bool)
    -> BackendAccessState
  {
    backendAccess(
      account.map { ["mode": .string($0.mode)] }, authMode: authMode.map(JSONValue.string),
      canSchedule: .bool(canSchedule))
  }
}
