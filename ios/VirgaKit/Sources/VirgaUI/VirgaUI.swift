// VirgaUI
//
// The SwiftUI layer: the sky and its theme, the shell (tab bar on a phone,
// sidebar on an iPad), and every screen. Views only bind to the observable
// models in the logic targets; the logic lives there, where it is tested on
// every platform. Built only on Apple platforms (Package.swift).

#if canImport(SwiftUI)
import SwiftUI

/// The app's root view: what VirgaApp puts in its window.
public struct VirgaRootView: View {
  public init() {}

  public var body: some View {
    Text("Virga")
  }
}
#endif
