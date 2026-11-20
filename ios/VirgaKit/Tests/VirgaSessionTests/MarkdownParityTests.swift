// src/legal/markdown.js against session.markdown: both real documents and
// the reader's edge cases.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaSession

private let fixture = "session.markdown"

@Suite struct MarkdownParity {
  @Test func parseMarkdown() throws {
    let documents = ["terms": try Repo.text("TERMS_OF_SERVICE.md"), "privacy": try Repo.text("PRIVACY_POLICY.md")]
    for c in try Parity.cases(fixture, fn: "parseMarkdown") {
      let source = documents[c.id] ?? c["source"].stringValue
      let d = Parity.diff(.of(LegalMarkdown.parseMarkdown(source)), c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.id == "terms" || c.id == "privacy" ? "" : c.input.description): \(d ?? "")")
    }
  }

  @Test func parseInline() throws {
    for c in try Parity.cases(fixture, fn: "parseInline") {
      var problems: [String] = []
      let nodes = LegalMarkdown.parseInline(c["text"].stringValue) { problems.append($0) }
      let actual: JSONValue = [
        "nodes": .of(nodes), "problems": .array(problems.map(JSONValue.string)), "text": .string(LegalMarkdown.inlineText(nodes)),
      ]
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func isSafeHref() throws {
    for c in try Parity.cases(fixture, fn: "isSafeHref") {
      expectParity(.bool(LegalMarkdown.isSafeHref(c["href"].stringValue)), c)
    }
  }

  @Test func slugify() throws {
    for c in try Parity.cases(fixture, fn: "slugify") {
      expectParity(.string(LegalMarkdown.slugify(c["text"].stringValue)), c)
    }
  }

  @Test func outlineOf() throws {
    for c in try Parity.cases(fixture, fn: "outlineOf") {
      let blocks = LegalMarkdown.parseMarkdown(c["source"].stringValue).blocks
      let outline = LegalMarkdown.outlineOf(blocks, level: c["level"].intValue ?? 2)
      expectParity(.of(outline), c)
    }
  }
}
