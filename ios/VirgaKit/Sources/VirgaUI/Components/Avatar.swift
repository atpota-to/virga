// Ports src/components/Avatar.jsx
// Ports src/styles/controls.css (.avatar)
//
// Someone's picture, or the first letter of their name on a plain disc when
// they have none (or it can't be drawn). Always decorative: the name is
// beside it. 34 points (24 small, 44 large), a circle; the letter in
// --avatar-ink on --avatar-bg. The demo's faces are SVG, which AsyncImage
// can't decode; DemoPictureView draws them as a browser does.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaDemo

public enum AvatarSize: Sendable {
  case small, medium, large
}

public struct Avatar: View {
  @Environment(\.virgaTheme) private var theme
  private let src: String?
  private let name: String?
  private let size: AvatarSize
  private let side: CGFloat?

  /// - Parameter side: a size of the shell's own (the account button's 30),
  ///   in place of the three.
  public init(src: String?, name: String?, size: AvatarSize = .medium, side: CGFloat? = nil) {
    self.src = src
    self.name = name
    self.size = size
    self.side = side
  }

  /// The first of `names` that is there and not empty, as the web picks
  /// the name a face's letter comes from (`card?.displayName ||
  /// card?.handle || '?'`): Swift's `??` would keep an empty display name,
  /// and the face would be a "?" beside a handle. Nil (a "?") when none is.
  public static func named(_ names: String?...) -> String? {
    for name in names {
      if let name, !name.isEmpty { return name }
    }
    return nil
  }

  /// `String(name || '?').replace(/^@/, '').trim().charAt(0).toUpperCase() || '?'`
  public static func letter(_ name: String?) -> String {
    var text = (name?.isEmpty ?? true) ? "?" : name!
    if text.utf16.first == 0x40 { text = text.jsSlice(1) }
    let first = text.jsTrimmed().jsCharAt(0).jsUppercased()
    return first.isEmpty ? "?" : first
  }

  public var body: some View {
    let diameter: CGFloat
    let fontSize: CGFloat
    switch size {
    case .small:
      diameter = theme.points(ThemeKit.smallAvatarSize)
      fontSize = theme.points(ThemeKit.smallAvatarFontSize)
    case .medium:
      diameter = theme.points(ThemeKit.avatarSize)
      fontSize = theme.points(ThemeKit.avatarFontSize)
    case .large:
      diameter = theme.points(ThemeKit.largeAvatarSize)
      fontSize = theme.points(ThemeKit.largeAvatarFontSize)
    }
    let side = self.side ?? diameter
    // The letter grows with Dynamic Type, but no further than the disc
    // holds: it is decorative (the name is beside it), and the disc is not.
    let letter = min(theme.scaled(self.side == nil ? fontSize : theme.textXs), side * Measure.Avatar.letterShare)
    return ZStack {
      if let picture = src.flatMap(DemoPicture.read) {
        // The demo's faces are SVG, which AsyncImage can't decode: drawn
        // as the browser draws them.
        DemoPictureView(picture: picture)
      } else {
        Circle().fill(theme.avatarBg)
        Text(Self.letter(name))
          .font(theme.font(points: letter, weight: ThemeKit.avatarWeight))
          .foregroundStyle(theme.avatarInk)
        if let src, !src.isEmpty, let url = URL(string: src) {
          AsyncImage(url: url) { phase in
            if let image = phase.image {
              image.resizable().scaledToFill()
            } else {
              Color.clear
            }
          }
        }
      }
    }
    .frame(width: side, height: side)
    .clipShape(Circle())
    .accessibilityHidden(true)
  }
}

#Preview("Avatar") {
  VirgaPreviewHost {
    HStack {
      Avatar(src: nil, name: "Mira Okafor", size: .small)
      Avatar(src: nil, name: "@lab.example.org")
      Avatar(src: nil, name: nil, size: .large)
    }
    .padding()
  }
}
#endif
