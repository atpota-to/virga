// The sign-in's trip to the account's host, on iOS: VirgaSession's
// WebAuthenticator over ASWebAuthenticationSession.
//
// The session controller opens Virga's server's login address here and
// waits for the browser to come back to `https://<server>/oauth/return…`
// (README.md, Signing in): an https callback, which iOS lets the app catch
// only for an associated domain (the entitlements' applinks:/webcredentials:
// for the server's host, and its apple-app-site-association). The whole
// return address (its fragment carries the session) goes back to the
// controller, which finishes the sign-in.
//
// Ephemeral: each sign-in starts without the host's cookies from an earlier
// one, so adding a second account on the same host signs in as that
// account, not as whoever the host last saw; and iOS doesn't first ask to
// share the browser's cookies with the app.

#if canImport(UIKit)
import AuthenticationServices
import UIKit
import VirgaSession

public final class SystemWebAuthenticator: NSObject, WebAuthenticator, @unchecked Sendable {
  public let ephemeral: Bool

  public init(ephemeral: Bool = true) {
    self.ephemeral = ephemeral
  }

  public func authenticate(url: String, callbackHost: String, callbackPath: String) async throws -> String {
    guard let start = URL(string: url) else { throw WebAuthenticationError.failed("The sign-in address couldn’t be read.") }
    let holder = SessionHolder()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
        DispatchQueue.main.async {
          let session = ASWebAuthenticationSession(url: start, callback: .https(host: callbackHost, path: callbackPath)) { callback, error in
            if let callback {
              continuation.resume(returning: callback.absoluteString)
            } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
              continuation.resume(throwing: WebAuthenticationError.cancelled)
            } else {
              continuation.resume(throwing: WebAuthenticationError.failed(error?.localizedDescription ?? "The sign-in didn’t come back."))
            }
          }
          session.presentationContextProvider = holder
          session.prefersEphemeralWebBrowserSession = self.ephemeral
          holder.session = session
          if !session.start() {
            holder.session = nil
            continuation.resume(throwing: WebAuthenticationError.failed("The sign-in couldn’t be shown."))
          }
        }
      }
    } onCancel: {
      DispatchQueue.main.async { holder.session?.cancel() }
    }
  }
}

/// Keeps the session alive while it is up, and says which window it hangs from.
private final class SessionHolder: NSObject, ASWebAuthenticationPresentationContextProviding, @unchecked Sendable {
  var session: ASWebAuthenticationSession?

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap { $0.windows }
    if let key = windows.first(where: { $0.isKeyWindow }) ?? windows.first { return key }
    if let scene = scenes.first { return ASPresentationAnchor(windowScene: scene) }
    return ASPresentationAnchor()
  }
}
#endif
