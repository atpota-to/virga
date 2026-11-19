// threadSplit.js, held to the web's output
// (ios/parity/cases/posting-text.threadSplit.js), and the properties its own
// tests hold every split to: nothing lost, every post within the limit, and
// splitting the joined posts gives them back.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct ThreadSplitParity {
  static let f = "posting-text.threadSplit"

  static func split(_ c: ParityCase) -> [String] {
    let options = c["options"]
    return ThreadSplit.splitIntoThread(
      c.string("text"),
      limit: options["limit"]?.intValue ?? PostingLimits.maxPostGraphemes,
      numbering: options["numbering"]?.stringValue == "counter" ? .counter : .off,
      maxPosts: options["maxPosts"]?.doubleValue ?? .infinity,
      before: options["before"]?.intValue ?? 0,
      after: options["after"]?.intValue ?? 0)
  }

  @Test func threadNumberingOptions() throws {
    let c = try cases(Self.f, "THREAD_NUMBERING")[0]
    check(json(ThreadSplit.threadNumberingOptions), c)
  }

  @Test func splitIntoThread() throws {
    for c in try cases(Self.f, "splitIntoThread") {
      check(json(Self.split(c)), c)
    }
  }

  /// What the web's tests hold every split to, on the fixtures' texts.
  @Test func splitsAreSoundAndStable() throws {
    for c in try cases(Self.f, "splitIntoThread") where c.id.hasPrefix("random") {
      let posts = Self.split(c)
      let numbering: ThreadNumbering = c["options"]["numbering"]?.stringValue == "counter" ? .counter : .off
      let limit = c["options"]["limit"]?.intValue ?? 300
      let squash = { (s: String) in String(s.unicodeScalars.filter { !JSWhitespace.contains($0) }) }
      let bodies = numbering == .counter ? posts.map { ThreadSplit.stripCounter($0) } : posts
      #expect(squash(bodies.joined()) == squash((c.string("text") ?? "").jsTrimmed()), "\(c)")
      for post in posts {
        #expect(post == post.jsTrimmed(), "\(c)")
        #expect(RichText.utf8Length(InlineLinks.composerCountText(post)) <= PostingLimits.maxPostBytes, "\(c)")
        if numbering == .counter { #expect(InlineLinks.countComposerGraphemes(post) <= 300, "\(c)") }
      }
      let again = ThreadSplit.splitIntoThread(
        ThreadSplit.joinThread(posts, numbering: numbering), limit: limit, numbering: numbering)
      #expect(again == posts, "\(c): not stable")
    }
  }

  @Test func readCounter() throws {
    for c in try cases(Self.f, "readCounter") {
      check(json(ThreadSplit.readCounter(c.string("text"))), c)
    }
  }

  @Test func stripCounter() throws {
    for c in try cases(Self.f, "stripCounter") {
      check(.string(ThreadSplit.stripCounter(c.string("text"))), c)
    }
  }

  @Test func joinThread() throws {
    for c in try cases(Self.f, "joinThread") {
      let numbering: ThreadNumbering = c["options"]["numbering"]?.stringValue == "counter" ? .counter : .off
      check(.string(ThreadSplit.joinThread(c["posts"].arrayValue?.compactMap(\.stringValue), numbering: numbering)), c)
    }
  }

  @Test func threadNumbering() throws {
    for c in try cases(Self.f, "threadNumbering") {
      check(.string(ThreadSplit.threadNumbering(c["texts"].arrayValue?.compactMap(\.stringValue)).rawValue), c)
    }
  }

  @Test func renumberThread() throws {
    for c in try cases(Self.f, "renumberThread") {
      check(json(ThreadSplit.renumberThread(c["texts"].arrayValue?.compactMap(\.stringValue))), c)
    }
  }
}
