// Ports src/lib/sessionHint.js
//
// The cheap, durable "a session may exist" hint the session layer reads at
// startup. Set the moment a sign-in starts and kept while any remembered
// account is signed in; cleared only when none is. Storage access fails
// soft everywhere: with no storage there's no hint.

import Foundation
import VirgaCore

public enum SessionHint {
  public static let sessionHintKey = "virga.oauth.session"

  /// True when a session may exist on this device.
  public static func readSessionHint(_ storage: (any KeyValueStore)?) -> Bool {
    storage?.getItem(sessionHintKey) == "1"
  }

  public static func writeSessionHint(_ storage: (any KeyValueStore)?) {
    try? storage?.setItem(sessionHintKey, "1")
  }

  public static func clearSessionHint(_ storage: (any KeyValueStore)?) {
    storage?.removeItem(sessionHintKey)
  }

  /// Keep the hint in step with the account list: set while any account is
  /// signed in, cleared when none is.
  public static func syncSessionHint(_ storage: (any KeyValueStore)?, _ accounts: [AccountRow]?) {
    if (accounts ?? []).contains(where: { !$0.isSignedOut }) {
      writeSessionHint(storage)
    } else {
      clearSessionHint(storage)
    }
  }

  /// Should the session layer restore a session as the app starts? On a
  /// sign-in's return, and whenever a session may exist (the hint, or a
  /// remembered account that is still signed in); never for someone who has
  /// not signed in.
  public static func restoresAtStartup(hint: Bool, onCallback: Bool, onReturn: Bool = false, hasAccounts: Bool = false) -> Bool {
    onCallback || onReturn || hint || hasAccounts
  }
}
