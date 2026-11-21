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
  let item: MenuItem

  var body: some View {
    Button(role: item.destructive ? .destructive : nil) {
      item.action?()
    } label: {
      // A native menu item reads its first Text as the title, a second as
      // the hint under it, and an Image as its icon.
      Text(item.label)
      if let hint = item.hint { Text(hint) }
      if let image = item.systemImage { Image(systemName: image) }
    }
    .accessibilityIdentifier(item.accessibilityIdentifier ?? "menu-\(item.key)")
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
      Image(systemName: Glyph.more)
        .font(.system(size: theme.points(ThemeKit.menuItemIconSize), weight: .medium))
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
