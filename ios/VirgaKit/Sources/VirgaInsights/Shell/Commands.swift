// Ports src/shell/commands.js
//
// The command palette's list, without anything a view needs: what there is
// to go to or do right now, and which of it a few typed letters mean. The
// palette view (VirgaUI) draws it and carries a command out.
//
// The list is built from the app's own registries each time it opens (the
// reports, the tools, the posting pages, the settings sections, the
// account's dashboards), so a page added to one of them is in the palette
// without a change here. A command says what to do as data: `go` (an
// address) or `do` (an action's name) with `arg`.
// ios/parity/cases/insights-early.commands.js holds every function here to
// the web's: the whole list in each situation the app can be in, the
// ranking of every query the web's tests type and many more, the groups,
// and the recent list. Ids, groups and DIDs are compared by code units,
// as the web compares them (JSStrings.swift).

import Foundation
import VirgaCore

// From src/legal/version.js; use VirgaSession's once merged
private let termsPath = "/terms"
// From src/legal/version.js; use VirgaSession's once merged
private let privacyPath = "/privacy"

/// One thing the palette can go to or do.
public struct Command: Codable, Hashable, Sendable, Identifiable {
  /// Stable, so it can be remembered (the recent list keeps ids).
  public var id: String
  /// One of `Commands.commandGroups`.
  public var group: String
  public var title: String
  /// A line under the title.
  public var hint: String?
  /// More words it answers to.
  public var keywords: String?
  /// The lucide icon's name, where the registry gives one.
  public var icon: String?
  /// The key that does it from anywhere ("N").
  public var shortcut: String?
  /// Whether it's the one in use (a dashboard, a period, a sky); nil where
  /// that means nothing.
  public var current: Bool?
  /// The address it goes to.
  public var go: String?
  /// The action it does ("newPost", "sync", "customize", "newDashboard",
  /// "period", "sky", "switchAccount"), with `arg`.
  public var `do`: String?
  public var arg: String?

  public init(
    id: String, group: String, title: String, hint: String? = nil, keywords: String? = nil,
    icon: String? = nil, shortcut: String? = nil, current: Bool? = nil, go: String? = nil,
    do action: String? = nil, arg: String? = nil
  ) {
    self.id = id
    self.group = group
    self.title = title
    self.hint = hint
    self.keywords = keywords
    self.icon = icon
    self.shortcut = shortcut
    self.current = current
    self.go = go
    self.do = action
    self.arg = arg
  }

  /// The SF Symbol for its own icon, when it has one.
  public var sfSymbol: String? { icon.map { Icons.sfSymbol(lucide: $0) } }

  enum CodingKeys: String, CodingKey {
    case id, group, title, hint, keywords, icon, shortcut, current, go, `do`, arg
  }

  /// Lenient where the web is: a list built by hand may leave the title or
  /// the group out, which matches as an empty one does.
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    group = try c.decodeIfPresent(String.self, forKey: .group) ?? ""
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    hint = try c.decodeIfPresent(String.self, forKey: .hint)
    keywords = try c.decodeIfPresent(String.self, forKey: .keywords)
    icon = try c.decodeIfPresent(String.self, forKey: .icon)
    shortcut = try c.decodeIfPresent(String.self, forKey: .shortcut)
    current = try c.decodeIfPresent(Bool.self, forKey: .current)
    go = try c.decodeIfPresent(String.self, forKey: .go)
    self.do = try c.decodeIfPresent(String.self, forKey: .do)
    arg = try c.decodeIfPresent(String.self, forKey: .arg)
  }
}

/// A group of the palette's list, as it is shown.
public struct PaletteGroup: Codable, Hashable, Sendable {
  public var group: String
  public var items: [Command]
  public init(group: String, items: [Command]) {
    self.group = group
    self.items = items
  }
}

/// What the palette is built from: the registries, the account's
/// dashboards and accounts, and the state the app is in. Every member may
/// be left out, as on the web.
public struct CommandContext: Codable, Hashable, Sendable {
  public struct DashboardItem: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public init(id: String, name: String) {
      self.id = id
      self.name = name
    }
    public init(_ dashboard: Dashboard) { self.init(id: dashboard.id, name: dashboard.name) }
  }

  public struct ReportItem: Codable, Hashable, Sendable {
    public var key: String
    public var label: String
    public var icon: String?
    public var desc: String?
    public init(key: String, label: String, icon: String? = nil, desc: String? = nil) {
      self.key = key
      self.label = label
      self.icon = icon
      self.desc = desc
    }
    public init(_ report: ReportEntry) {
      self.init(key: report.key, label: report.label, icon: report.icon, desc: report.desc)
    }
  }

  public struct ToolItem: Codable, Hashable, Sendable {
    public var key: String
    public var name: String
    public var icon: String?
    public var desc: String?
    public var planned: Bool?
    public init(key: String, name: String, icon: String? = nil, desc: String? = nil, planned: Bool? = nil) {
      self.key = key
      self.name = name
      self.icon = icon
      self.desc = desc
      self.planned = planned
    }
    public init(_ tool: ToolEntry) {
      self.init(key: tool.key, name: tool.name, icon: tool.icon, desc: tool.desc, planned: tool.planned)
    }
  }

  /// A posting page or one of Defense's.
  public struct PageItem: Codable, Hashable, Sendable {
    public var key: String
    public var path: String
    public var label: String
    public var title: String?
    public var icon: String?
    public var desc: String?
    public init(
      key: String, path: String, label: String, title: String? = nil, icon: String? = nil, desc: String? = nil
    ) {
      self.key = key
      self.path = path
      self.label = label
      self.title = title
      self.icon = icon
      self.desc = desc
    }
    public init(_ page: PostingPage) {
      self.init(key: page.key, path: page.path, label: page.label, title: page.title, icon: page.icon, desc: page.desc)
    }
    public init(_ page: DefensePage) {
      self.init(key: page.key, path: page.path, label: page.label, title: page.title, icon: page.icon, desc: page.desc)
    }
  }

  public struct SectionItem: Codable, Hashable, Sendable {
    public var key: String
    public var label: String
    public init(key: String, label: String) {
      self.key = key
      self.label = label
    }
    public init(_ section: SettingsSection) { self.init(key: section.key, label: section.label) }
  }

  /// A signed-in account. `status` "needsSignIn" is one whose sign-in ended.
  public struct Account: Codable, Hashable, Sendable {
    public var did: String
    public var handle: String?
    public var displayName: String?
    public var status: String?
    public init(did: String, handle: String? = nil, displayName: String? = nil, status: String? = nil) {
      self.did = did
      self.handle = handle
      self.displayName = displayName
      self.status = status
    }
  }

  /// A period the charts can show: the archive's ANALYTICS_PERIODS
  /// (`{ key: "7d", days: 7, label: "7 days" }`, …, `{ key: "all", days:
  /// nil, label: "All time" }`).
  public struct Period: Codable, Hashable, Sendable {
    public var key: String?
    public var days: Double?
    public var label: String?
    public init(key: String?, days: Double?, label: String?) {
      self.key = key
      self.days = days
      self.label = label
    }
  }

  /// The page the shell is on, with the dashboard it resolved.
  public struct Route: Codable, Hashable, Sendable {
    public var section: String?
    public var dashboard: String?
    public init(section: String? = nil, dashboard: String? = nil) {
      self.section = section
      self.dashboard = dashboard
    }
    public init(_ route: AppRoute) { self.init(section: route.section.rawValue, dashboard: route.dashboard) }
  }

  /// Where the archive is: built at all, built all the way, syncing now.
  public struct Archive: Codable, Hashable, Sendable {
    public var built: Bool?
    public var complete: Bool?
    public var syncing: Bool?
    public init(built: Bool? = nil, complete: Bool? = nil, syncing: Bool? = nil) {
      self.built = built
      self.complete = complete
      self.syncing = syncing
    }
  }

  public var dashboards: [DashboardItem]
  public var reports: [ReportItem]
  public var tools: [ToolItem]
  public var postingPages: [PageItem]
  public var defensePages: [PageItem]
  public var settingsSections: [SectionItem]
  public var accounts: [Account]
  public var activeDid: String?
  public var periods: [Period]
  /// The key of the period in use.
  public var period: String?
  /// The sky setting in use: "clock", "dawn", "day", "dusk" or "night".
  public var sky: String?
  public var route: Route
  public var archive: Archive

  public init(
    dashboards: [DashboardItem] = [], reports: [ReportItem] = [], tools: [ToolItem] = [],
    postingPages: [PageItem] = [], defensePages: [PageItem] = [], settingsSections: [SectionItem] = [],
    accounts: [Account] = [], activeDid: String? = nil, periods: [Period] = [], period: String? = nil,
    sky: String? = nil, route: Route = Route(), archive: Archive = Archive()
  ) {
    self.dashboards = dashboards
    self.reports = reports
    self.tools = tools
    self.postingPages = postingPages
    self.defensePages = defensePages
    self.settingsSections = settingsSections
    self.accounts = accounts
    self.activeDid = activeDid
    self.periods = periods
    self.period = period
    self.sky = sky
    self.route = route
    self.archive = archive
  }

  /// The context the palette opens with (CommandPalette.jsx): this
  /// target's registries, Defense's pages only where Defense is on, and the
  /// account's own state. `route` is the shell's, with `dashboard` set to
  /// the dashboard it shows (Shell.jsx passes `dashboard?.id || null`: the
  /// one the address names if there is one, nil otherwise), so "Customize
  /// this dashboard" is offered only on a dashboard that exists.
  public static func app(
    dashboards: [Dashboard], accounts: [Account], activeDid: String?, periods: [Period], period: String?,
    sky: String?, route: AppRoute, archive: Archive, defenseEnabled: Bool
  ) -> CommandContext {
    CommandContext(
      dashboards: dashboards.map(DashboardItem.init),
      reports: ReportsRegistry.reports.map(ReportItem.init),
      tools: ToolsRegistry.tools.map(ToolItem.init),
      postingPages: PostingRoutes.postingPages.map(PageItem.init),
      defensePages: defenseEnabled ? DefenseRoutes.defensePages.map(PageItem.init) : [],
      settingsSections: SettingsSections.sections.map(SectionItem.init),
      accounts: accounts,
      activeDid: activeDid,
      periods: periods,
      period: period,
      sky: sky,
      route: Route(route),
      archive: archive
    )
  }

  enum CodingKeys: String, CodingKey {
    case dashboards, reports, tools, postingPages, defensePages, settingsSections, accounts, activeDid, periods
    case period, sky, route, archive
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    dashboards = try c.decodeIfPresent([DashboardItem].self, forKey: .dashboards) ?? []
    reports = try c.decodeIfPresent([ReportItem].self, forKey: .reports) ?? []
    tools = try c.decodeIfPresent([ToolItem].self, forKey: .tools) ?? []
    postingPages = try c.decodeIfPresent([PageItem].self, forKey: .postingPages) ?? []
    defensePages = try c.decodeIfPresent([PageItem].self, forKey: .defensePages) ?? []
    settingsSections = try c.decodeIfPresent([SectionItem].self, forKey: .settingsSections) ?? []
    accounts = try c.decodeIfPresent([Account].self, forKey: .accounts) ?? []
    activeDid = try c.decodeIfPresent(String.self, forKey: .activeDid)
    periods = try c.decodeIfPresent([Period].self, forKey: .periods) ?? []
    period = try c.decodeIfPresent(String.self, forKey: .period)
    sky = try c.decodeIfPresent(String.self, forKey: .sky)
    route = try c.decodeIfPresent(Route.self, forKey: .route) ?? Route()
    archive = try c.decodeIfPresent(Archive.self, forKey: .archive) ?? Archive()
  }
}

public enum Commands {
  /// The groups, in the order an empty palette lists them.
  public static let commandGroups = [
    "Actions", "Dashboards", "Reports", "Posting", "Tools", "Defense", "Settings", "Period", "Sky", "Accounts",
  ]

  /// What the palette calls what was used last.
  public static let recentGroup = "Recent"
  public static let maxRecent = 8
  static let shownRecent = 4

  // The sky is the theme (VirgaCore's Sky): night is the dark one, so
  // "dark" and "light" find a sky here as well as its own name does.
  static let skies: [(value: String, title: String, keywords: String)] = [
    ("clock", "Sky by the clock", "automatic system time of day"),
    ("dawn", "Dawn sky", "light morning"),
    ("day", "Day sky", "light"),
    ("dusk", "Dusk sky", "light evening"),
    ("night", "Night sky", "dark"),
  ]

  /// "Last 7 days", "Last year", "All time": a period as a command.
  public static func periodTitle(_ period: CommandContext.Period?) -> String {
    guard let period, let days = period.days, days != 0, !days.isNaN else { return "All time" }
    return period.key == "1y" ? "Last year" : "Last \((period.label ?? "").jsLowercased())"
  }

  static func accountTitle(_ account: CommandContext.Account) -> String {
    if let name = account.displayName, !name.isEmpty { return name }
    if let handle = account.handle, !handle.isEmpty { return "@\(handle)" }
    return account.did
  }

  /// Every command there is right now, in the order an empty palette lists
  /// them.
  public static func buildCommands(_ context: CommandContext = CommandContext()) -> [Command] {
    let route = context.route
    let archive = context.archive
    var out: [Command] = []

    out.append(
      Command(
        id: "do:new-post", group: "Actions", title: "New post", keywords: "write compose thread", shortcut: "N",
        do: "newPost"))
    if !(archive.syncing ?? false) {
      let title =
        !(archive.built ?? false) ? "Build your archive" : archive.complete == false ? "Resume the build" : "Sync now"
      out.append(
        Command(id: "do:sync", group: "Actions", title: title, keywords: "sync refresh update archive fetch", do: "sync"))
    }
    let onDashboard =
      route.section == "dashboard" && context.dashboards.contains { route.dashboard.jsEquals($0.id) }
    if onDashboard {
      out.append(
        Command(
          id: "do:customize", group: "Actions", title: "Customize this dashboard",
          keywords: "edit arrange cards add remove", do: "customize"))
    }
    out.append(Command(id: "do:new-dashboard", group: "Actions", title: "New dashboard", keywords: "create add", do: "newDashboard"))

    for d in context.dashboards {
      out.append(
        Command(
          id: "go:/dashboard/\(d.id)", group: "Dashboards", title: d.name,
          current: onDashboard && route.dashboard.jsEquals(d.id), go: "/dashboard/\(d.id)"))
    }

    for r in context.reports {
      out.append(
        Command(
          id: "go:/reports/\(r.key)", group: "Reports", title: r.label, hint: r.desc, icon: r.icon,
          go: "/reports/\(r.key)"))
    }
    if !context.reports.isEmpty {
      out.append(Command(id: "go:/reports", group: "Reports", title: "All reports", go: "/reports"))
    }

    for p in context.postingPages {
      out.append(
        Command(
          id: "go:\(p.path)", group: "Posting", title: p.label, hint: p.desc, keywords: p.title, icon: p.icon, go: p.path))
    }

    let live = context.tools.filter { !($0.planned ?? false) }
    for t in live {
      out.append(
        Command(
          id: "go:/tools/\(t.key)", group: "Tools", title: t.name, hint: t.desc, icon: t.icon, go: "/tools/\(t.key)"))
    }
    if !live.isEmpty { out.append(Command(id: "go:/tools", group: "Tools", title: "All tools", go: "/tools")) }

    for p in context.defensePages {
      out.append(
        Command(
          id: "go:\(p.path)", group: "Defense", title: p.label, hint: p.desc,
          keywords: "\(p.title ?? "undefined") pile-on radar block list moderation", icon: p.icon, go: p.path))
    }

    for s in context.settingsSections {
      out.append(
        Command(
          id: "go:/settings/\(s.key)", group: "Settings", title: s.label, keywords: "settings preferences",
          go: "/settings/\(s.key)"))
    }
    // The two documents an account agrees to have pages of their own,
    // outside Settings; they are listed with it because that is where
    // people look.
    out.append(
      Command(id: "go:\(termsPath)", group: "Settings", title: "Terms of Service", keywords: "legal agreement rules", go: termsPath))
    out.append(
      Command(id: "go:\(privacyPath)", group: "Settings", title: "Privacy Policy", keywords: "legal data kept sent", go: privacyPath))

    for p in context.periods {
      out.append(
        Command(
          id: "period:\(p.key ?? "undefined")", group: "Period", title: periodTitle(p),
          keywords: "period range window charts show",
          current: p.key != nil && p.key.jsEquals(context.period), do: "period", arg: p.key))
    }

    for k in skies {
      out.append(
        Command(
          id: "sky:\(k.value)", group: "Sky", title: k.title,
          keywords: "appearance theme mode colours colors \(k.keywords)",
          current: context.sky.jsEquals(k.value), do: "sky", arg: k.value))
    }

    for a in context.accounts where !context.activeDid.jsEquals(a.did) {
      let hint: String?
      if a.status == "needsSignIn" {
        hint = "Signed out. Opens the sign-in."
      } else if let handle = a.handle, !handle.isEmpty, let name = a.displayName, !name.isEmpty {
        hint = "@\(handle)"
      } else {
        hint = nil
      }
      out.append(
        Command(
          id: "account:\(a.did)", group: "Accounts", title: "Switch to \(accountTitle(a))", hint: hint,
          keywords: "account \(a.handle ?? "")", do: "switchAccount", arg: a.did))
    }

    return out
  }

  // MARK: - Matching

  /// Lower case, accents and apostrophes flattened, so "cafe" finds "Café".
  public static func fold(_ text: String?) -> String {
    var kept = String.UnicodeScalarView()
    for scalar in (text ?? "").decomposedStringWithCanonicalMapping.unicodeScalars {
      if isMark(scalar) { continue }
      if scalar == "\u{2018}" || scalar == "\u{2019}" || scalar == "'" { continue }
      kept.append(scalar)
    }
    return String(kept).jsLowercased()
  }

  /// `\p{M}`.
  static func isMark(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .nonspacingMark, .spacingMark, .enclosingMark: return true
    default: return false
    }
  }

  /// `[\p{L}\p{N}]`.
  static func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
      .decimalNumber, .letterNumber, .otherNumber:
      return true
    default:
      return false
    }
  }

  /// The folded words of a text: its runs of letters and numbers.
  static func wordsOf(_ text: String?) -> [String] {
    var words: [String] = []
    var current = String.UnicodeScalarView()
    for scalar in fold(text).unicodeScalars {
      if isWordScalar(scalar) {
        current.append(scalar)
      } else if !current.isEmpty {
        words.append(String(current))
        current = String.UnicodeScalarView()
      }
    }
    if !current.isEmpty { words.append(String(current)) }
    return words
  }

  /// `a.startsWith(b)`, by code unit.
  static func startsWith(_ text: String, _ prefix: String) -> Bool {
    text.utf16.starts(with: prefix.utf16)
  }

  // The letters of `needle` in order somewhere in `hay`, the closer
  // together the better: 0 when they aren't all there. Positions and gaps
  // count UTF-16 code units, as the web's indexOf does.
  static func scattered(_ needle: String, _ hay: String) -> Int {
    var at = -1
    var gaps = 0
    for ch in needle.unicodeScalars {
      let next = hay.jsIndexOf(String(ch), from: at + 1)
      if next == -1 { return 0 }
      if at != -1 { gaps += next - at - 1 }
      at = next
    }
    // Spread right across the title, they are letters, not the word.
    return gaps > needle.jsLength * 2 ? 0 : Swift.max(1, 20 - gaps)
  }

  /// How well one typed word fits a command, 0 for not at all: the start of
  /// its title, then the start of a word in it, then anywhere in it, then
  /// its group, keywords and hint, then (for three letters or more) the
  /// letters in order with others between, which forgives a missed or
  /// swapped-out key.
  static func wordScore(_ word: String, _ command: Command) -> Int {
    let title = fold(command.title)
    if startsWith(title, word) { return 100 }
    let titleWords = wordsOf(command.title)
    if titleWords.contains(where: { startsWith($0, word) }) { return 80 }
    if title.jsIndexOf(word) != -1 { return 60 }
    if wordsOf(command.group).contains(where: { startsWith($0, word) }) { return 50 }
    if wordsOf(command.keywords).contains(where: { startsWith($0, word) }) { return 45 }
    if wordsOf(command.hint).contains(where: { startsWith($0, word) }) { return 25 }
    if word.jsLength >= 3 { return scattered(word, titleWords.joined()) }
    return 0
  }

  /// The commands a query means, best first. Every typed word has to fit;
  /// among equals, what was used most recently comes first, then the list's
  /// own order. An empty query gives the whole list as it is.
  ///
  /// - Parameter recent: command ids, most recent first.
  public static func rankCommands(_ commands: [Command], _ query: String?, recent: [String] = []) -> [Command] {
    let typed = wordsOf(query)
    if typed.isEmpty { return commands }
    func recency(_ id: String) -> Int? { recent.firstIndex { $0.jsEquals(id) } }
    var entries: [(command: Command, score: Int, order: Int, recency: Int?)] = []
    for (order, command) in commands.enumerated() {
      var score = 0
      var fits = true
      for word in typed {
        let s = wordScore(word, command)
        if s == 0 {
          fits = false
          break
        }
        score += s
      }
      if fits { entries.append((command, score, order, recency(command.id))) }
    }
    entries.sort { a, b in
      if a.score != b.score { return a.score > b.score }
      switch (a.recency, b.recency) {
      case (let x?, let y?) where x != y: return x < y
      case (.some, .none): return true
      case (.none, .some): return false
      default: return a.order < b.order
      }
    }
    return entries.map(\.command)
  }

  /// What the palette lists. With nothing typed: what was used most
  /// recently under "Recent", then every other command under its group.
  /// With a query: the matches, the group of the best match first and each
  /// group's own matches best first.
  public static func paletteGroups(_ commands: [Command], _ query: String?, recent: [String] = []) -> [PaletteGroup] {
    let ranked = rankCommands(commands, query, recent: recent)
    var groups: [PaletteGroup] = []
    func into(_ name: String, _ command: Command) {
      if let at = groups.firstIndex(where: { $0.group.jsEquals(name) }) {
        groups[at].items.append(command)
      } else {
        groups.append(PaletteGroup(group: name, items: [command]))
      }
    }
    let searching = !wordsOf(query).isEmpty
    var shown = Set<JSKey>()
    if !searching {
      for id in recent {
        guard let command = ranked.first(where: { $0.id.jsEquals(id) }), shown.count < shownRecent else { continue }
        shown.insert(JSKey(id))
        into(recentGroup, command)
      }
    }
    for command in ranked where !shown.contains(JSKey(command.id)) { into(command.group, command) }
    return groups
  }

  // MARK: - What was used last

  /// `recent` with `id` at its front, once, and no longer than it is
  /// useful. A nil or empty id adds nothing.
  public static func rememberRecent(_ recent: [String]?, _ id: String?) -> [String] {
    rememberRecent(stored: .array((recent ?? []).map(JSONValue.string)), id)
  }

  /// `rememberRecent` over a list as it was read, keeping only its strings.
  public static func rememberRecent(stored recent: JSONValue?, _ id: String?) -> [String] {
    let list = (recent?.arrayValue ?? []).compactMap(\.stringValue).filter { !id.jsEquals($0) }
    if let id, !id.isEmpty { return Array(([id] + list).prefix(maxRecent)) }
    return Array(list.prefix(maxRecent))
  }

  /// The stored list of recent command ids, or none if it can't be read.
  public static func parseRecent(_ raw: String?) -> [String] {
    let text = (raw ?? "").isEmpty ? "[]" : raw!
    guard case .array(let list)? = try? JSONValue.parse(text) else { return [] }
    return Array(list.compactMap(\.stringValue).prefix(maxRecent))
  }

  // MARK: - Moving through the list

  /// The option a key moves to, as an index into the flat list of `count`
  /// options, or nil when the key isn't one that moves: the arrows wrap,
  /// Home and End go to the ends.
  public static func moveActive(_ key: String, _ index: Int, _ count: Int) -> Int? {
    if count <= 0 { return nil }
    switch key {
    case "ArrowDown": return index < 0 ? 0 : (index + 1) % count
    case "ArrowUp": return index <= 0 ? count - 1 : index - 1
    case "Home": return 0
    case "End": return count - 1
    default: return nil
    }
  }
}
