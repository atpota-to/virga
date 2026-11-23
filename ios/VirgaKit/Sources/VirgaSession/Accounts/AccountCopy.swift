// Ports src/accounts/accountCopy.js
//
// How the account screens word an account, and the requests they hand to
// SessionNotices (the one place that sends someone off to sign in again, so
// two screens never race to do it). session.accounts holds the words to the
// web's, word for word.

import Foundation
import VirgaCore

public enum AccountCopy {
  public static let reauthRequestEvent = "virga:reauth-request"
  public static let sessionNoticeEvent = "virga:session-notice"

  /// For a session granted before Virga could post (Scopes.missingScopes).
  public static let postingRegrantMessage = "Virga needs permission to post. Sign in again to grant it."

  /// What each kind of sign-in is called on screen.
  public static func modeLabel(_ mode: String?) -> String {
    mode == "backend" ? "Long session through Virga’s server" : "Browser session"
  }

  /// A short word for an account's state, or nil when there's nothing to say.
  public static func statusLabel(_ status: String?, active: Bool = false, switching: Bool = false) -> String? {
    if switching { return "Switching…" }
    if status == "needsSignIn" { return "Signed out" }
    if status == "unknown" { return "Couldn’t check" }
    return active ? "Open now" : nil
  }

  /// `reauthModeFor(account, authMode)` with the account's `mode`: which
  /// sign-in a fresh sign-in for this account should be. A long session
  /// stays one; a browser session becomes one when new accounts sign in
  /// that way.
  public static func reauthModeFor(accountMode: String?, _ authMode: String?) -> String {
    accountMode == "backend" || authMode == "backend" ? "backend" : "browser"
  }

  /// `offersLongerSession(account, authMode)` with the account's `mode`.
  public static func offersLongerSession(accountMode: String?, _ authMode: String?) -> Bool {
    authMode == "backend" && accountMode == "browser"
  }

  /// Ask SessionNotices to sign `did` in again: after the short notice, or
  /// at once (`immediate`, for a "Sign back in" the reader pressed).
  @MainActor
  public static func requestReauth(_ did: String?, immediate: Bool = false, events: SessionEvents = .shared) {
    events.dispatch(reauthRequestEvent, ["did": did.map(JSONValue.string) ?? .null, "immediate": .bool(immediate)])
  }

  /// Show a line in SessionNotices (a sign-in that couldn't start, say).
  @MainActor
  public static func showSessionNotice(_ text: String, tone: String = "danger", events: SessionEvents = .shared) {
    events.dispatch(sessionNoticeEvent, ["text": .string(text), "tone": .string(tone)])
  }

  static func count(_ n: Int, _ one: String, _ many: String) -> String {
    "\(n) \(n == 1 ? one : many)"
  }

  /// `pendingWorkWarning(name, work)`: what signing `name` out stops, for a
  /// long session with work waiting on Virga's server, or nil when nothing
  /// is waiting. `work` nil is work that couldn't be read.
  public static func pendingWorkWarning(_ name: String, _ work: PendingWorkCount?) -> String? {
    let others = "no other browser or device is signed in to Virga as \(name)"
    let until = "until \(name) signs back in with a long session"
    guard let work else {
      return "Virga couldn’t check whether \(name) has scheduled posts or post timers waiting. If it has, and \(others), they stop \(until)."
    }
    var what: [String] = []
    var stops: [String] = []
    if work.posts > 0 {
      what.append(count(work.posts, "scheduled post", "scheduled posts"))
      stops.append(work.posts == 1 ? "the post won’t go out" : "the posts won’t go out")
    }
    if work.timers > 0 {
      what.append(count(work.timers, "post timer", "post timers"))
      stops.append(work.timers == 1 ? "the timer won’t delete anything" : "the timers won’t delete anything")
    }
    if what.isEmpty { return nil }
    return "\(name) has \(what.joined(separator: " and ")) waiting on Virga’s server. If \(others), \(stops.joined(separator: " and ")) \(until)."
  }

  /// `pendingWorkWarning(name, byDid[did])`: an account the check didn't
  /// cover (`undefined`) reads as one it couldn't check.
  public static func pendingWorkWarning(_ name: String, _ entry: PendingWorkEntry) -> String? {
    if case .counted(let work) = entry { return pendingWorkWarning(name, work) }
    return pendingWorkWarning(name, nil)
  }
}
