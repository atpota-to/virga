// The lexicon models round-trip the JSON the web reads and writes exactly
// (ios/parity/cases/core.lexicon.js: the harness's AppView and PDS, and
// written samples of what it doesn't make), and read it as the web does.

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

/// Decode `json` as `T` and encode it again.
func roundTrip<T: Codable>(_ type: T.Type, _ json: JSONValue) throws -> JSONValue {
  try JSONValue(encoding: try json.decode(T.self))
}

let lexiconTypes: [String: @Sendable (JSONValue) throws -> JSONValue] = [
  "PostRecord": { try roundTrip(PostRecord.self, $0) },
  "ThreadgateRecord": { try roundTrip(ThreadgateRecord.self, $0) },
  "PostgateRecord": { try roundTrip(PostgateRecord.self, $0) },
  "LikeRecord": { try roundTrip(LikeRecord.self, $0) },
  "RepostRecord": { try roundTrip(RepostRecord.self, $0) },
  "FollowRecord": { try roundTrip(FollowRecord.self, $0) },
  "BlockRecord": { try roundTrip(BlockRecord.self, $0) },
  "ListRecord": { try roundTrip(ListRecord.self, $0) },
  "ListItemRecord": { try roundTrip(ListItemRecord.self, $0) },
  "ListBlockRecord": { try roundTrip(ListBlockRecord.self, $0) },
  "StarterPackRecord": { try roundTrip(StarterPackRecord.self, $0) },
  "ProfileRecord": { try roundTrip(ProfileRecord.self, $0) },
  "GeneratorRecord": { try roundTrip(GeneratorRecord.self, $0) },
  "TemplateRecord": { try roundTrip(TemplateRecord.self, $0) },
  "Draft": { try roundTrip(Draft.self, $0) },
  "ProfileViewDetailed": { try roundTrip(ProfileViewDetailed.self, $0) },
  "PostView": { try roundTrip(PostView.self, $0) },
  "FeedViewPost": { try roundTrip(FeedViewPost.self, $0) },
  "DIDDocument": { try roundTrip(DIDDocument.self, $0) },
  "GetAuthorFeedOutput": { try roundTrip(GetAuthorFeedOutput.self, $0) },
  "GetPostsOutput": { try roundTrip(GetPostsOutput.self, $0) },
  "GetPostThreadOutput": { try roundTrip(GetPostThreadOutput.self, $0) },
  "GetFeedGeneratorsOutput": { try roundTrip(GetFeedGeneratorsOutput.self, $0) },
  "GetFeedGeneratorOutput": { try roundTrip(GetFeedGeneratorOutput.self, $0) },
  "GetListsOutput": { try roundTrip(GetListsOutput.self, $0) },
  "GetListOutput": { try roundTrip(GetListOutput.self, $0) },
  "GetRelationshipsOutput": { try roundTrip(GetRelationshipsOutput.self, $0) },
  "ResolveHandleOutput": { try roundTrip(ResolveHandleOutput.self, $0) },
  "ListRecordsOutput": { try roundTrip(ListRecordsOutput.self, $0) },
  "ListNotificationsOutput": { try roundTrip(ListNotificationsOutput.self, $0) },
  "GetFollowersOutput": { try roundTrip(GetFollowersOutput.self, $0) },
  "GetProfilesOutput": { try roundTrip(GetProfilesOutput.self, $0) },
  "GetPreferencesOutput": { try roundTrip(GetPreferencesOutput.self, $0) },
  "GetBookmarksOutput": { try roundTrip(GetBookmarksOutput.self, $0) },
  "GetDraftsOutput": { try roundTrip(GetDraftsOutput.self, $0) },
  "SearchPostsOutput": { try roundTrip(SearchPostsOutput.self, $0) },
  "DescribeRepoOutput": { try roundTrip(DescribeRepoOutput.self, $0) },
  "VideoJobStatusOutput": { try roundTrip(VideoJobStatusOutput.self, $0) },
  "VideoUploadLimits": { try roundTrip(VideoUploadLimits.self, $0) },
  "ApplyWritesInput": { try roundTrip(ApplyWritesInput.self, $0) },
  "ApplyWritesOutput": { try roundTrip(ApplyWritesOutput.self, $0) },
  "WriteRecordOutput": { try roundTrip(WriteRecordOutput.self, $0) },
  "GetRecordOutput": { try roundTrip(GetRecordOutput.self, $0) },
  "UploadBlobOutput": { try roundTrip(UploadBlobOutput.self, $0) },
  "GetStarterPackOutput": { try roundTrip(GetStarterPackOutput.self, $0) },
]

@Suite struct LexiconRoundTrip {
  @Test func everyShapeComesBackAsItWent() throws {
    var failures: [String] = []
    for c in try Parity.cases("core.lexicon", fn: "roundTrip") {
      let type = c["type"].stringValue ?? ""
      guard let trip = lexiconTypes[type] else {
        failures.append("\(c.id): no Swift type registered for \(type)")
        continue
      }
      let missing = c["missing"].arrayValue?.compactMap(\.stringValue) ?? []
      do {
        let back = try trip(c.output)
        if !missing.isEmpty {
          failures.append("\(c.id): read as a \(type) without \(missing.joined(separator: ", "))")
        } else if let d = Parity.diff(back, c.output, strictNulls: true) {
          failures.append("\(c.id): \(d)")
        }
      } catch {
        // A record without its required fields is not that record.
        if missing.isEmpty { failures.append("\(c.id): \(error)") }
      }
    }
    #expect(failures.isEmpty, "\(failures.count) shapes:\n\(failures.prefix(30).joined(separator: "\n"))")
  }

  /// The JSON of the case named `id`'s prefix.
  func sample(_ from: String, type: String) throws -> JSONValue {
    let found = try Parity.cases("core.lexicon", fn: "roundTrip").first {
      $0["type"].stringValue == type && $0["from"].stringValue == from
    }
    return try #require(found).output
  }

  @Test func aPostReadsAsTheWebReadsIt() throws {
    let post = try sample("every field", type: "PostRecord").decode(PostRecord.self)
    #expect(post.text.hasPrefix("Herons"))
    #expect(post.reply?.root.uri.hasSuffix("3l3qo2vutsw2b") == true)
    #expect(post.langs == ["en", "fr"])
    #expect(post.labels?.values.map(\.val) == ["graphic-media"])
    #expect(post.tags == ["birds", "estuary"])
    #expect(post.facets?.count == 3)
    #expect(post.facets?[0].features == [.mention(did: "did:plc:jo")])
    #expect(post.facets?[2].features.last.map { if case .unknown = $0 { true } else { false } } == true)
    guard case .recordWithMedia(let rwm) = post.embed else {
      Issue.record("expected recordWithMedia, got \(String(describing: post.embed))")
      return
    }
    #expect(rwm.record.record.cid.hasPrefix("bafyrei"))
    guard case .images(let images) = rwm.media else {
      Issue.record("expected images")
      return
    }
    #expect(images.images.map(\.alt) == ["A heron", ""])
    #expect(images.images[0].aspectRatio == AspectRatio(width: 1200, height: 800))
    #expect(images.images[0].image.cid == "bafkreibme22gw2h7y2h7tg2fhqotaqjucnbc24deqo72b6mkl2egezxhvy")
  }

  @Test func whatARecordCantReadItKeeps() throws {
    let json = try sample("fields a newer lexicon adds, and one of the wrong type", type: "PostRecord")
    let post = try json.decode(PostRecord.self)
    #expect(post.langs == nil, "a string where a list belongs reads as no langs")
    #expect(post.extra["langs"] == "en", "and is kept as it was")
    #expect(post.extra["via"] == "some-client")
    #expect(post.extra["nested"]?["deep"]?[2]?["x"] == .null)
    var edited = post
    edited.langs = ["de"]
    #expect(try JSONValue(encoding: edited)["langs"] == ["de"], "a field set since wins over the copy kept")
  }

  @Test func unknownAndMalformedMembersStayAsTheyCame() throws {
    let poll = try sample("an embed this version does not know", type: "PostRecord").decode(PostRecord.self)
    #expect(poll.embed?.type == "com.example.poll")
    if case .unknown = poll.embed {} else { Issue.record("an unknown embed is kept as JSON") }
    let broken = try sample("a known embed that is malformed", type: "PostRecord").decode(PostRecord.self)
    if case .unknown(let raw) = broken.embed {
      #expect(raw["images"] == "not a list")
    } else {
      Issue.record("a malformed embed is kept as JSON, not dropped")
    }
  }

  @Test func gatesReadEveryRule() throws {
    let gate = try sample("every rule", type: "ThreadgateRecord").decode(ThreadgateRecord.self)
    let allow = try #require(gate.allow)
    #expect(allow.prefix(4) == [.mention, .follower, .following, .list("at://did:plc:me/app.bsky.graph.list/3kl")])
    if case .unknown(let raw) = allow[4] { #expect(raw["$type"] == "app.bsky.feed.threadgate#verifiedRule") }
    if case .unknown(let raw) = allow[5] { #expect(raw["note"] == "extra", "a rule with more than its lexicon keeps it") }
    let nobody = try sample("nobody", type: "ThreadgateRecord").decode(ThreadgateRecord.self)
    let everybody = try sample("everybody", type: "ThreadgateRecord").decode(ThreadgateRecord.self)
    #expect(nobody.allow == [], "an empty allow is nobody")
    #expect(everybody.allow == nil, "no allow is everybody")
    let postgate = try sample("no quotes", type: "PostgateRecord").decode(PostgateRecord.self)
    #expect(postgate.embeddingRules?.first == .disable)
  }

  @Test func viewsReadTheirUnions() throws {
    let quoted = try sample("a quoted post", type: "PostView").decode(PostView.self)
    guard case .record(let embed) = quoted.embed, case .post(let viewRecord) = embed.record else {
      Issue.record("expected a quoted post")
      return
    }
    #expect(viewRecord.postRecord?.text == "Quoted.")
    #expect(viewRecord.author.viewer?.knownFollowers?.count == 12)
    #expect(quoted.postRecord?.text == "Hello")
    #expect(quoted.viewer?.bookmarked == true)
    #expect(quoted.labels?.first?.val == "nudity")
    #expect(quoted.threadgate?.record?["allow"] == [])

    let broken = try sample("a repost of a reply in a broken thread", type: "FeedViewPost").decode(FeedViewPost.self)
    if case .blocked(let root) = broken.reply?.root { #expect(root.author.did == "did:plc:blocker") } else {
      Issue.record("the root is blocked")
    }
    if case .notFound(let parent) = broken.reply?.parent { #expect(parent.notFound) } else {
      Issue.record("the parent is gone")
    }
    if case .repost(let reason) = broken.reason { #expect(reason.by.handle == "fan.test") } else {
      Issue.record("a repost")
    }
    let pinned = try sample("a pinned post replying in a thread", type: "FeedViewPost").decode(FeedViewPost.self)
    if case .pin = pinned.reason {} else { Issue.record("a pin") }
    #expect(pinned.reply?.root.postView?.uri == pinned.post.uri)

    let thread = try sample("a thread with gaps", type: "GetPostThreadOutput").decode(GetPostThreadOutput.self)
    let top = try #require(thread.thread.threadViewPost)
    if case .post(let parent) = top.parent, case .notFound = parent.parent {} else { Issue.record("a parent above a gap") }
    #expect(top.replies?.count == 2)
    if case .blocked = top.replies?[1] {} else { Issue.record("a blocked reply") }
  }

  @Test func preferencesKeepWhatTheyDontKnow() throws {
    let prefs = try sample("kinds Virga reads, and one it does not", type: "GetPreferencesOutput").decode(GetPreferencesOutput.self)
    guard case .postInteractionSettings(let interaction) = prefs.preferences[0] else {
      Issue.record("postInteractionSettingsPref")
      return
    }
    #expect(interaction.threadgateAllowRules == [.mention])
    #expect(interaction.postgateEmbeddingRules == [.disable])
    if case .savedFeedsV2(let saved) = prefs.preferences[1] {
      #expect(saved.items.map(\.type) == ["timeline", "feed"])
    } else {
      Issue.record("savedFeedsPrefV2")
    }
    if case .unknown(let raw) = prefs.preferences[3] { #expect(raw["enabled"] == false) } else {
      Issue.record("adultContentPref is kept as JSON")
    }
    if case .postInteractionSettings(let newer) = prefs.preferences[4] {
      #expect(newer.extra["newField"] == "kept")
    } else {
      Issue.record("a newer postInteractionSettingsPref")
    }
  }

  @Test func draftsKeepTheWebsOwnFieldsAndAnotherAppsToo() throws {
    let draft = try sample("every embed, and the web own fields", type: "Draft").decode(Draft.self)
    let first = draft.posts[0]
    #expect(first.embedImages?.first?.localRef.path == "img-1")
    #expect(first.embedVideos?.first?.captions?.first?.content == "WEBVTT")
    #expect(first.tags == ["birds"])
    #expect(first.virgaCard?["edited"] == true)
    if case .images = first.embed {} else { Issue.record("the web's embed") }
    #expect(draft.posts[1].lexiconType == nil, "a post written without a $type is written back without one")
    #expect(draft.posts[1].extra["someOtherAppField"] == 1)
    #expect(draft.threadgateAllow == [.following])
    #expect(draft.postgateEmbeddingRules == [])
  }

  @Test func newObjectsCarryTheirTypes() throws {
    let post = PostRecord(
      text: "hi", embed: .images(ImagesEmbed(images: [EmbedImage(image: BlobRef(cid: "bafk", mimeType: "image/png", size: 3), alt: "")])),
      createdAt: "2026-11-12T00:00:00.000Z")
    let json = try post.json()
    #expect(json["$type"] == "app.bsky.feed.post")
    #expect(json["embed"]?["$type"] == "app.bsky.embed.images")
    #expect(json["embed"]?["images"]?[0]?["image"]?["$type"] == "blob")
    #expect(json["embed"]?["images"]?[0]?["aspectRatio"] == nil, "an optional left out is not written")
    let gate = ThreadgateRecord(post: "at://x/app.bsky.feed.post/1", allow: [.list("at://x/app.bsky.graph.list/2")], createdAt: "t")
    #expect(try gate.json()["allow"] == [["$type": "app.bsky.feed.threadgate#listRule", "list": "at://x/app.bsky.graph.list/2"]])
    // A view made here gets its $type only where it is a union member.
    let view = PostView(
      uri: "at://x/app.bsky.feed.post/1", cid: "c", author: ProfileViewBasic(did: "did:plc:x", handle: "x.test"),
      record: ["text": "hi"], indexedAt: "t")
    #expect(try JSONValue(encoding: view)["$type"] == nil)
    #expect(try JSONValue(encoding: PostOrUnavailable.post(view))["$type"] == "app.bsky.feed.defs#postView")
    #expect(try JSONValue(encoding: StrongRef(uri: "u", cid: "c")) == ["uri": "u", "cid": "c"])
  }

  @Test func aRecordWithoutItsTypeGainsIt() throws {
    let bare: JSONValue = ["text": "bare", "createdAt": "2026-11-12T09:30:00.000Z"]
    let post = try bare.decode(PostRecord.self)
    #expect(try post.json() == ["$type": "app.bsky.feed.post", "text": "bare", "createdAt": "2026-11-12T09:30:00.000Z"])
  }

  @Test func facetsKeepWhetherTheyHadATypeAndNewOnesHaveIt() throws {
    let untyped: JSONValue = ["index": ["byteStart": 0, "byteEnd": 1], "features": []]
    #expect(try JSONValue(encoding: try untyped.decode(Facet.self)) == untyped)
    #expect(try JSONValue(encoding: Facet(byteStart: 0, byteEnd: 1, feature: .tag(tag: "a")))["$type"] == "app.bsky.richtext.facet")
  }

  @Test func aRecordOfAnotherCollectionIsNotThisOne() {
    let like: JSONValue = ["$type": "app.bsky.feed.like", "subject": ["uri": "u", "cid": "c"], "createdAt": "t"]
    #expect(PostRecord(json: like) == nil)
    #expect(LikeRecord(json: like) != nil)
    #expect(RepoRecord(uri: "at://did:plc:a/app.bsky.feed.like/3k", cid: "c", value: like).decode(LikeRecord.self) != nil)
    #expect(RepoRecord(uri: "at://did:plc:a/app.bsky.feed.like/3k", cid: "c", value: like).rkey == "3k")
    #expect(PostRecord(json: ["$type": "app.bsky.feed.post", "createdAt": "t"]) == nil, "a post needs its text")
  }

  @Test func didDocumentsKeepEveryService() throws {
    let doc = try sample("a did:plc with its key", type: "DIDDocument").decode(DIDDocument.self)
    #expect(doc.service?.first?.endpoint == "https://puffball.us-east.host.bsky.network")
    #expect(doc.service?[1].endpoint == nil, "a map endpoint is kept, but isn't a string")
    #expect(doc.verificationMethod?.first?.publicKeyMultibase?.hasPrefix("zQ3sh") == true)
    #expect(doc.alsoKnownAs == ["at://bsky.app"])
  }
}
