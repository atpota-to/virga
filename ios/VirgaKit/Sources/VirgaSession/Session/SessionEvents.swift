// Ports src/accounts/accountCopy.js (the window events requestReauth and showSessionNotice send)
//
// The web's `window.dispatchEvent(new CustomEvent(name, { detail }))` for
// the session layer's three events: a sign-in that turned out to have ended
// (Accounts.sessionExpiredEvent), a request to sign an account in again
// (AccountCopy.reauthRequestEvent) and a line for the session notices
// (AccountCopy.sessionNoticeEvent). SessionNotices (VirgaUI) listens, as it
// does on the web, so two screens never race to send someone off to sign in.

import Foundation
import VirgaCore

/// One event: its name and its `detail`.
public struct SessionEvent: Sendable, Hashable {
  public var name: String
  public var detail: JSONValue

  public init(name: String, detail: JSONValue) {
    self.name = name
    self.detail = detail
  }
}

/// The window, as far as the session layer's events go.
@MainActor
public final class SessionEvents {
  public typealias Listener = @MainActor (SessionEvent) -> Void

  /// The app's own.
  public static let shared = SessionEvents()

  private var listeners: [(id: Int, name: String, listener: Listener)] = []
  private var nextId = 0

  public init() {}

  /// `addEventListener(name, listener)`: returns what `removeListener` takes.
  @discardableResult
  public func addListener(_ name: String, _ listener: @escaping Listener) -> Int {
    nextId += 1
    listeners.append((nextId, name, listener))
    return nextId
  }

  public func removeListener(_ id: Int) {
    listeners.removeAll { $0.id == id }
  }

  /// `dispatchEvent(new CustomEvent(name, { detail }))`: every listener for
  /// `name`, in the order they were added.
  public func dispatch(_ name: String, _ detail: JSONValue) {
    let event = SessionEvent(name: name, detail: detail)
    for entry in listeners where entry.name.jsEquals(name) { entry.listener(event) }
  }
}
