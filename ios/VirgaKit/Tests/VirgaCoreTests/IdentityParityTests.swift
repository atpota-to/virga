// DIDs, handles and AT-URIs against the web functions that read them
// (ios/parity/cases/core.identity.js).

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

@Suite struct IdentityParity {
  private func check(_ fn: String, _ key: String, _ body: (String?) -> JSONValue) throws {
    for c in try Parity.cases("core.identity", fn: fn) {
      let d = Parity.diff(body(c[key].stringValue), c.output)
      #expect(d == nil, "\(c) \(c[key]): \(d ?? "")")
    }
  }

  @Test func dids() throws {
    try check("accounts.isDid", "value") { .bool(DID.isDid($0)) }
    try check("harvest.isDid", "value") { .bool(DID.isValidDid($0)) }
    // interactionModel's isDid reads `String(text || '')`, so a number is "42".
    for c in try Parity.cases("core.identity", fn: "interactionModel.isDid") {
      let text = c["value"].isNull ? "" : c["value"].jsString
      let d = Parity.diff(.bool(DID.isAtprotoDid(text)), c.output)
      #expect(d == nil, "\(c) \(c["value"]): \(d ?? "")")
    }
  }

  @Test func handles() throws {
    try check("isValidHandle", "handle") { .bool(Handle.isValidHandle($0)) }
  }

  @Test func atUris() throws {
    try check("rkeyFromAtUri", "uri") { AtUri.rkey(of: $0).map(JSONValue.string) ?? .null }
    try check("didFromAtUri", "uri") { AtUri.did(of: $0).map(JSONValue.string) ?? .null }
    try check("authorOf", "uri") { uri in
      guard let repo = AtUri.authority(of: uri), repo.hasPrefix("did:"), DID.isValidDid(repo) else { return .null }
      return .string(repo)
    }
    // postLink.js reads only the embeddable kinds; the URI itself is AtUri(_:).
    let kinds = [
      "app.bsky.feed.post": "post", "app.bsky.feed.generator": "feed", "app.bsky.graph.list": "list",
      "app.bsky.graph.starterpack": "starterpack",
    ]
    try check("parseRecordUri", "uri") { uri in
      guard let uri, let parsed = AtUri(uri), let kind = kinds[parsed.collection] else { return .null }
      return [
        "kind": .string(kind), "did": .string(parsed.authority), "collection": .string(parsed.collection),
        "rkey": .string(parsed.rkey),
      ]
    }
    for c in try Parity.cases("core.identity", fn: "recordUri") {
      let collection = c["kind"].stringValue == "post" ? "app.bsky.feed.post" : "app.bsky.graph.list"
      let uri = AtUri(authority: c["did"].stringValue ?? "", collection: collection, rkey: c["rkey"].stringValue ?? "")
      #expect(Parity.diff(.string(uri.description), c.output) == nil, "\(c)")
    }
  }

  @Test func theReadingsDifferWhereTheWebsDo() {
    let trailing = "at://did:plc:abc/app.bsky.feed.post/3kabc/"
    #expect(AtUri(trailing)?.rkey == "3kabc", "a record URI may end in a slash")
    #expect(AtUri.parseExact(trailing) == nil, "sources.js's may not")
    #expect(AtUri.parsePrefix(trailing)?.rkey == "3kabc")
    let query = "at://did:plc:abc/app.bsky.feed.post/3kabc?x=1"
    #expect(AtUri(query) == nil)
    #expect(AtUri.parseExact(query) == nil)
    #expect(AtUri.parsePrefix(query)?.rkey == "3kabc")
    let oddRepo = "at://did:plc:a?b/app.bsky.feed.post/3k"
    #expect(AtUri(oddRepo) == nil)
    #expect(AtUri.parseExact(oddRepo)?.authority == "did:plc:a?b")
    #expect(AtUri.collection(of: "at://did:plc:abc/app.bsky.graph.list/3k") == "app.bsky.graph.list")
    #expect(AtUri.authority(of: "at://did:plc:abc/") == "did:plc:abc")
    #expect(AtUri.authority(of: "at://did:plc:abc") == nil)
  }

  @Test func encodesAsItsString() throws {
    let uri = AtUri(authority: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "3k")
    let json = try JSONValue(encoding: ["subject": uri])
    #expect(json["subject"] == "at://did:plc:abc/app.bsky.feed.post/3k")
    #expect(try json.decode([String: AtUri].self)["subject"] == uri)
    #expect(throws: DecodingError.self) { try JSONValue.string("https://x").decode(AtUri.self) }
  }

  @Test func helpers() {
    #expect(DID.method("did:plc:abc") == "plc")
    #expect(DID.method("did:web:") == nil)
    #expect(Handle.normalize("@Alice.Bsky.Social") == "alice.bsky.social")
    // `.replace(/^@/, '').toLowerCase()`: the @ is a code unit, whatever
    // mark follows it, and the lowering is JavaScript's.
    #expect(Handle.normalize("@\u{301}Alice") == "\u{301}alice")
    #expect(Handle.normalize("@@alice") == "@alice")
    #expect(Handle.normalize("ΟΔΟΣ.test") == "οδοσ.test", "a full stop is case-ignorable, so the sigma isn't final")
    #expect(Handle.normalize("@ΟΔΟΣ") == "οδος")
    #expect(Handle.displayable("handle.invalid") == nil)
    #expect(Handle.displayable("jo.test") == "jo.test")
  }
}
