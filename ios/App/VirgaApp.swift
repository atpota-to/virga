// The app target: a window with Virga in it. Everything else is VirgaKit.
//
// Launched with `-VirgaDemo YES` (the UI tests and the screenshots do), it
// runs against a made-up world instead of the network, like the web app's
// harness.

import SwiftUI
import VirgaUI

@main
struct VirgaApp: App {
  var body: some Scene {
    WindowGroup {
      VirgaRootView()
    }
  }
}
