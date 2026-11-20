// Ports src/session/useAtprotoSession.jsx (the provider's `accounts`)
//
// The session's account list as the web's provider hands it out
// (useAtprotoSession's `accounts`): each remembered account with the status
// it is shown with.

import Foundation
import VirgaCore

/// How an account is shown: usable, couldn't be checked (still used), or
/// signed out until a fresh sign-in.
public enum AccountStatus: String, Sendable, Hashable, Codable {
  case ready
  case unknown
  case needsSignIn
}

/// `{ did, handle, displayName, avatar, mode, lastUsed, status }`.
public struct SessionAccount: Sendable, Hashable, Codable, AccountLike {
  public var did: String
  public var handle: String?
  public var displayName: String?
  public var avatar: String?
  public var mode: String
  public var lastUsed: Double
  public var status: AccountStatus

  public init(
    did: String, handle: String? = nil, displayName: String? = nil, avatar: String? = nil, mode: String = "backend",
    lastUsed: Double = 0, status: AccountStatus = .ready
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
    self.mode = mode
    self.lastUsed = lastUsed
    self.status = status
  }

  /// A remembered row with its status.
  public init(_ row: AccountRow, status: AccountStatus) {
    self.init(
      did: row.did, handle: row.handle, displayName: row.displayName, avatar: row.avatar, mode: row.mode,
      lastUsed: row.lastUsed, status: status)
  }
}
