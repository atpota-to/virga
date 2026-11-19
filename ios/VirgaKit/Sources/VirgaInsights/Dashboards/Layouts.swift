// Ports src/dashboards/layouts.js
//
// Dashboards: each a named, ordered set of report cards, each card a widget
// type at a size. Pure functions over a value, so every change is a new
// value that can be saved, compared and undone; the model that keeps the
// current one per account (the web's DashboardsContext.jsx) writes it to
// the key-value store.
//
//   layout     { version, dashboards: [dashboard] }
//   dashboard  { id, name, template, widgets: [card] }
//   card       { id, type, size, options? }   size: "xs" | "s" | "m" | "l" | "xl"
//
// A card's `options` are its own settings, present only when it has any: a
// title, a period of its own instead of the dashboard's, the kind of
// engagement it counts, and how many rows a list shows. Which of these a
// card takes is its type's to say (`WidgetDef.options`).
//
// The sizes are spans of a twelve-column grid: xs 3, s 4, m 6, l 8, xl 12.
// Customize names them by what they are, a share of the row (¼ ⅓ ½ ⅔ Full),
// rather than by a letter. On a phone every card is full width; the order
// is the same everywhere.
//
// Ids come from `newId`, which every function that makes one takes as a
// parameter (the shared LayoutIDGenerator by default), so tests and the
// parity fixtures (ios/parity/cases/insights-early.layouts.js) get the
// web's ids exactly.
//
// Where the web looks a type or a template up in a plain object, names
// Object.prototype carries ("constructor", "toString") count as found
// there; here only the tables' own keys do. And where the web would throw
// (resetting a dashboard whose template no table has, which only a layout
// made by hand can name), this resets it to the cards it was made with,
// the overview's, as dashboardFromTemplate made them.

import Foundation
import VirgaCore

// MARK: - Shapes

/// A card size: its span of the twelve-column grid, the share of the row
/// Customize shows, and that share in words.
public struct CardSize: Codable, Hashable, Sendable {
  public var cols: Int
  public var label: String
  public var name: String
  public init(cols: Int, label: String, name: String) {
    self.cols = cols
    self.label = label
    self.name = name
  }
}

/// A card a template starts with. Written as the web writes it, `[type, size]`.
public struct TemplateCard: Codable, Hashable, Sendable {
  public var type: String
  public var size: String
  public init(_ type: String, _ size: String) {
    self.type = type
    self.size = size
  }

  public init(from decoder: Decoder) throws {
    var c = try decoder.unkeyedContainer()
    type = try c.decode(String.self)
    size = try c.decode(String.self)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.unkeyedContainer()
    try c.encode(type)
    try c.encode(size)
  }
}

/// A dashboard a new account starts with.
public struct DashboardTemplate: Codable, Hashable, Sendable {
  public var name: String
  public var widgets: [TemplateCard]
  public init(name: String, widgets: [TemplateCard]) {
    self.name = name
    self.widgets = widgets
  }
}

/// A card's own settings. Only what its type takes is ever kept
/// (`Layouts.cleanOptions`), and a card with none has nil, not an empty one.
public struct CardOptions: Codable, Hashable, Sendable {
  public var title: String?
  /// One of `Layouts.cardPeriods`.
  public var period: String?
  /// One of `Layouts.cardKinds`.
  public var kind: String?
  /// One of `Layouts.cardRows`.
  public var rows: Int?

  public init(title: String? = nil, period: String? = nil, kind: String? = nil, rows: Int? = nil) {
    self.title = title
    self.period = period
    self.kind = kind
    self.rows = rows
  }

  public var isEmpty: Bool { title == nil && period == nil && kind == nil && rows == nil }

  /// These options as the raw value `setWidgetOptions` and `cleanOptions` read.
  public var jsonValue: JSONValue {
    var object: [String: JSONValue] = [:]
    if let title { object["title"] = .string(title) }
    if let period { object["period"] = .string(period) }
    if let kind { object["kind"] = .string(kind) }
    if let rows { object["rows"] = .number(Double(rows)) }
    return .object(object)
  }
}

/// A card on a dashboard.
public struct DashboardCard: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  /// A `WidgetDef.type`.
  public var type: String
  /// A key of `Layouts.sizes`.
  public var size: String
  public var options: CardOptions?

  public init(id: String, type: String, size: String, options: CardOptions? = nil) {
    self.id = id
    self.type = type
    self.size = size
    self.options = options
  }
}

/// A named, ordered set of cards.
public struct Dashboard: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var name: String
  /// The template it was made from (a key of `Layouts.templates`), which
  /// resetting it goes back to; nil for one made empty or as a copy.
  public var template: String?
  public var widgets: [DashboardCard]

  public init(id: String, name: String, template: String? = nil, widgets: [DashboardCard] = []) {
    self.id = id
    self.name = name
    self.template = template
    self.widgets = widgets
  }

  enum CodingKeys: String, CodingKey { case id, name, template, widgets }

  /// As the web writes it: `template` is always there, null for none.
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(name, forKey: .name)
    try c.encode(template, forKey: .template)
    try c.encode(widgets, forKey: .widgets)
  }
}

/// An account's dashboards.
public struct DashboardLayout: Codable, Hashable, Sendable {
  public var version: Int
  public var dashboards: [Dashboard]
  public init(version: Int = Layouts.layoutVersion, dashboards: [Dashboard]) {
    self.version = version
    self.dashboards = dashboards
  }
}

// MARK: - Ids

/// The web's `newId`: a prefix, the clock in base 36, a counter that wraps
/// at 1296, and a random number under 1296 in base 36. Unique enough within
/// one device's layouts. The clock and the random number are injected, so a
/// test (or the parity fixtures) can make the ids it gets exact.
public final class LayoutIDGenerator: Sendable {
  private let counter = Locked(0)
  private let now: @Sendable () -> Double
  private let random: @Sendable () -> Double

  /// - Parameters:
  ///   - now: epoch milliseconds, as `Date.now()`.
  ///   - random: a number in [0, 1), as `Math.random()`.
  public init(
    now: @escaping @Sendable () -> Double = { (Date().timeIntervalSince1970 * 1000).rounded(.down) },
    random: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) }
  ) {
    self.now = now
    self.random = random
  }

  /// The one the layout functions use unless given another (the web's
  /// module-level counter).
  public static let shared = LayoutIDGenerator()

  public func newId(_ prefix: String = "w") -> String {
    let count = counter.withLock { value -> Int in
      value = (value + 1) % 1296
      return value
    }
    return Self.format(prefix: prefix, now: now(), counter: count, random: random())
  }

  /// An id from its parts.
  public static func format(prefix: String, now: Double, counter: Int, random: Double) -> String {
    let clock = String(Int64(now), radix: 36)
    let tail = String(Int((random * 1296).rounded(.down)), radix: 36)
    return "\(prefix)\(clock)\(String(counter, radix: 36))\(tail)"
  }
}

// MARK: - Layouts

public enum Layouts {
  public static let layoutVersion = 1

  /// The sizes by key; `sizeKeys` is their order, smallest first.
  public static let sizes: [String: CardSize] = [
    "xs": CardSize(cols: 3, label: "¼", name: "A quarter of the row"),
    "s": CardSize(cols: 4, label: "⅓", name: "A third of the row"),
    "m": CardSize(cols: 6, label: "½", name: "Half the row"),
    "l": CardSize(cols: 8, label: "⅔", name: "Two thirds of the row"),
    "xl": CardSize(cols: 12, label: "Full", name: "The full row"),
  ]
  public static let sizeKeys = ["xs", "s", "m", "l", "xl"]

  /// The dashboards a new account starts with, by key; `templateKeys` is
  /// their order. Types are `Catalog.widgets` keys.
  public static let templates: [String: DashboardTemplate] = [
    "overview": DashboardTemplate(
      name: "Overview",
      widgets: [
        TemplateCard("stat-followers", "xs"),
        TemplateCard("stat-new-followers", "xs"),
        TemplateCard("stat-engagement", "xs"),
        TemplateCard("stat-posts", "xs"),
        TemplateCard("follower-growth", "l"),
        TemplateCard("engagement-by-type", "s"),
        TemplateCard("top-posts", "m"),
        TemplateCard("top-engagers", "m"),
        TemplateCard("best-time", "m"),
        TemplateCard("repo-collections", "m"),
      ]),
    "growth": DashboardTemplate(
      name: "Growth",
      widgets: [
        TemplateCard("stat-followers", "xs"),
        TemplateCard("stat-new-followers", "xs"),
        TemplateCard("stat-unfollows", "xs"),
        TemplateCard("stat-blocks", "xs"),
        TemplateCard("new-followers", "l"),
        TemplateCard("unfollows", "s"),
        TemplateCard("newest-followers", "m"),
        TemplateCard("follow-back", "m"),
        TemplateCard("blocks-over-time", "m"),
        TemplateCard("lists-on", "m"),
      ]),
    "content": DashboardTemplate(
      name: "Content",
      widgets: [
        TemplateCard("stat-posts", "xs"),
        TemplateCard("stat-engagement", "xs"),
        TemplateCard("stat-per-post", "xs"),
        TemplateCard("stat-given", "xs"),
        TemplateCard("posting-cadence", "m"),
        TemplateCard("engagement-over-time", "m"),
        TemplateCard("engagement-rate", "m"),
        TemplateCard("best-time", "m"),
        TemplateCard("top-posts", "xl"),
      ]),
  ]
  public static let templateKeys = ["overview", "growth", "content"]

  /// The periods a card can keep for itself. A custom range belongs to the dashboard.
  public static let cardPeriods = ["7d", "30d", "90d", "1y", "all"]
  /// The kinds of engagement a card can be narrowed to.
  public static let cardKinds = ["like", "repost", "reply", "quote"]
  /// How many rows a list can be set to show, instead of what fits its size.
  public static let cardRows = [3, 5, 8, 10, 15, 20]
  public static let cardTitleMax = 60

  /// The longest a dashboard's name can be.
  static let nameMax = 60

  /// A card's options, checked against what its type takes: anything the
  /// type doesn't take, or a value this version doesn't know, is dropped.
  /// Nil when nothing is left, so a card with no settings stores none.
  /// `raw` is whatever was stored or asked for.
  public static func cleanOptions(_ raw: JSONValue?, _ def: WidgetRules?) -> CardOptions? {
    guard case .object(let object)? = raw else { return nil }
    let takes = def?.options ?? []
    var out = CardOptions()
    if takes.contains("title"), case .string(let title)? = object["title"] {
      let trimmed = title.jsTrimmed()
      if !trimmed.isEmpty { out.title = trimmed.jsSlice(0, cardTitleMax) }
    }
    if takes.contains("period"), case .string(let period)? = object["period"], cardPeriods.contains(period) {
      out.period = period
    }
    if takes.contains("kind"), case .string(let kind)? = object["kind"], cardKinds.contains(kind) {
      out.kind = kind
    }
    if takes.contains("rows"), case .number(let rows)? = object["rows"],
      let known = cardRows.first(where: { Double($0) == rows })
    {
      out.rows = known
    }
    return out.isEmpty ? nil : out
  }

  /// `card` with `options` in place of its own (none when nil).
  static func withOptions(_ card: DashboardCard, _ options: CardOptions?) -> DashboardCard {
    var card = card
    card.options = options
    return card
  }

  /// A short id from the shared generator.
  public static func newId(_ prefix: String = "w") -> String {
    LayoutIDGenerator.shared.newId(prefix)
  }

  static func cardsFrom(_ pairs: [TemplateCard], newId: (String) -> String) -> [DashboardCard] {
    pairs.map { DashboardCard(id: newId("w"), type: $0.type, size: $0.size) }
  }

  /// The template a key names, or the overview for a key no table has.
  static func template(_ key: String?) -> DashboardTemplate {
    key.flatMap { templates[$0] } ?? templates["overview"]!
  }

  /// A dashboard as a template starts it: its id is `id`, or the key; its
  /// name `name`, or the template's. A key that names no template gets the
  /// overview's cards (and still records the key it was given).
  public static func dashboardFromTemplate(
    _ key: String, id: String? = nil, name: String? = nil, newId: (String) -> String = Layouts.newId
  ) -> Dashboard {
    let t = template(key)
    return Dashboard(
      id: nonEmpty(id) ?? key,
      name: nonEmpty(name) ?? t.name,
      template: key,
      widgets: cardsFrom(t.widgets, newId: newId)
    )
  }

  /// The dashboards a new account starts with, one per template.
  public static func defaultLayout(newId: (String) -> String = Layouts.newId) -> DashboardLayout {
    DashboardLayout(
      version: layoutVersion,
      dashboards: templateKeys.map { dashboardFromTemplate($0, newId: newId) }
    )
  }

  /// A stored layout, checked: cards of unknown types (from a newer
  /// version, or one since retired) are dropped, sizes outside a type's
  /// range are put back in it, and an empty or unreadable layout becomes
  /// the default. `widgets` is the registry (the library's, unless given).
  public static func sanitizeLayout(
    _ raw: JSONValue?,
    _ widgets: [String: WidgetRules] = Catalog.widgetRules,
    newId: (String) -> String = Layouts.newId
  ) -> DashboardLayout {
    guard case .object(let object)? = raw, case .array(let stored)? = object["dashboards"] else {
      return defaultLayout(newId: newId)
    }
    var seen = Set<String>()
    var dashboards: [Dashboard] = []
    for entry in stored {
      guard case .object(let d) = entry, case .string(let id)? = d["id"], !seen.contains(id) else { continue }
      seen.insert(id)
      var name = "Untitled"
      if case .string(let text)? = d["name"] {
        let trimmed = text.jsTrimmed()
        if !trimmed.isEmpty { name = trimmed.jsSlice(0, nameMax) }
      }
      let template = d["template"]?.stringValue.flatMap { templates[$0] == nil ? nil : $0 }
      var cards: [DashboardCard] = []
      for card in d["widgets"]?.arrayValue ?? [] {
        guard case .object(let w) = card, case .string(let cardId)? = w["id"],
          case .string(let type)? = w["type"], let def = widgets[type]
        else { continue }
        let size = fitSize(w["size"]?.stringValue, def) ?? ""
        cards.append(withOptions(DashboardCard(id: cardId, type: type, size: size), cleanOptions(w["options"], def)))
      }
      dashboards.append(Dashboard(id: id, name: name, template: template, widgets: cards))
    }
    if dashboards.isEmpty { return defaultLayout(newId: newId) }
    return DashboardLayout(version: layoutVersion, dashboards: dashboards)
  }

  /// A size the widget type allows: the one asked for, else its default
  /// (else its first; nil only for a type that allows none and has no
  /// default).
  public static func fitSize(_ size: String?, _ def: WidgetRules?) -> String? {
    let allowed = def?.sizes ?? sizeKeys
    if let size, allowed.contains(size) { return size }
    return nonEmpty(def?.defaultSize) ?? allowed.first
  }

  static func mapDashboard(
    _ layout: DashboardLayout, _ id: String, _ fn: (Dashboard) -> Dashboard
  ) -> DashboardLayout {
    var layout = layout
    layout.dashboards = layout.dashboards.map { $0.id == id ? fn($0) : $0 }
    return layout
  }

  /// A new dashboard at the end: empty, or as `template` starts it. Its id
  /// is `id`, or a new one.
  public static func addDashboard(
    _ layout: DashboardLayout,
    name: String = "New dashboard",
    template: String? = nil,
    id: String? = nil,
    newId: (String) -> String = Layouts.newId
  ) -> (layout: DashboardLayout, id: String) {
    let id = id ?? newId("d")
    let dashboard =
      if let template, !template.isEmpty {
        dashboardFromTemplate(template, id: id, name: name, newId: newId)
      } else {
        Dashboard(id: id, name: name, template: nil, widgets: [])
      }
    var layout = layout
    layout.dashboards.append(dashboard)
    return (layout, id)
  }

  /// A copy of a dashboard, with new card ids, right after it. The id is
  /// nil (and the layout unchanged) when there is no such dashboard.
  public static func duplicateDashboard(
    _ layout: DashboardLayout, _ sourceId: String, id: String? = nil, newId: (String) -> String = Layouts.newId
  ) -> (layout: DashboardLayout, id: String?) {
    let id = id ?? newId("d")
    guard let at = layout.dashboards.firstIndex(where: { $0.id == sourceId }) else { return (layout, nil) }
    let source = layout.dashboards[at]
    let copy = Dashboard(
      id: id,
      name: "\(source.name) copy".jsSlice(0, nameMax),
      template: nil,
      widgets: source.widgets.map { card in
        var card = card
        card.id = newId("w")
        return card
      }
    )
    var layout = layout
    layout.dashboards.insert(copy, at: at + 1)
    return (layout, id)
  }

  /// A new name, trimmed and cut to length; an empty one changes nothing.
  public static func renameDashboard(_ layout: DashboardLayout, _ id: String, _ name: String?) -> DashboardLayout {
    let clean = (name ?? "").jsTrimmed().jsSlice(0, nameMax)
    if clean.isEmpty { return layout }
    return mapDashboard(layout, id) { d in
      var d = d
      d.name = clean
      return d
    }
  }

  /// Remove a dashboard. The last one can't go: there is always somewhere to land.
  public static func deleteDashboard(_ layout: DashboardLayout, _ id: String) -> DashboardLayout {
    if layout.dashboards.count <= 1 { return layout }
    var layout = layout
    layout.dashboards.removeAll { $0.id == id }
    return layout
  }

  /// Move a dashboard to `toIndex` in the order (clamped).
  public static func moveDashboard(_ layout: DashboardLayout, _ id: String, _ toIndex: Int) -> DashboardLayout {
    guard let item = layout.dashboards.first(where: { $0.id == id }) else { return layout }
    var list = layout.dashboards.filter { $0.id != id }
    list.insert(item, at: Swift.max(0, Swift.min(list.count, toIndex)))
    var layout = layout
    layout.dashboards = list
    return layout
  }

  /// Put a dashboard back to the cards it started with (or empty, if it had none).
  public static func resetDashboard(
    _ layout: DashboardLayout, _ id: String, newId: (String) -> String = Layouts.newId
  ) -> DashboardLayout {
    mapDashboard(layout, id) { d in
      var d = d
      d.widgets = nonEmpty(d.template).map { cardsFrom(template($0).widgets, newId: newId) } ?? []
      return d
    }
  }

  /// A new card in a dashboard, at `index` (clamped; the end when nil), at
  /// `size` if its type can take it, else at its type's own.
  public static func addWidget(
    _ layout: DashboardLayout,
    _ dashboardId: String,
    _ type: String,
    _ def: WidgetRules?,
    id: String? = nil,
    index: Int? = nil,
    size: String? = nil,
    newId: (String) -> String = Layouts.newId
  ) -> DashboardLayout {
    let id = id ?? newId("w")
    return mapDashboard(layout, dashboardId) { d in
      let fits = nonEmpty(size).map { def?.sizes?.contains($0) ?? false } ?? false
      let card = DashboardCard(id: id, type: type, size: fits ? size! : nonEmpty(def?.defaultSize) ?? "m")
      var d = d
      let at = index.map { Swift.max(0, Swift.min(d.widgets.count, $0)) } ?? d.widgets.count
      d.widgets.insert(card, at: at)
      return d
    }
  }

  public static func removeWidget(_ layout: DashboardLayout, _ dashboardId: String, _ widgetId: String) -> DashboardLayout {
    mapDashboard(layout, dashboardId) { d in
      var d = d
      d.widgets.removeAll { $0.id == widgetId }
      return d
    }
  }

  /// A card at another size. Not checked against its type: Customize only
  /// offers the ones it takes.
  public static func resizeWidget(
    _ layout: DashboardLayout, _ dashboardId: String, _ widgetId: String, _ size: String
  ) -> DashboardLayout {
    mapDashboard(layout, dashboardId) { d in
      var d = d
      d.widgets = d.widgets.map { w in
        guard w.id == widgetId else { return w }
        var w = w
        w.size = size
        return w
      }
      return d
    }
  }

  /// Set a card's own settings (checked against its type), or clear them
  /// with nothing. `CardOptions.jsonValue` gives typed options in this form.
  public static func setWidgetOptions(
    _ layout: DashboardLayout, _ dashboardId: String, _ widgetId: String, _ options: JSONValue?, _ def: WidgetRules?
  ) -> DashboardLayout {
    mapDashboard(layout, dashboardId) { d in
      var d = d
      d.widgets = d.widgets.map { $0.id == widgetId ? withOptions($0, cleanOptions(options, def)) : $0 }
      return d
    }
  }

  /// Move a card to `toIndex` in its dashboard's order (clamped).
  public static func moveWidget(
    _ layout: DashboardLayout, _ dashboardId: String, _ widgetId: String, _ toIndex: Int
  ) -> DashboardLayout {
    mapDashboard(layout, dashboardId) { d in
      guard let from = d.widgets.firstIndex(where: { $0.id == widgetId }) else { return d }
      var d = d
      let card = d.widgets.remove(at: from)
      d.widgets.insert(card, at: Swift.max(0, Swift.min(d.widgets.count, toIndex)))
      return d
    }
  }

  /// A string the web would take as given (JavaScript truthiness): nil for nil or "".
  static func nonEmpty(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return value
  }
}
