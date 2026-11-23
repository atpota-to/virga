// Time to finish a send once the app has left the screen.
//
// A browser tab sent to the background keeps sending, and the web's
// composer counts on that (page hide only flushes the autosave). iOS
// suspends an app within seconds of leaving the screen, and a request in
// flight then stalls and fails on return, so each send (a post, a
// scheduled post, a draft, a video's upload; Drafts' and Scheduled posts'
// Post now and Schedule) asks for background time while it runs and gives
// it back when it ends, or when that time runs out.

#if canImport(UIKit)
import UIKit

@MainActor
final class BackgroundSend {
  private var id: UIBackgroundTaskIdentifier = .invalid

  /// Asks iOS for time to finish `name` should the app leave the screen.
  init(_ name: String) {
    id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
      // The time is up (iOS calls this on the main thread): what's left is
      // suspended with the app.
      MainActor.assumeIsolated {
        guard let self else { return }
        self.end()
      }
    }
  }

  /// Gives the time back, once.
  func end() {
    guard id != .invalid else { return }
    UIApplication.shared.endBackgroundTask(id)
    id = .invalid
  }
}
#endif
