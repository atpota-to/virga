// The app's glyphs. The web's tables (the routes, the report library, the
// reports, the tools, what each feature can touch) name lucide-react icons;
// their Swift ports carry the same names (each component's displayName, as
// the parity fixtures record them: "CalendarClock", and "Image" for
// ImageIcon), and the views draw the SF Symbol this one table maps each to.
// IconsTests checks every name any insights fixture records is here.
//
// Every symbol exists on iOS 17 and means what the lucide glyph does.

import Foundation

public enum Icons {
  /// lucide displayName → SF Symbol.
  public static let lucideToSFSymbol: [String: String] = [
    // Routes, the report library, reports and tools.
    "Archive": "archivebox",
    "Ban": "nosign",
    "CalendarClock": "calendar.badge.clock",
    "CalendarRange": "calendar",
    "Clock": "clock",
    "Cloud": "cloud",
    "Database": "cylinder.split.1x2",
    "FileText": "doc.text",
    "FingerprintPattern": "touchid",
    "Hash": "number",
    "Heart": "heart",
    "Image": "photo",
    "LayoutTemplate": "rectangle.3.offgrid",
    "Library": "books.vertical",
    "Link2": "link",
    "List": "list.bullet",
    "MessagesSquare": "bubble.left.and.bubble.right",
    "PenLine": "pencil.line",
    "Repeat2": "arrow.2.squarepath",
    "RotateCcwClock": "clock.arrow.circlepath",
    "Ruler": "ruler",
    "Send": "paperplane",
    "Shapes": "square.on.circle",
    "Shield": "shield",
    "ShieldHalf": "shield.lefthalf.filled",
    "SquarePen": "square.and.pencil",
    "Timer": "timer",
    "UserMinus": "person.badge.minus",
    "UserPlus": "person.badge.plus",
    "UserX": "person.crop.circle.badge.xmark",
    "UsersRound": "person.2",
    // What a feature can touch (components/AccessBadge.jsx).
    "Eye": "eye",
    "UserCheck": "person.crop.circle.badge.checkmark",
    "Server": "server.rack",
    "ListPlus": "text.badge.plus",
    "Lock": "lock",
    // The command palette's own (CommandPalette.jsx: a command without an
    // icon gets its kind's, its sky's or its group's).
    "ChartColumn": "chart.bar",
    "Check": "checkmark",
    "LayoutDashboard": "square.grid.2x2",
    "Moon": "moon",
    "Plus": "plus",
    "RefreshCw": "arrow.clockwise",
    "Search": "magnifyingglass",
    "Settings": "gearshape",
    "SlidersHorizontal": "slider.horizontal.3",
    "Sun": "sun.max",
    "Sunrise": "sunrise",
    "Sunset": "sunset",
    "Wrench": "wrench.and.screwdriver",
  ]

  /// What a name falls back to when the table doesn't have it (never, for
  /// the tables in this target: IconsTests says so).
  public static let fallbackSymbol = "square.dashed"

  /// The SF Symbol for a lucide icon's name.
  public static func sfSymbol(lucide name: String) -> String {
    lucideToSFSymbol[name] ?? fallbackSymbol
  }

  /// Whether the table maps `name`.
  public static func hasSymbol(lucide name: String) -> Bool {
    lucideToSFSymbol[name] != nil
  }
}
