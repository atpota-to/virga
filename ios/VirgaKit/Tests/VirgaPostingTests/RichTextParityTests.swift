// richText.js, mentions.js, hashtags.js, urlMatching.js and postLink.js,
// held to the web's output (ios/parity/cases/posting-text.{richText,
// mentions,hashtags,urlMatching,postLink}.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct RichTextParity {
  static let f = "posting-text.richText"

  @Test func createByteMap() throws {
    for c in try cases(Self.f, "createByteMap") {
      check(json(RichText.createByteMap(c.string("text") ?? "")), c)
    }
  }

  @Test func byteToCharIndex() throws {
    for c in try cases(Self.f, "byteToCharIndex") {
      let map = RichText.createByteMap(c.string("text") ?? "")
      check(.number(Double(RichText.byteToCharIndex(map, c.int("byteIndex")))), c)
    }
  }

  @Test func utf8Length() throws {
    for c in try cases(Self.f, "utf8Length") {
      check(.number(Double(RichText.utf8Length(c.string("text")))), c)
    }
  }

  @Test func hasStrippedControlCharacter() throws {
    for c in try cases(Self.f, "hasStrippedControlCharacter") {
      check(.bool(RichText.hasStrippedControlCharacter(c.string("text") ?? "")), c)
    }
  }

  @Test func sanitizeText() throws {
    for c in try cases(Self.f, "sanitizeText") {
      check(.string(RichText.sanitizeText(c.string("text"))), c)
    }
  }

  @Test func safeExternalUrl() throws {
    for c in try cases(Self.f, "safeExternalUrl") {
      check(json(RichText.safeExternalUrl(c["url"])), c)
    }
  }
}

@Suite struct MentionsParity {
  static let f = "posting-text.mentions"

  @Test func findMentions() throws {
    for c in try cases(Self.f, "findMentions") {
      check(json(Mentions.findMentions(c.string("text") ?? "")), c)
    }
  }

  @Test func detectPartialMention() throws {
    for c in try cases(Self.f, "detectPartialMention") {
      check(json(Mentions.detectPartialMention(c.string("text") ?? "", c.int("cursor"))), c)
    }
  }

  @Test func detectCompletedMentions() throws {
    for c in try cases(Self.f, "detectCompletedMentions") {
      check(json(Mentions.detectCompletedMentions(c.string("text") ?? "", c.int("cursor"))), c)
    }
  }

  @Test func isValidHandle() throws {
    for c in try cases(Self.f, "isValidHandle") {
      check(.bool(Mentions.isValidHandle(c.string("handle"))), c)
    }
  }

  @Test func createMentionFacet() throws {
    for c in try cases(Self.f, "createMentionFacet") {
      let facet = Mentions.createMentionFacet(
        did: c.string("did") ?? "", start: c.int("start"), end: c.int("end"),
        byteMap: RichText.createByteMap(c.string("text") ?? ""))
      check(json(facet), c)
    }
    #expect(Mentions.createMentionFacet(did: "did:plc:x", start: 0, end: 99, byteMap: [0, 1]) == nil)
  }

  /// The resolver over a fake fetch, step by step, as the generator asks it.
  @Test func createMentionResolver() async throws {
    for c in try cases(Self.f, "createMentionResolver") {
      let clock = Locked<Double>(0)
      let fetched = Locked<[String]>([])
      let table = c["table"]
      let fetch: MentionFetch = { url in
        fetched.withLock { $0.append(url) }
        let handle = (try? WHATWGURL(url))?.searchParams.get("handle") ?? ""
        guard let reply = table[handle], reply["throws"] == nil else { throw URLError(.notConnectedToInternet) }
        let body = reply["body"].map { Data($0.jsonString().utf8) } ?? Data("not json".utf8)
        return MentionFetchResponse(status: reply["status"]?.intValue ?? 200, body: body)
      }
      let options = c["options"]
      let resolve = Mentions.createMentionResolver(
        fetch: fetch,
        appview: options["appview"]?.stringValue ?? AppConfig.appview,
        ttlMs: options["ttlMs"]?.doubleValue ?? Mentions.resolveCacheTtlMs,
        now: { clock.wrappedValue })
      var steps: [JSONValue] = []
      for step in c["steps"].arrayValue ?? [] {
        clock.set(step["at"]?.doubleValue ?? 0)
        let before = fetched.wrappedValue.count
        let asks = step["ask"]?.arrayValue ?? []
        let results = await withTaskGroup(of: (Int, String?).self) { group in
          for (index, ask) in asks.enumerated() {
            group.addTask { (index, (try? await resolve(ask.stringValue ?? "")) ?? nil) }
          }
          var out = [String?](repeating: nil, count: asks.count)
          for await (index, did) in group { out[index] = did }
          return out
        }
        let requests = Array(fetched.wrappedValue[before...]).sorted()
        steps.append([
          "results": .array(results.map { $0.map(JSONValue.string) ?? .null }),
          "requests": .array(requests.map(JSONValue.string)),
        ])
      }
      check(.array(steps), c)
    }
  }
}

@Suite struct HashtagsParity {
  static let f = "posting-text.hashtags"

  @Test func constant() throws {
    let c = try cases(Self.f, "MAX_HASHTAG_GRAPHEMES")[0]
    check(.number(Double(Hashtags.maxHashtagGraphemes)), c)
  }

  @Test func findHashtags() throws {
    for c in try cases(Self.f, "findHashtags") {
      check(json(Hashtags.findHashtags(c.string("text"))), c)
    }
  }

  @Test func isValidHashtag() throws {
    for c in try cases(Self.f, "isValidHashtag") {
      check(.bool(Hashtags.isValidHashtag(c.string("tag"))), c)
    }
  }
}

@Suite struct UrlMatchingParity {
  static let f = "posting-text.urlMatching"

  @Test func urlRegex() throws {
    for c in try cases(Self.f, "urlRegex") {
      check(json(UrlMatching.urlRegexMatches(c.string("text") ?? "")), c)
    }
  }

  @Test func trimUrlMatch() throws {
    for c in try cases(Self.f, "trimUrlMatch") {
      check(.string(UrlMatching.trimUrlMatch(c.string("matchText") ?? "")), c)
    }
  }

  @Test func findUrlsAndMentions() throws {
    for c in try cases(Self.f, "findUrlsAndMentions") {
      check(json(UrlMatching.findUrlsAndMentions(c.string("text") ?? "")), c)
    }
  }

  @Test func isValidDomain() throws {
    for c in try cases(Self.f, "isValidDomain") {
      check(.bool(UrlMatching.isValidDomain(c.string("domain") ?? "")), c)
    }
  }

  @Test func isPrecededByQuote() throws {
    for c in try cases(Self.f, "isPrecededByQuote") {
      check(.bool(UrlMatching.isPrecededByQuote(c.string("text") ?? "", c.int("charStart"))), c)
    }
  }
}

@Suite struct PostLinkParity {
  static let f = "posting-text.postLink"

  @Test func recordCollections() throws {
    let c = try cases(Self.f, "RECORD_COLLECTIONS")[0]
    check(json(PostLink.recordCollections), c)
  }

  @Test func kindForCollection() throws {
    for c in try cases(Self.f, "kindForCollection") {
      check(json(PostLink.kindForCollection(c.string("collection"))), c)
    }
  }

  @Test func parseRecordLink() throws {
    for c in try cases(Self.f, "parseRecordLink") {
      check(json(PostLink.parseRecordLink(c.string("url"))), c, strictNulls: true)
    }
  }

  @Test func parsePostLink() throws {
    for c in try cases(Self.f, "parsePostLink") {
      check(json(PostLink.parsePostLink(c.string("url"))), c, strictNulls: true)
    }
  }

  @Test func detectPostLink() throws {
    for c in try cases(Self.f, "detectPostLink") {
      check(json(PostLink.detectPostLink(c.string("url"))), c, strictNulls: true)
    }
  }

  @Test func recordUri() throws {
    for c in try cases(Self.f, "recordUri") {
      let actual = outcome { .string(try PostLink.recordUri(c.string("did") ?? "", c.string("kind") ?? "", c.string("rkey") ?? "")) }
      check(actual, c)
    }
  }

  @Test func parseRecordUri() throws {
    for c in try cases(Self.f, "parseRecordUri") {
      check(json(PostLink.parseRecordUri(c.string("uri"))), c)
    }
  }

  @Test func bskyUrlFor() throws {
    for c in try cases(Self.f, "bskyUrlFor") {
      check(json(PostLink.bskyUrlFor(c.string("uri"), c.string("actor"))), c)
    }
  }
}
