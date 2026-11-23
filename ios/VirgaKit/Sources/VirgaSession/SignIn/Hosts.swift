// Ports src/signin/hosts.js
//
// The hosts offered to someone who has no account yet. An account's handle
// and posts live on a host (a PDS); Virga doesn't run one, so making an
// account means choosing one of these and making it on their page.
//
// `url` is what a sign-in is started with: the host's address in place of a
// handle, with `prompt: 'create'`, which opens the host's page on making an
// account. session.signin holds the list to the web's (a surface fixture).

import Foundation
import VirgaCore

/// One of the hosts: `{ id, name, domain, url, region, recommended }`.
public struct SignupHost: Sendable, Hashable, Codable, Identifiable {
  public var id: String
  public var name: String
  public var domain: String
  public var url: String
  /// Where the host keeps its accounts' data, as it describes itself.
  public var region: String
  public var recommended: Bool
}

public enum SignInHosts {
  /// `SIGNUP_HOSTS`: the same five Anisota offers, in the same order.
  public static let signupHosts: [SignupHost] = [
    SignupHost(id: "bluesky", name: "Bluesky", domain: "bsky.social", url: "https://bsky.social", region: "United States", recommended: true),
    SignupHost(id: "blacksky", name: "Blacksky", domain: "blacksky.app", url: "https://blacksky.app", region: "United States", recommended: false),
    SignupHost(id: "eurosky", name: "Eurosky", domain: "eurosky.social", url: "https://eurosky.social", region: "Germany", recommended: false),
    SignupHost(
      id: "selfhosted", name: "self-hosted.social", domain: "selfhosted.social", url: "https://selfhosted.social", region: "United States",
      recommended: false),
    SignupHost(id: "npmx", name: "npmx", domain: "npmx.social", url: "https://npmx.social", region: "Germany", recommended: false),
  ]

  /// What a host's refusal can't be put down to: Virga's own server, the
  /// connection, a limit, or the reader calling it off.
  static let notTheHost: Set<String> = [
    "NETWORK_ERROR", "RATE_LIMITED", "VIRGA_CLIENT_UNAVAILABLE", "REDIRECT_NOT_ALLOWED", "CANCELLED", "INTERNAL",
  ]

  /// `notTheHosts(error)`: whether a failed sign-in is something other than
  /// the host saying no.
  public static func notTheHosts(_ error: (any Error)?) -> Bool {
    notTheHosts(JSErrorFields(error))
  }

  public static func notTheHosts(_ error: JSErrorFields?) -> Bool {
    if let code = error?.code?.stringValue, notTheHost.contains(where: { $0.jsEquals(code) }) { return true }
    if error?.name == "AbortError" { return true }
    let message = (error?.message ?? "").units.map(Unit.asciiLower)
    if OAuthClient.has(message, "navigated back") || OAuthClient.has(message, "aborted") { return true }
    // A request that never arrived, as a browser sign-in's library reports it.
    return error?.name == "TypeError"
      && (OAuthClient.has(message, "fetch") || OAuthClient.has(message, "network") || OAuthClient.has(message, "load failed"))
  }

  /// `signUpAt(signIn, hostUrl, options)`: send someone to `hostUrl` to make
  /// an account. A host that turns down the request for its make-an-account
  /// page (older software doesn't know the prompt) is asked again for its
  /// ordinary sign-in page, which has its own way to make one. Cancelling
  /// the task calls the whole thing off, the second try included.
  public static func signUpAt(
    _ signIn: (String, SignInOptions) async throws -> Void,
    _ hostUrl: String,
    options: SignInOptions = SignInOptions()
  ) async throws {
    var first = options
    first.intent = "add"
    first.prompt = "create"
    do {
      try await signIn(hostUrl, first)
    } catch {
      if Task.isCancelled || notTheHosts(error) { throw error }
      var second = options
      second.intent = "add"
      try await signIn(hostUrl, second)
    }
  }
}
