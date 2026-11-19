// The report library, the reports, the tools, what each feature can touch,
// Settings' sections and the radio keys against the web code
// (ios/parity/cases/insights-early.{catalog,registries,settings}.js): whole
// tables, every field, word for word.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct CatalogParity {
  let fixture = "insights-early.catalog"

  @Test func categories() throws {
    expectOutput(encoded(Catalog.categories), try Parity.cases(fixture, fn: "CATEGORIES")[0], strictNulls: true)
  }

  @Test func everyCardWithEveryField() throws {
    expectOutput(encoded(Catalog.widgetList), try Parity.cases(fixture, fn: "WIDGET_LIST")[0], strictNulls: true)
    expectOutput(encoded(Catalog.widgets), try Parity.cases(fixture, fn: "WIDGETS")[0], strictNulls: true)
    expectOutput(
      .array(Catalog.widgetList.map { .string($0.type) }), try Parity.cases(fixture, fn: "WIDGETS.keys")[0])
  }

  @Test func rulesAreTheCardsOwn() {
    for def in Catalog.widgetList {
      #expect(Catalog.widgetRules[def.type] == WidgetRules(sizes: def.sizes, defaultSize: def.defaultSize, options: def.options))
      #expect(def.sizes.contains(def.defaultSize), "\(def.type) starts at a size it takes")
      #expect(Catalog.categories.contains { $0.key == def.category }, "\(def.type) is in a category")
    }
  }
}

@Suite struct RegistriesParity {
  let fixture = "insights-early.registries"

  @Test func reports() throws {
    expectOutput(encoded(ReportsRegistry.reports), try Parity.cases(fixture, fn: "REPORTS")[0], strictNulls: true)
    expectOutput(
      encoded(ReportsRegistry.reportByKey), try Parity.cases(fixture, fn: "REPORT_BY_KEY")[0], strictNulls: true)
  }

  @Test func tools() throws {
    expectOutput(
      encoded(ToolsRegistry.toolSections), try Parity.cases(fixture, fn: "TOOL_SECTIONS")[0], strictNulls: true)
    expectOutput(encoded(ToolsRegistry.tools), try Parity.cases(fixture, fn: "TOOLS")[0], strictNulls: true)
    expectOutput(encoded(ToolsRegistry.toolByKey), try Parity.cases(fixture, fn: "TOOL_BY_KEY")[0], strictNulls: true)
  }

  @Test func access() throws {
    expectOutput(encoded(AccessBadge.access), try Parity.cases(fixture, fn: "ACCESS")[0], strictNulls: true)
    expectOutput(
      .array(AccessBadge.accessKeys.map(JSONValue.string)), try Parity.cases(fixture, fn: "ACCESS.keys")[0])
    #expect(ToolsRegistry.access == AccessBadge.access)
  }

  @Test func everyAccessNamedIsOne() {
    for tool in ToolsRegistry.tools { #expect(AccessBadge.access[tool.access] != nil, "\(tool.key)") }
    for page in PostingRoutes.postingPages {
      for kind in page.access { #expect(AccessBadge.access[kind] != nil, "\(page.key): \(kind)") }
    }
  }
}

@Suite struct SettingsParity {
  let fixture = "insights-early.settings"

  @Test func sections() throws {
    expectOutput(encoded(SettingsSections.sections), try Parity.cases(fixture, fn: "SECTIONS")[0], strictNulls: true)
  }

  @Test func radioKeyTarget() throws {
    for c in try Parity.cases(fixture, fn: "radioKeyTarget") {
      let actual = RadioKeys.radioKeyTarget(c["key"].stringValue ?? "", c["index"].intValue!, c["count"].intValue!)
      expectOutput(actual.map { .number(Double($0)) } ?? .null, c)
    }
  }
}
