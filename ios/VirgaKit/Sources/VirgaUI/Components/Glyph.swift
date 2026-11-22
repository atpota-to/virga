// The glyphs the shell, the sign-in, the accounts and Settings draw
// themselves (the web imports each from lucide-react in the component),
// each as the SF Symbol that means what the lucide glyph does. The tables'
// glyphs (the routes, the reports, the tools, what a feature can touch) are
// VirgaInsights' Icons.sfSymbol(lucide:), which this leaves to it.

#if canImport(UIKit)
import Foundation
import VirgaInsights

public enum Glyph {
  /// X
  public static let close = "xmark"
  /// ChevronRight, ChevronLeft
  public static let chevronRight = "chevron.right"
  public static let chevronLeft = "chevron.left"
  /// ExternalLink
  public static let externalLink = "arrow.up.right.square"
  /// LogOut, LogIn
  public static let signOut = "rectangle.portrait.and.arrow.right"
  public static let signIn = "arrow.forward.circle"
  /// RefreshCw
  public static let refresh = "arrow.clockwise"
  /// Settings
  public static let settings = Icons.sfSymbol(lucide: "Settings")
  /// Timer
  public static let timer = Icons.sfSymbol(lucide: "Timer")
  /// UserPlus, Users
  public static let userPlus = Icons.sfSymbol(lucide: "UserPlus")
  public static let users = "person.2"
  /// Trash2
  public static let trash = "trash"
  /// Info
  public static let info = "info.circle"
  /// MoreHorizontal
  public static let more = "ellipsis"
  /// PanelLeftClose, PanelLeftOpen
  public static let foldSidebar = "sidebar.left"
  /// Search
  public static let search = Icons.sfSymbol(lucide: "Search")
  /// SquarePen: New post.
  public static let newPost = Icons.sfSymbol(lucide: "SquarePen")
  /// KeyRound, Ticket, UserRound, Server (How signing in works)
  public static let key = "key"
  public static let ticket = "ticket"
  public static let person = "person"
  public static let server = Icons.sfSymbol(lucide: "Server")
  /// Check
  public static let check = Icons.sfSymbol(lucide: "Check")
  /// LayoutDashboard, Wrench, Lock (the front page's points)
  public static let dashboards = Icons.sfSymbol(lucide: "LayoutDashboard")
  public static let tools = Icons.sfSymbol(lucide: "Wrench")
  public static let lock = Icons.sfSymbol(lucide: "Lock")
  /// The parts in the sidebar and the tab bar: LayoutDashboard, BarChart3,
  /// Send, Wrench, Settings, and Defense's ShieldHalf.
  public static let reports = Icons.sfSymbol(lucide: "ChartColumn")
  public static let posting = Icons.sfSymbol(lucide: "Send")
  public static let defense = Icons.sfSymbol(lucide: DefenseRoutes.defenseIcon)
  /// The skies: Clock, Sunrise, Sun, Sunset, Moon.
  public static let clock = Icons.sfSymbol(lucide: "Clock")
  public static let dawn = Icons.sfSymbol(lucide: "Sunrise")
  public static let day = Icons.sfSymbol(lucide: "Sun")
  public static let dusk = Icons.sfSymbol(lucide: "Sunset")
  public static let night = Icons.sfSymbol(lucide: "Moon")
  /// A remembered account, in a menu: an account's picture can't be a
  /// native menu item's image, so every account row carries this one.
  public static let account = "person.crop.circle"
  /// The dashboard's: Plus, Pencil, Copy, SlidersHorizontal, ArrowUpRight,
  /// ArrowUp, ArrowDown.
  public static let plus = Icons.sfSymbol(lucide: "Plus")
  public static let rename = "pencil"
  public static let duplicate = "doc.on.doc"
  public static let customize = Icons.sfSymbol(lucide: "SlidersHorizontal")
  public static let openReport = "arrow.up.right"
  public static let moveUp = "arrow.up"
  public static let moveDown = "arrow.down"
  /// Table2: "Show as table".
  public static let table = "tablecells"
  /// Download and RotateCcw: Settings › Data's exports and Rebuild posts.
  public static let download = "arrow.down.to.line"
  public static let rebuild = "arrow.counterclockwise"
  /// CalendarRange: the period picker's Custom.
  public static let calendarRange = Icons.sfSymbol(lucide: "CalendarRange")
  /// The first build's list: Database, UsersRound, ShieldCheck, Heart, Cloud.
  public static let database = Icons.sfSymbol(lucide: "Database")
  public static let followers = Icons.sfSymbol(lucide: "UsersRound")
  public static let shieldCheck = "checkmark.shield"
  public static let heart = Icons.sfSymbol(lucide: "Heart")
  public static let cloud = Icons.sfSymbol(lucide: "Cloud")
}
#endif
