// The frame every #Preview draws in: a PreferencesModel over an in-memory
// store, set to the sky, accent and contrast asked for, and VirgaThemeRoot
// over it, so a preview resolves its theme exactly as the app does.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// `#Preview { VirgaPreviewHost(sky: .night) { SomeView() } }`
public struct VirgaPreviewHost<Content: View>: View {
  @State private var preferences: PreferencesModel
  private let content: Content

  public init(
    sky: SkyChoice = .day,
    accent: Preferences.Accent = .blue,
    contrast: Preferences.ContrastChoice = .normal,
    density: Preferences.Density = .comfortable,
    @ViewBuilder content: () -> Content
  ) {
    let model = PreferencesModel(store: InMemoryKeyValueStore(), languages: ["en-US"], timeZone: .gmt)
    model.setPrefs {
      $0.sky = sky
      $0.accent = accent
      $0.contrast = contrast
      $0.density = density
    }
    _preferences = State(initialValue: model)
    self.content = content()
  }

  public var body: some View {
    VirgaThemeRoot {
      content
    }
    .environment(preferences)
  }
}
#endif
