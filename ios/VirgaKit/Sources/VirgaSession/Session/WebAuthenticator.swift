// Ports src/session/sessionController.js (the sign-in's trip, as the app makes it)
//
// The sign-in's trip to the account's host, on iOS.
//
// On the web a sign-in through Virga's server sends the browser to the
// account's authorization server and comes back, as a new page load, to
// `<origin>/oauth/return?n=<nonce>#session=vg_…&did=…`. The app opens the
// same address in ASWebAuthenticationSession and waits for that return
// (an https callback on Virga's own host and the return path), so the
// sign-in finishes without the app being left. VirgaUI implements this with
// ASWebAuthenticationSession; tests stand a fake in.

import Foundation

public protocol WebAuthenticator: Sendable {
  /// Opens `url` and waits for the browser to arrive at
  /// `https://<callbackHost><callbackPath>…`, returning that address whole
  /// (query and fragment included). Throws `WebAuthenticationError.cancelled`
  /// when the person closes the sheet, and stops (throwing) when the
  /// calling task is cancelled.
  func authenticate(url: String, callbackHost: String, callbackPath: String) async throws -> String
}

public enum WebAuthenticationError: Error, Sendable, Hashable, LocalizedError {
  /// The person closed the sheet: the sign-in was called off.
  case cancelled
  /// The sheet couldn't be shown, or came back without an address.
  case failed(String)

  public var errorDescription: String? {
    switch self {
    case .cancelled: return "The sign-in was called off"
    case .failed(let message): return message
    }
  }
}
