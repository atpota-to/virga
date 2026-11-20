// Ports src/accounts/usePendingReauth.js
//
// The hand-off for an account whose sign-in has ended: a short notice
// ("Signing you in again as @x…", with Cancel), then the sign-in. Cancelling,
// or the host going away (`stop()`), stops it.
//
// On the web the sign-in navigates away and the notice goes with the page;
// in the app the sign-in comes back here, so the notice is taken down once
// it has finished.

import Foundation
import Observation
import VirgaCore

@MainActor
@Observable
public final class PendingReauthModel {
  /// How long the notice is up before the sign-in, so it can be read (and
  /// cancelled) first.
  public static let reauthRedirectDelayMs: Double = 2500

  /// The account the notice is about, while it is up.
  public private(set) var pendingReauthAccount: SessionAccount?

  /// Starts the sign-in.
  @ObservationIgnored public var onRelogin: @MainActor (SessionAccount) async throws -> Void
  /// Hears a sign-in that couldn't start.
  @ObservationIgnored public var onError: (@MainActor (any Error) -> Void)?
  @ObservationIgnored private let sleep: @Sendable (Double) async -> Void
  @ObservationIgnored private var timer: Task<Void, Never>?
  @ObservationIgnored private var generation = 0

  public init(
    onRelogin: @escaping @MainActor (SessionAccount) async throws -> Void,
    onError: (@MainActor (any Error) -> Void)? = nil,
    sleep: @escaping @Sendable (Double) async -> Void = { ms in try? await Task.sleep(nanoseconds: UInt64(max(0, ms) * 1_000_000)) }
  ) {
    self.onRelogin = onRelogin
    self.onError = onError
    self.sleep = sleep
  }

  /// `cancelPendingReauth()`: the notice comes down and nothing happens.
  public func cancelPendingReauth() {
    timer?.cancel()
    timer = nil
    generation += 1
    pendingReauthAccount = nil
  }

  /// `beginPendingReauth(account)`: put the notice up, and sign in after the delay.
  public func beginPendingReauth(_ account: SessionAccount) {
    timer?.cancel()
    generation += 1
    let mine = generation
    pendingReauthAccount = account
    let sleep = self.sleep
    timer = Task { [weak self] in
      await sleep(Self.reauthRedirectDelayMs)
      guard !Task.isCancelled, let self, self.generation == mine else { return }
      self.timer = nil
      do {
        try await self.onRelogin(account)
        if self.generation == mine { self.pendingReauthAccount = nil }
      } catch {
        self.pendingReauthAccount = nil
        self.onError?(error)
      }
    }
  }

  /// The host went away: a sign-in not yet started never starts.
  public func stop() {
    timer?.cancel()
    timer = nil
    generation += 1
  }
}
