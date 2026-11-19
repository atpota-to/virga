// Every lucide icon any insights fixture records (under an `icon` key, and
// Defense's own) has an SF Symbol, and every table here names only those.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct IconsTests {
  /// Every insights fixture there is (so a later one is checked too).
  static func fixtures() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: Parity.fixturesDirectory.path)
      .filter { $0.hasPrefix("insights") && $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  /// Every string under an `icon` key, anywhere in `value`.
  func icons(in value: JSONValue, into names: inout Set<String>) {
    switch value {
    case .array(let items):
      for item in items { icons(in: item, into: &names) }
    case .object(let members):
      for (key, member) in members {
        if key == "icon", case .string(let name) = member { names.insert(name) } else { icons(in: member, into: &names) }
      }
    default:
      break
    }
  }

  @Test func everyRecordedIconHasASymbol() throws {
    var names = Set<String>()
    let fixtures = try Self.fixtures()
    #expect(fixtures.contains("insights-early.catalog"))
    for name in fixtures {
      for c in try Parity.load(name).cases {
        icons(in: c.input, into: &names)
        icons(in: c.output, into: &names)
      }
    }
    if let defense = try Parity.cases("insights-early.routes", fn: "DEFENSE_ICON")[0].output.stringValue {
      names.insert(defense)
    }
    #expect(names.count > 30, "the fixtures name the tables' icons")
    let missing = names.filter { !Icons.hasSymbol(lucide: $0) }.sorted()
    #expect(missing.isEmpty, "no SF Symbol for \(missing)")
  }

  @Test func everyTableNamesAMappedIcon() {
    var names = Set<String>()
    names.formUnion(PostingRoutes.postingPages.map(\.icon))
    names.formUnion(DefenseRoutes.defensePages.map(\.icon))
    names.insert(DefenseRoutes.defenseIcon)
    names.formUnion(Catalog.widgetList.map(\.icon))
    names.formUnion(ReportsRegistry.reports.map(\.icon))
    names.formUnion(ToolsRegistry.tools.map(\.icon))
    names.formUnion(AccessBadge.access.values.map(\.icon))
    for name in names { #expect(Icons.hasSymbol(lucide: name), "\(name)") }
    #expect(Icons.sfSymbol(lucide: "CalendarClock") == "calendar.badge.clock")
    #expect(Icons.sfSymbol(lucide: "NoSuchIcon") == Icons.fallbackSymbol)
    #expect(PostingRoutes.postingPageByKey["scheduled"]?.sfSymbol == "calendar.badge.clock")
  }
}
