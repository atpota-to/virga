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
  @State private var taps = SkyTaps()
  private let label: Label

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
