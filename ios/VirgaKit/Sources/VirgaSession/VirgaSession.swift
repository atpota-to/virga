// VirgaSession
//
// Accounts, sessions (a long session held by Virga's server), scopes, session health, sign-in a step at a time, and the agreement to the terms. Ports src/session/, src/accounts/*.js, src/signin/*.js, src/legal/*.js.
//
// See ios/PORTING.md for the conventions every file here follows.

import Foundation

/// The module's namespace, for version and identity.
public enum VirgaSessionModule {
  public static let name = "VirgaSession"
}
