// Ports src/lib/oauthClient.js
//
// The words for a sign-in that couldn't start or didn't finish. The rest of
// the web module is the browser's own OAuth client (@atproto/oauth-client-
// browser, built lazily, with its loopback client id and its metadata), which
// the iOS app has no use for: it signs in only through Virga's server.
// session.oauth holds both functions to the web's, word for word.

import Foundation
import VirgaCore

public enum OAuthClient {
  /// `signInErrorMessage(err)`: a sign-in that couldn't start (the handle
  /// didn't resolve, the host didn't answer), in words a visitor can act on.
  /// A sign-in through Virga's server fails with the server's `code`, which
  /// is read first.
  public static func signInErrorMessage(_ error: (any Error)?) -> String {
    signInErrorMessage(JSErrorFields(error))
  }

  public static func signInErrorMessage(_ err: JSErrorFields?) -> String {
    let code = err?.code?.stringValue
    if code == "HANDLE_NOT_FOUND" {
      return "Couldn’t find that account. Check the handle (it looks like you.bsky.social), or paste your DID."
    }
    if code == "AUTHORIZE_FAILED" {
      return "Found the account, but its host isn’t accepting sign-ins from here right now."
    }
    // `code == null`: no code that is a string.
    if code == "VIRGA_CLIENT_UNAVAILABLE" || (code == nil && err?.status == 503) {
      return "Virga’s server isn’t taking sign-ins right now. Try again in a little while."
    }
    if code == "NETWORK_ERROR" {
      return "Couldn’t reach Virga’s server. Check your connection and try again."
    }
    if code == "RATE_LIMITED" {
      return "Too many sign-ins were started from here in the last minute. Wait a minute and try again."
    }
    if code == "REDIRECT_NOT_ALLOWED" {
      return "Virga’s server doesn’t take sign-ins from this address. Long sessions work from Virga’s own site."
    }
    let message = (err?.message ?? "").units.map(Unit.asciiLower)
    if has(message, "redirect_uri") || has(message, "allowed frontend") {
      return "Virga’s server doesn’t take sign-ins from this address. Long sessions work from Virga’s own site."
    }
    // /resolve identity|invalid (handle|did)|handle must be/i
    if has(message, "resolve identity") || has(message, "invalid handle") || has(message, "invalid did") || has(message, "handle must be") {
      return "Couldn’t find that account. Check the handle (it looks like you.bsky.social), or paste your DID."
    }
    // /resolve oauth server metadata|not protected by issuer|does not support/i
    if has(message, "resolve oauth server metadata") || has(message, "not protected by issuer") || has(message, "does not support") {
      return "Found the account, but its host isn’t accepting sign-ins from here right now."
    }
    // A server that doesn't know the permissions this app asks for answers
    // the request with invalid_scope. Older PDS software is the usual reason.
    if has(message, "scope") {
      return "Found the account, but its host didn’t accept the permissions Virga asks for. It may be running older software."
    }
    if err?.name == "TypeError" && (has(message, "fetch") || has(message, "network") || has(message, "load failed")) {
      return "Couldn’t reach the account’s host. Check your connection and try again."
    }
    return "Sign-in couldn’t start. Check the handle and try again."
  }

  /// `callbackErrorMessage(err)`: a sign-in that came back without a
  /// session (declined, or a return that couldn't be matched to the request
  /// that started it). The code is in `err.params`.
  public static func callbackErrorMessage(_ error: (any Error)?) -> String {
    callbackErrorMessage(code: JSErrorFields(error)?.params?["error"])
  }

  public static func callbackErrorMessage(code: String?) -> String {
    switch code {
    case "access_denied":
      return "Access wasn’t granted, so you’re not signed in."
    case "unexpected_return":
      return "That sign-in wasn’t started from this tab, so Virga ignored it. Nothing was changed."
    case "invalid_scope":
      return "The account’s host didn’t accept the permissions Virga asks for, so you’re not signed in."
    case "VIRGA_CLIENT_UNAVAILABLE":
      return "Virga’s server isn’t taking sign-ins right now, so you’re not signed in. Try again in a little while."
    default:
      return "Sign-in didn’t finish, so you’re not signed in. Nothing was changed."
    }
  }

  /// Whether `text` (ASCII case folded) contains `word`: a case-insensitive
  /// regex of plain words, as the web's `/…/i` tests read without the `u` flag.
  static func has(_ text: [UInt16], _ word: String) -> Bool {
    let w = Array(word.utf16)
    guard !w.isEmpty, w.count <= text.count else { return w.isEmpty }
    for i in 0...(text.count - w.count) where Array(text[i..<(i + w.count)]) == w { return true }
    return false
  }
}
