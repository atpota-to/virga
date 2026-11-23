// Ports src/components/Menu.jsx
// Ports src/styles/controls.css (.menu-list, .menu-item)
//
// A button that opens a short list of actions: the ⋯ every row and
// dashboard has, the account's menu. On iOS it is the system's own Menu,
// which rises from its button as the web's phone menu does and closes on a
// press anywhere else. Within one menu every item has an icon or none does;
// an item may have a hint under it (the system's subtitle); anything that
// deletes is last and in red (`destructive`); a separator starts a new
// group. Items are kept in the order given (menuOrder(.fixed)), so the
// destructive one stays last whichever way the menu opens.
//
//   MoreMenu(label: "More for Growth", items: [
//     .item(MenuItem("Rename", systemImage: "pencil") { … }),
//     .separator,
//     .item(MenuItem("Delete", systemImage: "trash", destructive: true) { … }),
//   ])

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaCore

/// One action in a menu: `{ key, label, hint, icon, tone, onSelect }`.
public struct MenuItem: Identifiable {
  public var key: String
  public var label: String
  public var hint: String?
  public var systemImage: String?
  /// `tone: 'danger'`: an action that can't be taken back.
  public var destructive: Bool
  /// Nil for an item that does nothing (the open account's own row).
  public var action: (() -> Void)?
  public var accessibilityIdentifier: String?

  public var id: String { key }

  public init(
    _ label: String, key: String? = nil, hint: String? = nil, systemImage: String? = nil, destructive: Bool = false,
    accessibilityIdentifier: String? = nil, action: (() -> Void)?
  ) {
    self.key = key ?? label
    self.label = label
    self.hint = hint
    self.systemImage = systemImage
    self.destructive = destructive
    self.action = action
    self.accessibilityIdentifier = accessibilityIdentifier
  }
}

/// An entry: an item, or `{ separator: true }`.
public enum MenuEntry {
  case item(MenuItem)
  case separator
}

/// The groups between separators, empty ones dropped (a separator first,
/// last or twice in a row draws nothing, as the web's filter(Boolean) list
/// never puts two together).
func menuGroups(_ entries: [MenuEntry]) -> [[MenuItem]] {
  var groups: [[MenuItem]] = [[]]
  for entry in entries {
    switch entry {
    case .item(let item): groups[groups.count - 1].append(item)
    case .separator: groups.append([])
    }
  }
  return groups.filter { !$0.isEmpty }
}

/// The list itself, as a native menu's content.
struct MenuContent: View {
  let entries: [MenuEntry]

  var body: some View {
    let groups = menuGroups(entries)
    ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
      Section {
        ForEach(group) { item in
          MenuItemButton(item: item)
        }
      }
    }
  }
}

struct MenuItemButton: View {
  @Environment(\.virgaTheme) private var theme
  let item: MenuItem

  var body: some View {
    Button(role: item.destructive ? .destructive : nil) {
      item.action?()
    } label: {
      // A native menu item reads its first Text as the title, a second as
      // the hint under it (its subtitle), and an Image as its icon. The menu
      // takes only their words and draws them itself: the title in the
      // system's label colour and regular weight where the web has --ink at
      // 500, the hint smaller and in the system's secondary grey where
      // `.menu-item-hint` has --muted, wrapped to the menu's own width, and
      // the icon centred on both lines where the web keeps it on the
      // title's. The secondary style says what the hint is; the menu draws
      // it that way whatever is asked. A hint once seen as blank was most
      // likely a picture taken while the menu was still opening (the shots
      // since the test waits for the menu all show it).
      Text(item.label)
      if let hint = item.hint { Text(hint).foregroundStyle(.secondary) }
      if let image = item.systemImage { icon(image) }
    }
    .accessibilityIdentifier(item.accessibilityIdentifier ?? "menu-\(item.key)")
  }

  /// `.menu-item-icon { color: var(--ink-2) }`, and a danger item's icon in
  /// its words' red. A native menu draws a plain image in the window's tint
  /// (the accent), so the glyph comes already coloured: in --ink-2, or in
  /// the system's red that a destructive item's words take.
  private func icon(_ name: String) -> Image {
    let colour = item.destructive ? UIColor.systemRed : UIColor(theme.ink2)
    if let symbol = UIImage(systemName: name)?.withTintColor(colour, renderingMode: .alwaysOriginal) {
      return Image(uiImage: symbol)
    }
    return Image(systemName: name)
  }
}

/// A menu whose button is drawn by the caller (the account's avatar and
/// name). `label` is the button's accessible name.
public struct VirgaMenu<Label: View>: View {
  private let accessibilityLabel: String
  private let entries: [MenuEntry]
  private let label: Label

  public init(accessibilityLabel: String, entries: [MenuEntry], @ViewBuilder label: () -> Label) {
    self.accessibilityLabel = accessibilityLabel
    self.entries = entries
    self.label = label()
  }

  public var body: some View {
    Menu {
      MenuContent(entries: entries)
    } label: {
      label
    }
    .menuOrder(.fixed)
    .accessibilityLabel(accessibilityLabel)
  }
}

/// The ⋯ for everything a row or a dashboard can do beyond its one visible
/// action: a ghost icon, small in a row and medium on a title's line.
/// `label` names it for VoiceOver ("More for the draft from Tue").
public struct MoreMenu: View {
  @Environment(\.virgaTheme) private var theme
  private let label: String
  private let entries: [MenuEntry]
  private let size: KitSize

  public init(label: String, entries: [MenuEntry], size: KitSize = .small) {
    self.label = label
    self.entries = entries
    self.size = size
  }

  public var body: some View {
    let side = theme.points(ThemeKit.touchGhostIconButtonSize)
    Menu {
      MenuContent(entries: entries)
    } label: {
      // Grown with Dynamic Type, kept inside its 44-point circle.
      Image(systemName: Glyph.more)
        .virgaGlyph(theme.points(ThemeKit.menuItemIconSize), weight: .medium, upTo: side / 2)
        .foregroundStyle(theme.color(ThemeKit.ghostButtonInk))
        .frame(width: side, height: side)
        .contentShape(Circle())
    }
    .menuOrder(.fixed)
    .virgaFocusOutline(Circle())
    .accessibilityLabel(label)
  }
}

#Preview("Menu") {
  VirgaPreviewHost {
    MoreMenu(
      label: "More for Growth",
      entries: [
        .item(MenuItem("Rename…", systemImage: "pencil") {}),
        .item(MenuItem("Move up", systemImage: "arrow.up") {}),
        .separator,
        .item(MenuItem("Delete", systemImage: Glyph.trash, destructive: true) {}),
      ])
    .padding()
  }
}
#endif
