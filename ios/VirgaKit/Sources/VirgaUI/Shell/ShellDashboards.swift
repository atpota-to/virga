// Ports src/dashboards/DashboardsContext.jsx (reading the layout)
// Ports src/shell/Shell.jsx
//
// The open account's dashboards, as the shell lists them: read from the
// key-value store under the web's key once per account, checked against
// the report library (Layouts.sanitizeLayout), or the three starting ones
// when nothing is stored, as DashboardsContext's load() does. The shell
// only reads them (the sidebar's names, the Dashboards tab's address, the
// page's title); arranging them comes with the dashboards' own port, which
// will grow this into the context's model with its writes.

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

  /// Where the Dashboards tab and the sidebar's word go: the one last looked
  /// at, else the first.
  public var homeId: String? {
    if let last, dashboard(last) != nil { return last }
    return dashboards.first?.id
  }
}
#endif
