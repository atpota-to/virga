// Dashboards as data against the web code
// (ios/parity/cases/insights-early.layouts.js): the constants, the ids, a
// card's options, reading a stored layout back, and every change Customize
// makes, with the web's ids exactly (each case's generator has the
// fixture's clock and random number, and a counter from 0, as the
// generator's newId had).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct LayoutsParity {
  let fixture = "insights-early.layouts"

  /// The fixture's clock and random number, read once.
  static let clock = Result { try Parity.cases("insights-early.layouts", fn: "idClock")[0].output }

  /// A generator as the fixture's: its clock and random number, counter at 0.
  func generator() throws -> LayoutIDGenerator {
    let clock = try Self.clock.get()
    let now = clock["now"]?.doubleValue ?? 0
    let random = clock["random"]?.doubleValue ?? 0
    return LayoutIDGenerator(now: { now }, random: { random })
  }

  func layout(_ c: ParityCase) -> DashboardLayout? {
    decoded(c["layout"], as: DashboardLayout.self, c)
  }

  func rules(_ value: JSONValue, _ c: ParityCase) -> WidgetRules? {
    value.isNull ? nil : decoded(value, as: WidgetRules.self, c)
  }

  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let actual: JSONValue = [
      "LAYOUT_VERSION": .number(Double(Layouts.layoutVersion)),
      "SIZES": encoded(Layouts.sizes),
      "SIZES_KEYS": .array(Layouts.sizeKeys.map(JSONValue.string)),
      "TEMPLATES": encoded(Layouts.templates),
      "TEMPLATES_KEYS": .array(Layouts.templateKeys.map(JSONValue.string)),
      "CARD_PERIODS": .array(Layouts.cardPeriods.map(JSONValue.string)),
      "CARD_KINDS": .array(Layouts.cardKinds.map(JSONValue.string)),
      "CARD_ROWS": .array(Layouts.cardRows.map { .number(Double($0)) }),
      "CARD_TITLE_MAX": .number(Double(Layouts.cardTitleMax)),
    ]
    expectOutput(actual, c, strictNulls: true)
    #expect(Set(Layouts.sizes.keys) == Set(Layouts.sizeKeys))
    #expect(Set(Layouts.templates.keys) == Set(Layouts.templateKeys))
  }

  @Test func newId() throws {
    // Each case is one call in a sequence from a counter of 0: `call` says
    // which, with the clock and random number it saw.
    let now = Locked(0.0)
    let random = Locked(0.0)
    let generator = LayoutIDGenerator(now: { now.wrappedValue }, random: { random.wrappedValue })
    var calls = 0
    for c in try Parity.cases(fixture, fn: "newId") {
      let call = c["call"].intValue!
      now.set(0)
      random.set(0)
      while calls < call - 1 {
        _ = generator.newId("")
        calls += 1
      }
      now.set(c["now"].doubleValue!)
      random.set(c["random"].doubleValue!)
      expectOutput(.string(generator.newId(c["prefix"].stringValue!)), c)
      calls += 1
    }
  }

  @Test func cleanOptions() throws {
    for c in try Parity.cases(fixture, fn: "cleanOptions") {
      let actual = Layouts.cleanOptions(c["raw"], rules(c["def"], c))
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func fitSize() throws {
    for c in try Parity.cases(fixture, fn: "fitSize") {
      let actual = Layouts.fitSize(c["size"].stringValue, rules(c["def"], c))
      expectOutput(actual.map(JSONValue.string) ?? .null, c)
    }
  }

  @Test func dashboardFromTemplate() throws {
    for c in try Parity.cases(fixture, fn: "dashboardFromTemplate") {
      let ids = try generator()
      let actual = Layouts.dashboardFromTemplate(
        c["key"].stringValue!, id: c["options"]["id"]?.stringValue, name: c["options"]["name"]?.stringValue,
        newId: ids.newId)
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func defaultLayout() throws {
    for c in try Parity.cases(fixture, fn: "defaultLayout") {
      let ids = try generator()
      expectOutput(encoded(Layouts.defaultLayout(newId: ids.newId)), c, strictNulls: true)
    }
  }

  @Test func sanitizeLayout() throws {
    for c in try Parity.cases(fixture, fn: "sanitizeLayout") {
      let ids = try generator()
      let registry =
        c["widgets"].isNull ? Catalog.widgetRules : decoded(c["widgets"], as: [String: WidgetRules].self, c) ?? [:]
      let actual = Layouts.sanitizeLayout(c["raw"], registry, newId: ids.newId)
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func addDashboard() throws {
    for c in try Parity.cases(fixture, fn: "addDashboard") {
      guard let layout = layout(c) else { continue }
      let ids = try generator()
      let options = c["options"]
      let (out, id) = Layouts.addDashboard(
        layout, name: options["name"]?.stringValue ?? "New dashboard", template: options["template"]?.stringValue,
        id: options["id"]?.stringValue, newId: ids.newId)
      expectOutput(["layout": encoded(out), "id": .string(id)], c, strictNulls: true)
    }
  }

  @Test func duplicateDashboard() throws {
    for c in try Parity.cases(fixture, fn: "duplicateDashboard") {
      guard let layout = layout(c) else { continue }
      let ids = try generator()
      let (out, id) = Layouts.duplicateDashboard(
        layout, c["sourceId"].stringValue!, id: c["id"].stringValue, newId: ids.newId)
      expectOutput(["layout": encoded(out), "id": id.map(JSONValue.string) ?? .null], c, strictNulls: true)
    }
  }

  @Test func renameDashboard() throws {
    for c in try Parity.cases(fixture, fn: "renameDashboard") {
      guard let layout = layout(c) else { continue }
      let actual = Layouts.renameDashboard(layout, c["id"].stringValue!, c["name"].stringValue)
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func deleteDashboard() throws {
    for c in try Parity.cases(fixture, fn: "deleteDashboard") {
      guard let layout = layout(c) else { continue }
      expectOutput(encoded(Layouts.deleteDashboard(layout, c["id"].stringValue!)), c, strictNulls: true)
    }
  }

  @Test func moveDashboard() throws {
    for c in try Parity.cases(fixture, fn: "moveDashboard") {
      guard let layout = layout(c) else { continue }
      let actual = Layouts.moveDashboard(layout, c["id"].stringValue!, c["toIndex"].intValue!)
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func resetDashboard() throws {
    for c in try Parity.cases(fixture, fn: "resetDashboard") {
      guard let layout = layout(c) else { continue }
      let ids = try generator()
      expectOutput(encoded(Layouts.resetDashboard(layout, c["id"].stringValue!, newId: ids.newId)), c, strictNulls: true)
    }
  }

  @Test func addWidget() throws {
    for c in try Parity.cases(fixture, fn: "addWidget") {
      guard let layout = layout(c) else { continue }
      let ids = try generator()
      let options = c["options"]
      let actual = Layouts.addWidget(
        layout, c["dashboardId"].stringValue!, c["type"].stringValue!, rules(c["def"], c),
        id: options["id"]?.stringValue, index: options["index"]?.intValue, size: options["size"]?.stringValue,
        newId: ids.newId)
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func removeWidget() throws {
    for c in try Parity.cases(fixture, fn: "removeWidget") {
      guard let layout = layout(c) else { continue }
      let actual = Layouts.removeWidget(layout, c["dashboardId"].stringValue!, c["widgetId"].stringValue!)
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func resizeWidget() throws {
    for c in try Parity.cases(fixture, fn: "resizeWidget") {
      guard let layout = layout(c) else { continue }
      let actual = Layouts.resizeWidget(
        layout, c["dashboardId"].stringValue!, c["widgetId"].stringValue!, c["size"].stringValue!)
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func setWidgetOptions() throws {
    for c in try Parity.cases(fixture, fn: "setWidgetOptions") {
      guard let layout = layout(c) else { continue }
      let actual = Layouts.setWidgetOptions(
        layout, c["dashboardId"].stringValue!, c["widgetId"].stringValue!, c["options"], rules(c["def"], c))
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }

  @Test func moveWidget() throws {
    for c in try Parity.cases(fixture, fn: "moveWidget") {
      guard let layout = layout(c) else { continue }
      let actual = Layouts.moveWidget(
        layout, c["dashboardId"].stringValue!, c["widgetId"].stringValue!, c["toIndex"].intValue!)
      expectOutput(encoded(actual), c, strictNulls: true)
    }
  }
}

/// What the fixtures can't show: the web's own tests' claims that hold for
/// any ids, and where the port deliberately does what the web means rather
/// than what a plain-object lookup does.
@Suite struct LayoutsBehaviour {
  @Test func defaultCardsAreAllInTheLibraryAtSizesTheyTake() {
    let layout = Layouts.defaultLayout()
    #expect(layout.dashboards.map(\.id) == ["overview", "growth", "content"])
    for d in layout.dashboards {
      for w in d.widgets {
        #expect(Catalog.widgets[w.type]?.sizes.contains(w.size) == true, "\(w.type) at \(w.size)")
      }
    }
    let allIds = layout.dashboards.flatMap { $0.widgets.map(\.id) }
    #expect(Set(allIds).count == allIds.count, "every card has its own id")
  }

  @Test func sharedGeneratorMakesDistinctIds() {
    let made = (0..<500).map { _ in Layouts.newId("w") }
    #expect(made.allSatisfy { $0.hasPrefix("w") })
    #expect(Set(made).count == made.count)
  }

  @Test func counterWrapsAt1296() {
    let generator = LayoutIDGenerator(now: { 0 }, random: { 0 })
    let first = generator.newId("")
    #expect(first == "010")
    for _ in 0..<1293 { _ = generator.newId("") }
    #expect(generator.newId("") == "0zz0")  // 1295
    #expect(generator.newId("") == "000")  // wraps to 0
    #expect(generator.newId("") == "010")
  }

  @Test func inheritedNamesAreNoTypeOrTemplate() {
    let raw: JSONValue = [
      "dashboards": [
        [
          "id": "a", "name": "A", "template": "constructor",
          "widgets": [["id": "1", "type": "toString", "size": "m"], ["id": "2", "type": "top-posts", "size": "m"]],
        ]
      ]
    ]
    let layout = Layouts.sanitizeLayout(raw)
    #expect(layout.dashboards[0].template == nil)
    #expect(layout.dashboards[0].widgets.map(\.type) == ["top-posts"])
  }

  @Test func resetWithATemplateNoTableHasGoesBackToTheCardsItWasMadeWith() {
    let ids = LayoutIDGenerator(now: { 0 }, random: { 0 })
    let (made, id) = Layouts.addDashboard(DashboardLayout(dashboards: []), template: "nope", newId: ids.newId)
    let dashboard = made.dashboards[0]
    #expect(dashboard.template == "nope")
    #expect(dashboard.widgets.map(\.type) == Layouts.templates["overview"]!.widgets.map(\.type))
    let reset = Layouts.resetDashboard(made, id, newId: ids.newId)
    #expect(reset.dashboards[0].widgets.map(\.type) == dashboard.widgets.map(\.type))
  }

  @Test func optionsRoundTripThroughTheirJSON() {
    let options = CardOptions(title: "Mine", period: "7d", kind: "like", rows: 10)
    let all = WidgetRules(options: ["title", "period", "kind", "rows"])
    #expect(Layouts.cleanOptions(options.jsonValue, all) == options)
    #expect(Layouts.cleanOptions(CardOptions().jsonValue, all) == nil)
  }

  @Test func storedLayoutReadsBackAsItWasWritten() throws {
    let base = Layouts.defaultLayout()
    let layout = Layouts.setWidgetOptions(
      base, "overview", base.dashboards[0].widgets[0].id, ["title": "x"], Catalog.widgetRules["stat-followers"])
    #expect(layout.dashboards[0].widgets[0].options == CardOptions(title: "x"))
    let stored = try JSONValue(encoding: layout)
    #expect(Layouts.sanitizeLayout(stored) == layout)
  }
}
