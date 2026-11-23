// Ports src/shell/bits.jsx (useSkyTaps, and the brand's button)
//
// The mark as a button (the app bar's, the sidebar's, the front page's):
// five taps on it, each within a second and a half of the last, turn the
// live sky on, or off again, and a toast says which (VirgaCore's SkyTaps
// counts them and holds the words). Read out as "Virga", as the web's
// aria-label has it.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

struct SkyTapsButton<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences: PreferencesModel?
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  @State private var taps = SkyTaps(windowMs: SkyTapsButton.windowMs)
  private let label: Label

  /// The web's window, or in demo mode the one `-VirgaDemoSkyTapsWindow`
  /// gives (milliseconds): XCTest waits for the app to settle before every
  /// tap, so on a CI iPhone its taps can land further apart than the 1.5
  /// seconds a person's do, and the count would start again.
  static var windowMs: Double {
    let defaults = UserDefaults.standard
    let wider = defaults.double(forKey: "VirgaDemoSkyTapsWindow")
    return defaults.bool(forKey: "VirgaDemo") && wider > 0 ? wider : SkyTaps.window
  }

  init(@ViewBuilder label: () -> Label) {
    self.label = label()
  }

  var body: some View {
    Button(action: tap) {
      label.contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    // `.brand { border-radius: var(--radius-sm) }`
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
    .accessibilityLabel(AppConfig.appName)
    .accessibilityIdentifier("brand")
  }

  private func tap() {
    guard let preferences else { return }
    guard taps.tap(now: Date().timeIntervalSince1970 * 1000) else { return }
    let wasOn = preferences.prefs.liveSky
    preferences.setPref(\.liveSky, !wasOn)
    toasts?.push(SkyTaps.toast(wasOn: wasOn))
  }
}
#endif
