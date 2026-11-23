// Ports src/posting/composer/Composer.jsx (blueskyGates, readBlueskyGates, resolveGatesFor)
//
// Each account's Bluesky default reply settings as the composer last read
// them: a good read is kept five minutes and a failed one thirty seconds.
// The Replies row and the post that goes out are resolved through it, so a
// post goes out with the reply settings the writer was shown, and Post
// doesn't wait on Bluesky again (nor fall back to "anyone can reply" when
// that second read fails).

import Foundation
import VirgaCore

public final class BlueskyGatesCache: Sendable {
  /// Composer.jsx's GATES_CACHE_MS: how long a good read is kept.
  public static let cacheMs: Double = 5 * 60 * 1000
  /// Composer.jsx's GATES_FAILURE_CACHE_MS: how long a failed read is kept.
  public static let failureCacheMs: Double = 30 * 1000

  struct Entry: Sendable {
    var value: JSONValue?
    var at: Double
    var ok: Bool
  }

  private let entries = Locked<[JSKey: Entry]>([:])
  let now: @Sendable () -> Double

  /// - Parameter now: the clock (epoch ms).
  public init(now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
    self.now = now
  }

  /// readBlueskyGates: `did`'s Bluesky default gates as last read while
  /// that read is fresh; otherwise read again with `agent`'s
  /// getPreferences (nil when there's no agent or the read fails or takes
  /// too long), and kept.
  public func read(_ did: String, agent: @Sendable () async throws -> (any GatesAgent)?) async -> JSONValue? {
    let key = JSKey(did)
    if let hit = entries.withLock({ $0[key] }), now() - hit.at < (hit.ok ? Self.cacheMs : Self.failureCacheMs) {
      return hit.value
    }
    var value: JSONValue?
    if let found = try? await agent() { value = await Gates.readDefaultGates(found)?.json }
    let entry = Entry(value: value, at: now(), ok: value != nil)
    entries.withLock { $0[key] = entry }
    return value
  }

  /// resolveGatesFor: the gates a new post from `did` starts with
  /// (PostingSettingsStore.resolveDefaultGates), Bluesky's setting read
  /// through the cache.
  public func resolve(
    _ settings: PostingSettings, did: String, agent: @escaping @Sendable () async throws -> (any GatesAgent)?
  ) async -> ResolvedDefaultGates {
    var read: (@Sendable () async throws -> JSONValue?)?
    if !did.isEmpty {
      read = { @Sendable [self] in await self.read(did, agent: agent) }
    }
    let everyone = ResolvedDefaultGates(
      gates: ["custom": false, "reply": .null, "quotes": true], source: "everyone", notice: nil)
    return (try? await PostingSettingsStore.resolveDefaultGates(settings.json, readDefaultGates: read)) ?? everyone
  }
}
