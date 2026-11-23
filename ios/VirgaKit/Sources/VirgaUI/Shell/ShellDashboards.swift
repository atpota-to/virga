// Ports src/dashboards/DashboardsContext.jsx
// Ports src/shell/Shell.jsx
//
// The open account's dashboards (DashboardsProvider): read from the
// key-value store under the web's key once per account, checked against
// the report library (Layouts.sanitizeLayout), or the three starting ones
// when nothing is stored, as load() does; every change after that is
// written back under the same key (DashboardLayout's JSON), and a refused
// write keeps the change for this run. The actions are the provider's,
// over VirgaInsights' Layouts and Catalog. The shell reads it for the
// sidebar's names, the Dashboards tab's address and the page's title.

#if canImport(UIKit)
import Foundation
import Observation
import VirgaCore
import VirgaInsights

@MainActor
@Observable
public final class ShellDashboards {
  public private(set) var did: String?
  public private(set) var layout: DashboardLayout
  /// The dashboard last looked at, so the Dashboards tab goes back to it.
  public private(set) var last: String?

  @ObservationIgnored private let store: (any KeyValueStore)?

  public init(store: (any KeyValueStore)?, did: String?) {
    self.store = store
    self.did = did
    self.layout = Self.load(store, did)
  }

  /// `layoutKey(did)`.
  public static func layoutKey(_ did: String) -> String { "virga:dashboards:\(did)" }

  static func load(_ store: (any KeyValueStore)?, _ did: String?) -> DashboardLayout {
    guard let did else { return Layouts.defaultLayout() }
    return Layouts.sanitizeLayout(store?.getJSON(layoutKey(did)))
  }

  public var dashboards: [Dashboard] { layout.dashboards }

  public func dashboard(_ id: String?) -> Dashboard? {
    guard let id else { return nil }
    return dashboards.first { $0.id.jsEquals(id) }
  }

  // MARK: Changes (the provider's actions), each written back at once

  private func apply(_ next: DashboardLayout) {
    layout = next
    guard let did else { return }
    try? store?.setJSON(Self.layoutKey(did), next)
  }

  /// A new dashboard (empty, or from a template); its id.
  @discardableResult
  public func addDashboard(name: String, template: String?) -> String {
    let out = Layouts.addDashboard(layout, name: name, template: template, id: Layouts.newId("d"))
    apply(out.layout)
    return out.id
  }

  /// A copy of a dashboard, right after it; its id, or nil.
  public func duplicateDashboard(_ id: String) -> String? {
    let out = Layouts.duplicateDashboard(layout, id, id: Layouts.newId("d"))
    apply(out.layout)
    return out.id
  }

  public func renameDashboard(_ id: String, _ name: String) { apply(Layouts.renameDashboard(layout, id, name)) }
  public func deleteDashboard(_ id: String) { apply(Layouts.deleteDashboard(layout, id)) }
  public func moveDashboard(_ id: String, to index: Int) { apply(Layouts.moveDashboard(layout, id, index)) }
  public func resetDashboard(_ id: String) { apply(Layouts.resetDashboard(layout, id)) }
  public func resetAll() { apply(Layouts.defaultLayout()) }

  public func addWidget(_ dashboardId: String, _ type: String, index: Int? = nil, size: String? = nil) {
    apply(Layouts.addWidget(layout, dashboardId, type, Catalog.widgetRules[type], index: index, size: size))
  }

  public func removeWidget(_ dashboardId: String, _ widgetId: String) { apply(Layouts.removeWidget(layout, dashboardId, widgetId)) }

  public func resizeWidget(_ dashboardId: String, _ widgetId: String, _ size: String) {
    apply(Layouts.resizeWidget(layout, dashboardId, widgetId, size))
  }

  public func moveWidget(_ dashboardId: String, _ widgetId: String, to index: Int) {
    apply(Layouts.moveWidget(layout, dashboardId, widgetId, index))
  }

  public func setWidgetOptions(_ dashboardId: String, _ widgetId: String, type: String, _ options: JSONValue?) {
    apply(Layouts.setWidgetOptions(layout, dashboardId, widgetId, options, Catalog.widgetRules[type]))
  }

  /// The account changed: its own dashboards.
  public func open(_ did: String?) {
    guard !did.jsEquals(self.did) else { return }
    self.did = did
    layout = Self.load(store, did)
    last = nil
  }

  /// useLastDashboard: remember a dashboard that is there.
  public func visited(_ id: String?) {
    guard let id, dashboard(id) != nil, !Optional(id).jsEquals(last) else { return }
    last = id
  }

  /// Where the tab bar's Dashboards goes: the one last looked at, else the
  /// first. (The sidebar's word goes to the first, Sidebar.jsx's.)
  public var homeId: String? {
    if let last, dashboard(last) != nil { return last }
    return dashboards.first?.id
  }
}
#endif
