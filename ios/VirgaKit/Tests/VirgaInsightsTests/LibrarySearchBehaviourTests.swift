// The report library's search (DashboardPage.jsx's Library `shown`):
// the trimmed query, lower-cased, as a plain substring of the name or of
// the description, each on its own. The expected lists are what the web's
// filter gives over src/dashboards/catalog.js in Node.

import Testing
import VirgaCore
@testable import VirgaInsights

@Suite struct LibrarySearchBehaviourTests {
  func types(_ query: String, _ category: String = "all") -> [String] {
    Catalog.libraryMatches(query: query, category: category).map(\.type)
  }

  @Test func anEmptyOrBlankQueryKeepsTheWholeKind() {
    let all: [String] = Catalog.widgetList.map(\.type)
    #expect(types("") == all)
    #expect(types("   ") == all)
    let people: [String] = ["top-engagers", "you-engage-with", "follow-back"]
    #expect(types("", "people") == people)
  }

  @Test func theQueryIsTrimmedAndLowerCased() {
    let expected: [String] = [
      "stat-engagement", "stat-per-post", "stat-given", "engagement-over-time", "engagement-rate",
      "engagement-by-type", "engagement-given", "top-posts",
    ]
    #expect(types("  ENGAGEMENT  ") == expected)
  }

  @Test func apostrophesAreNotFolded() {
    // "Followers who engage, that you don’t follow" has a curly apostrophe.
    #expect(types("dont").isEmpty)
    #expect(types("don't").isEmpty)
    #expect(types("don’t") == ["follow-back"])
    #expect(types("lists you're").isEmpty)
    #expect(types("lists you’re") == ["lists-on"])
  }

  @Test func aQueryDoesNotRunFromTheNameIntoTheDescription() {
    // "Followers" / "Everyone following you now"; "A typical post" / "What
    // the middle post of yours earns".
    #expect(types("Followers Everyone").isEmpty)
    #expect(types("post What").isEmpty)
  }

  @Test func theNameOrTheDescriptionMatches() {
    let byDesc: [String] = [
      "stat-typical-post", "engagement-over-time", "engagement-given", "best-time", "content-formats",
      "content-length", "top-tags", "top-links",
    ]
    #expect(types("what") == byDesc)
    let byName: [String] = ["stat-typical-post", "best-time", "content-formats", "content-length"]
    #expect(types("typical") == byName)
    #expect(types("records") == ["repo-activity", "repo-collections"])
    #expect(types("xyz").isEmpty)
  }

  @Test func theKindNarrowsTheMatches() {
    let content: [String] = ["stat-typical-post", "content-formats", "content-length", "top-tags", "top-links"]
    #expect(types("what", "content") == content)
    #expect(types("ENGAGEMENT", "people").isEmpty)
    #expect(types("don’t", "people") == ["follow-back"])
  }
}
