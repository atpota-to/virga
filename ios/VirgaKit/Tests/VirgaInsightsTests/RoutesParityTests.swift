// The shell's, posting's and Defense's routes against the web code
// (ios/parity/cases/insights-early.routes.js): the tables word for word,
// and every address parsed as the web parses it.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

private let fixture = "insights-early.routes"

@Suite struct RouteTablesParity {
  @Test func sectionTitles() throws {
    let c = try Parity.cases(fixture, fn: "SECTION_TITLE")[0]
    var actual: [String: JSONValue] = [:]
    for (section, title) in ShellRoutes.sectionTitle { actual[section.rawValue] = .string(title) }
    expectOutput(.object(actual), c)
    #expect(Set(ShellRoutes.sectionTitle.keys) == Set(AppRoute.Section.allCases), "every section has a title")
  }

  @Test func postingPages() throws {
    expectOutput(.string(PostingRoutes.postingBase), try Parity.cases(fixture, fn: "POSTING_BASE")[0])
    expectOutput(
      encoded(PostingRoutes.postingPages), try Parity.cases(fixture, fn: "POSTING_PAGES")[0], strictNulls: true)
    expectOutput(
      encoded(PostingRoutes.postingPageByKey), try Parity.cases(fixture, fn: "POSTING_PAGE_BY_KEY")[0],
      strictNulls: true)
  }

  @Test func defensePages() throws {
    expectOutput(.string(DefenseRoutes.defenseBase), try Parity.cases(fixture, fn: "DEFENSE_BASE")[0])
    expectOutput(.string(DefenseRoutes.defenseIcon), try Parity.cases(fixture, fn: "DEFENSE_ICON")[0])
    expectOutput(
      encoded(DefenseRoutes.defensePages), try Parity.cases(fixture, fn: "DEFENSE_PAGES")[0], strictNulls: true)
    expectOutput(
      encoded(DefenseRoutes.defensePageByKey), try Parity.cases(fixture, fn: "DEFENSE_PAGE_BY_KEY")[0],
      strictNulls: true)
  }
}

@Suite struct ShellRoutesParity {
  @Test func parseRoute() throws {
    for c in try Parity.cases(fixture, fn: "parseRoute") {
      let actual = outcome { encoded(try ShellRoutes.parseRoute(c["path"].stringValue)) }
      expectOutput(actual, c, strictNulls: true)
    }
  }

  @Test func needsArchive() throws {
    for c in try Parity.cases(fixture, fn: "needsArchive") {
      guard let route = decoded(c["route"], as: AppRoute.self, c) else { continue }
      expectOutput(.bool(ShellRoutes.needsArchive(route)), c)
    }
  }

  @Test func opensBeforeArchive() throws {
    for c in try Parity.cases(fixture, fn: "opensBeforeArchive") {
      guard let route = decoded(c["route"], as: AppRoute.self, c) else { continue }
      expectOutput(.bool(ShellRoutes.opensBeforeArchive(route)), c)
    }
  }

  @Test func parentOf() throws {
    for c in try Parity.cases(fixture, fn: "parentOf") {
      let route = c["route"].isNull ? nil : decoded(c["route"], as: AppRoute.self, c)
      if !c["route"].isNull && route == nil { continue }
      expectOutput(encoded(ShellRoutes.parentOf(route)), c, strictNulls: true)
    }
  }

  @Test func postingTitle() throws {
    for c in try Parity.cases(fixture, fn: "postingTitle") {
      guard let route = decoded(c["route"], as: AppRoute.self, c) else { continue }
      expectOutput(ShellRoutes.postingTitle(route).map(JSONValue.string) ?? .null, c)
    }
  }
}

@Suite struct PostingRoutesParity {
  @Test func postingPath() throws {
    for c in try Parity.cases(fixture, fn: "postingPath") {
      expectOutput(.string(PostingRoutes.postingPath(c["key"].stringValue)), c)
    }
  }

  @Test func parsePostingRoute() throws {
    for c in try Parity.cases(fixture, fn: "parsePostingRoute") {
      let actual: JSONValue
      if case .array = c["path"] {
        actual = encoded(PostingRoutes.parsePostingRoute(parts: strings(c["path"])))
      } else {
        actual = outcome { encoded(try PostingRoutes.parsePostingRoute(c["path"].stringValue)) }
      }
      expectOutput(actual, c, strictNulls: true)
    }
  }

  @Test func parseDefenseRoute() throws {
    for c in try Parity.cases(fixture, fn: "parseDefenseRoute") {
      expectOutput(encoded(DefenseRoutes.parseDefenseRoute(strings(c["parts"]))), c, strictNulls: true)
    }
  }
}

/// Where the web looks a page up in a plain object it also "finds" the
/// names every object inherits ("/posting/constructor" is a posting page
/// there, reported as a web bug). Only the table's own pages are pages here.
@Suite struct RoutesInheritedNames {
  @Test func inheritedNamesNameNoPostingPage() throws {
    for name in ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"] {
      #expect(try ShellRoutes.parseRoute("/posting/\(name)") == .missing, "\(name)")
      #expect(PostingRoutes.postingPath(name) == "/posting")
    }
  }

  @Test func everyPageRoundTrips() throws {
    for page in PostingRoutes.postingPages {
      let route = try ShellRoutes.parseRoute(page.path)
      #expect(route == AppRoute(section: .posting, page: page.key, id: nil))
      #expect(PostingRoutes.postingPath(page.key) == page.path)
    }
    for page in DefenseRoutes.defensePages {
      let route = try ShellRoutes.parseRoute(page.path)
      #expect(route == AppRoute(section: .defense, page: page.key == "scan" ? nil : page.key))
    }
  }
}
