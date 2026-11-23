// facets.js, linkShortening.js, inlineLinks.js and tags.js, held to the
// web's output (ios/parity/cases/posting-text.{facets,linkShortening,
// inlineLinks,tags}.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// A resolver from a fixture's table (handle → DID, null, or "$throw"),
/// recording what it was asked.
func tableResolver(_ table: JSONValue?, calls: Locked<[String]>) -> ResolveMention {
  { handle in
    calls.withLock { $0.append(handle) }
    let answer = table?[handle]
    if answer?.stringValue == "$throw" { throw URLError(.notConnectedToInternet) }
    return answer?.stringValue
  }
}

/// One detection as the facets generator runs it: preview or submit, at a
/// pinned instant, over the given cache.
func runDetection(_ input: JSONValue, now: Double, cache: MentionValidationCache) async -> JSONValue {
  let calls = Locked<[String]>([])
  let validated = Set(input["validated"]?.arrayValue?.compactMap(\.stringValue) ?? [])
  let invalidated = Set(input["invalidated"]?.arrayValue?.compactMap(\.stringValue) ?? [])
  let text = input["text"]?.stringValue
  let result: FacetDetection
  if input["mode"]?.stringValue == "submit" {
    result = await Facets.detectFacets(
      text,
      DetectFacetsOptions(
        resolveMention: tableResolver(input["table"], calls: calls), validatedHandles: validated,
        invalidatedHandles: invalidated, validationCache: cache, now: { now }))
  } else {
    result = await Facets.detectAndCreateFacetsOptimized(
      text, true, validated, invalidated, validationCache: cache, now: { now })
  }
  return ["result": json(result), "calls": .array(calls.wrappedValue.sorted().map(JSONValue.string))]
}

@Suite struct FacetsParity {
  static let f = "posting-text.facets"
  static let now = 1_800_000_000_000.0

  @Test func preview() async throws {
    for c in try cases(Self.f, "preview") {
      var input = c.input
      input["mode"] = "preview"
      check(await runDetection(input, now: Self.now, cache: MentionValidationCache()), c)
    }
  }

  @Test func submit() async throws {
    for c in try cases(Self.f, "submit") {
      var input = c.input
      input["mode"] = "submit"
      check(await runDetection(input, now: Self.now, cache: MentionValidationCache()), c)
    }
  }

  /// The validation cache's TTL, step by step on one cache.
  @Test func scenario() async throws {
    for c in try cases(Self.f, "scenario") {
      let cache = MentionValidationCache()
      var results: [JSONValue] = []
      for step in c["steps"].arrayValue ?? [] {
        results.append(await runDetection(step, now: Self.now + (step["at"]?.doubleValue ?? 0), cache: cache))
      }
      check(.array(results), c)
    }
  }

  @Test func theSharedCacheIsUsedByDefault() async {
    let handle = "sharedcache\(UInt32.random(in: 0...UInt32.max)).test"
    _ = await Facets.detectFacets("@\(handle)", DetectFacetsOptions(resolveMention: { _ in "did:plc:shared" }))
    #expect(MentionValidationCache.shared.get(handle)?.did == "did:plc:shared")
    let preview = await Facets.detectAndCreateFacetsOptimized("@\(handle)", true)
    #expect(preview.facets.first?.features == [.mention(did: "did:plc:shared")])
  }
}

@Suite struct LinkShorteningParity {
  static let f = "posting-text.linkShortening"

  @Test func toShortUrl() throws {
    for c in try cases(Self.f, "toShortUrl") {
      check(.string(LinkShortening.toShortUrl(c.string("url") ?? "")), c)
    }
  }

  @Test func findShortenableLinks() throws {
    for c in try cases(Self.f, "findShortenableLinks") {
      check(json(LinkShortening.findShortenableLinks(c.string("text"))), c)
    }
  }

  @Test func shortenPostText() throws {
    for c in try cases(Self.f, "shortenPostText") {
      check(.string(LinkShortening.shortenPostText(c.string("text"))), c)
    }
  }

  @Test func countPostGraphemes() throws {
    for c in try cases(Self.f, "countPostGraphemes") {
      check(.number(Double(LinkShortening.countPostGraphemes(c.string("text")))), c)
    }
  }

  @Test func shortenLinkFacets() throws {
    for c in try cases(Self.f, "shortenLinkFacets") {
      check(json(LinkShortening.shortenLinkFacets(c.string("text"), c["facets"].arrayValue)), c, strictNulls: true)
    }
  }

  @Test func expandLinkFacets() throws {
    for c in try cases(Self.f, "expandLinkFacets") {
      check(json(LinkShortening.expandLinkFacets(c.string("text"), c["facets"].arrayValue)), c, strictNulls: true)
    }
  }

  @Test func roundTrip() throws {
    for c in try cases(Self.f, "roundTrip") {
      let stored = LinkShortening.shortenLinkFacets(c.string("text"), c["facets"].arrayValue)
      check(json(LinkShortening.expandLinkFacets(stored.text, stored.facets)), c, strictNulls: true)
    }
  }

  @Test func typedFacetsSpliceAsTheJSONDoes() throws {
    let url = "https://example.com/a/long/path/to/somewhere"
    let text = "🦋 see \(url) #tag"
    let start = "🦋 see ".utf8.count
    let facets = [
      Facet(byteStart: start, byteEnd: start + url.utf8.count, feature: .link(uri: url)),
      Facet(byteStart: start + url.utf8.count + 1, byteEnd: text.utf8.count, feature: .tag(tag: "tag")),
    ]
    let shortened = LinkShortening.shortenLinkFacets(text, facets)
    #expect(shortened.text == "🦋 see example.com/a/long/path/... #tag")
    #expect(shortened.facets[0].features == [.link(uri: url)])
    let expanded = LinkShortening.expandLinkFacets(shortened.text, shortened.facets)
    #expect(expanded == FacetedText(text: text, facets: facets))
  }
}

@Suite struct InlineLinksParity {
  static let f = "posting-text.inlineLinks"
  static let now = 1_900_000_000_000.0

  @Test func linkDestination() throws {
    for c in try cases(Self.f, "linkDestination") {
      check(json(InlineLinks.linkDestination(c.string("destination"))), c)
    }
  }

  @Test func labelMisleads() throws {
    for c in try cases(Self.f, "labelMisleads") {
      check(.bool(InlineLinks.labelMisleads(c.string("label"), c.string("uri") ?? "")), c)
    }
  }

  @Test func isSingleAddress() throws {
    for c in try cases(Self.f, "isSingleAddress") {
      check(.bool(InlineLinks.isSingleAddress(c.string("text"))), c)
    }
  }

  @Test func findInlineLinks() throws {
    for c in try cases(Self.f, "findInlineLinks") {
      check(json(InlineLinks.findInlineLinks(c.string("text"))), c)
    }
  }

  @Test func collapseInlineLinks() throws {
    for c in try cases(Self.f, "collapseInlineLinks") {
      check(json(InlineLinks.collapseInlineLinks(c.string("text"))), c)
    }
  }

  @Test func applyInlineLinks() async throws {
    for c in try cases(Self.f, "applyInlineLinks") {
      let text = c.string("text") ?? ""
      let detected = await Facets.detectAndCreateFacetsOptimized(
        text, true, validationCache: MentionValidationCache(), now: { Self.now })
      let links = InlineLinks.findInlineLinks(text).map(\.span)
      check(json(InlineLinks.applyInlineLinks(text, links, detected)), c)
    }
  }

  @Test func rangesOutsideTheTextArePassedOver() {
    let facets = [Facet(byteStart: 0, byteEnd: 2, feature: .tag(tag: "x"))]
    let out = InlineLinks.applyInlineLinks(
      "#x", [InlineLinkSpan(start: 0, end: 40, labelStart: 1, labelEnd: 39, uri: "https://a.com")],
      facets: facets, postEmbeds: [], externalLinks: [])
    #expect(out.facets == facets)
  }

  func detect(_ c: ParityCase) async -> ComposerFacetDetection {
    let options =
      c["preview"].boolValue == true
      ? DetectFacetsOptions(skipMentionResolution: true, validationCache: MentionValidationCache(), now: { Self.now })
      : DetectFacetsOptions(
        resolveMention: tableResolver(c["table"], calls: Locked([])), validationCache: MentionValidationCache(),
        now: { Self.now })
    return await InlineLinks.detectComposerFacets(c.string("text"), options)
  }

  @Test func detectComposerFacets() async throws {
    for c in try cases(Self.f, "detectComposerFacets") {
      check(json(await detect(c)), c)
    }
  }

  @Test func composerCountText() throws {
    for c in try cases(Self.f, "composerCountText") {
      check(.string(InlineLinks.composerCountText(c.string("text"))), c)
    }
  }

  @Test func countComposerGraphemes() throws {
    for c in try cases(Self.f, "countComposerGraphemes") {
      check(.number(Double(InlineLinks.countComposerGraphemes(c.string("text")))), c)
    }
  }

  @Test func writtenEqualsCounted() async throws {
    for c in try cases(Self.f, "writtenEqualsCounted") {
      let result = await detect(c)
      let written = LinkShortening.shortenLinkFacets(result.text, result.facets)
      check(["counted": .string(InlineLinks.composerCountText(c.string("text"))), "written": json(written)], c)
      #expect(InlineLinks.composerCountText(c.string("text")) == written.text, "\(c)")
    }
  }

  @Test func composerTextFromRecord() throws {
    for c in try cases(Self.f, "composerTextFromRecord") {
      check(.string(InlineLinks.composerTextFromRecord(c.string("text"), c["facets"].arrayValue)), c)
    }
  }

  @Test func reopenRoundTrip() async throws {
    for c in try cases(Self.f, "reopenRoundTrip") {
      let result = await detect(c)
      let written = LinkShortening.shortenLinkFacets(result.text, result.facets)
      check(.string(InlineLinks.composerTextFromRecord(written.text, written.facets)), c)
    }
  }
}

@Suite struct TagsParity {
  static let f = "posting-text.tags"

  @Test func constants() throws {
    let c = try cases(Self.f, "constants")[0]
    check(
      [
        "MAX_TAGS": .number(Double(Tags.maxTags)), "MAX_TAG_GRAPHEMES": .number(Double(Tags.maxTagGraphemes)),
        "MAX_TAG_BYTES": .number(Double(Tags.maxTagBytes)),
      ], c)
  }

  @Test func normalizeTags() throws {
    for c in try cases(Self.f, "normalizeTags") {
      check(json(Tags.normalizeTags(c.input["input"])), c)
    }
  }

  @Test func formatTags() throws {
    for c in try cases(Self.f, "formatTags") {
      check(.string(Tags.formatTags(c.input["tags"])), c)
    }
  }

  @Test func typedOverloadsAgree() {
    #expect(Tags.normalizeTags(" one, #two ,##three") == ["one", "two", "three"])
    #expect(Tags.normalizeTags(["#a", " b "]) == ["a", "b"])
    #expect(Tags.normalizeTags(nil as String?) == [])
    #expect(Tags.formatTags(["a", "b"]) == "a, b")
  }
}
