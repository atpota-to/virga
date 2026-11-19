// Ports src/defense/routes.js
//
// Defense's pages: scanning a post, and the lists it fills and their
// history. The moderator and the shield come later, each a page of its own
// here; the sidebar and the command palette pick them up from this list.
// ios/parity/cases/insights-early.routes.js holds the table to the web's.

import Foundation

/// One of Defense's pages.
public struct DefensePage: Codable, Hashable, Sendable, Identifiable {
  public var key: String
  public var path: String
  public var label: String
  public var title: String
  /// The lucide icon's name; `sfSymbol` is what the views draw.
  public var icon: String
  public var desc: String

  public var id: String { key }
  public var sfSymbol: String { Icons.sfSymbol(lucide: icon) }

  public init(key: String, path: String, label: String, title: String, icon: String, desc: String) {
    self.key = key
    self.path = path
    self.label = label
    self.title = title
    self.icon = icon
    self.desc = desc
  }
}

/// The page an address inside /defense names.
public struct DefenseRoute: Codable, Hashable, Sendable {
  public var key: String
  public init(key: String) { self.key = key }
}

public enum DefenseRoutes {
  public static let defenseBase = "/defense"

  /// The part's icon, wherever the part is named (a lucide name).
  public static let defenseIcon = "ShieldHalf"

  public static let defensePages: [DefensePage] = [
    DefensePage(
      key: "scan",
      path: defenseBase,
      label: "Scan a post",
      title: "Defense",
      icon: "ShieldHalf",
      desc: "Everyone who engaged with a post, sorted by how close each of them is to you."
    ),
    DefensePage(
      key: "lists",
      path: "\(defenseBase)/lists",
      label: "Lists",
      title: "Lists",
      icon: "List",
      desc: "The block and mute lists Defense keeps for you, what is being written to them, and who you keep off them."
    ),
    DefensePage(
      key: "history",
      path: "\(defenseBase)/history",
      label: "History",
      title: "History",
      icon: "RotateCcwClock",
      desc: "Everyone added to or taken off your lists, when and why, and the way to undo it."
    ),
  ]

  public static let defensePageByKey: [String: DefensePage] =
    Dictionary(defensePages.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })

  /// The page an address inside /defense names (its parts, from
  /// `Router.pathParts`), or nil for one it doesn't.
  public static func parseDefenseRoute(_ parts: [String]) -> DefenseRoute? {
    guard parts.first == "defense" else { return nil }
    if parts.count == 1 { return DefenseRoute(key: "scan") }
    if parts.count == 2, parts[1] == "lists" || parts[1] == "history" { return DefenseRoute(key: parts[1]) }
    return nil
  }
}
