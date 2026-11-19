// Ports src/components/AccessBadge.jsx (its ACCESS table; AccessLine is VirgaUI's)
// Ports src/tools/registry.js (which re-exports ACCESS)
//
// What a feature can touch, in a word or two, for the header of a tool or a
// posting page. "read" only reads; "follow" uses the follow permission;
// "post" writes and deletes posts; "server" runs on Virga's server (a long
// session); "ask" would need a permission Virga doesn't ask for today, the
// one that is a warning; "lists" adds people to Defense's lists when the
// owner approves it. How loud each is said is the views' (writing a little
// louder than reading).
//
// The AccessLine component itself (the muted line of these, one after
// another) is a view, VirgaUI's, which draws from this table.
// ios/parity/cases/insights-early.registries.js holds it to the web's.

import Foundation

/// One kind of access.
public struct AccessKind: Codable, Hashable, Sendable {
  public var label: String
  /// "warn" for the one that is a warning, else nil.
  public var tone: String?
  /// The lucide icon's name; `sfSymbol` is what the views draw.
  public var icon: String

  public var sfSymbol: String { Icons.sfSymbol(lucide: icon) }

  public init(label: String, tone: String? = nil, icon: String) {
    self.label = label
    self.tone = tone
    self.icon = icon
  }
}

public enum AccessBadge {
  /// Each kind by key (the web's ACCESS); `accessKeys` is their order.
  public static let access: [String: AccessKind] = [
    "read": AccessKind(label: "Read only", icon: "Eye"),
    "follow": AccessKind(label: "Can follow and unfollow", icon: "UserCheck"),
    "post": AccessKind(label: "Can post and delete posts", icon: "PenLine"),
    "server": AccessKind(label: "Uses Virga’s server", icon: "Server"),
    "lists": AccessKind(label: "Can add people to your lists, when you approve it", icon: "ListPlus"),
    "ask": AccessKind(label: "Would ask for a new permission", tone: "warn", icon: "Lock"),
  ]
  public static let accessKeys = ["read", "follow", "post", "server", "lists", "ask"]
}
