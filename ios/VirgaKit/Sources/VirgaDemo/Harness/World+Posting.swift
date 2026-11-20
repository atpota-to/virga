// Ports harness/world.js: what an account has on the posting side when the
// app opens (MIRA_POSTING, LAB_POSTING, withPostingFixtures).

import Foundation
import VirgaCore

extension World {
  /// What an account has on the posting side when the page opens: drafts
  /// kept by Bluesky, bookmarks, Bluesky preferences (saved feeds and the
  /// default reply and quote settings), feeds and lists it made, and
  /// templates in its repo. `drafts` and `templates` are written as the
  /// services would read them back.
  struct PostingFixtures: Sendable {
    struct Feed: Sendable {
      var name: String
      var description: String
      var likeCount: Int
    }

    struct OwnList: Sendable {
      var name: String
      var description: String
      var purpose: String
    }

    struct Draft: Sendable {
      var text: String
      var thread: [String]?
      var daysAgo: Double
    }

    var feeds: [Feed]
    var lists: [OwnList]
    /// The postInteractionSettingsPref's members, or nil for none.
    var postInteraction: [String: JSONValue]?
    var drafts: [Draft]
    /// Each template's members, in the web's order (`$type` and `createdAt` are added).
    var templates: [[String: JSONValue]]
    var bookmarks: Int
  }

  static let miraPosting = PostingFixtures(
    feeds: [
      .init(name: "Allotment people", description: "Posts about allotments, seed swaps and sheds.", likeCount: 212),
      .init(name: "Street trees", description: "Every post that mentions a street tree.", likeCount: 48),
    ],
    lists: [
      .init(
        name: "Neighbourhood", description: "People on the street and nearby.",
        purpose: "app.bsky.graph.defs#curatelist"),
      .init(name: "Tool library volunteers", description: "", purpose: "app.bsky.graph.defs#curatelist"),
    ],
    // Replies from people followed and people mentioned; quotes allowed.
    postInteraction: [
      "threadgateAllowRules": [
        ["$type": "app.bsky.feed.threadgate#followingRule"], ["$type": "app.bsky.feed.threadgate#mentionRule"],
      ],
      "postgateEmbeddingRules": [],
    ],
    drafts: [
      .init(text: "Half-finished thought about bus shelters and who they are really for.", thread: nil, daysAgo: 2),
      .init(
        text: "A short thread on the repair café numbers from this year.",
        thread: [
          "412 things came in. 301 went home working.",
          "Lamps were the most common. Toasters were the most stubborn.",
        ],
        daysAgo: 6
      ),
    ],
    templates: [
      [
        "name": "Thanks for the follow", "text": "Thanks for the follow, {{their.firstName}}!", "use": "reply",
        "shortcut": "thanks",
      ],
      [
        "name": "Event reminder",
        "text": "Reminder: {{event}} is on {{day}}. Everyone welcome.",
        "use": "post",
        "shortcut": "remind",
        "variables": [
          ["key": "event", "label": "What is on"],
          ["key": "day", "label": "Which day", "kind": "choice", "choices": ["Saturday", "Sunday"]],
        ],
      ],
    ],
    bookmarks: 6
  )

  static let labPosting = PostingFixtures(
    feeds: [], lists: [], postInteraction: nil, drafts: [], templates: [], bookmarks: 0)

  static func withPostingFixtures(_ world: inout AccountWorld, _ fixtures: PostingFixtures) {
    let me = world.me
    let now = world.now
    let cast = world.cast
    let feedNames = ["allotments", "street-trees"]
    world.feeds = fixtures.feeds.enumerated().map { i, f in
      WorldFeed(
        name: f.name,
        description: f.description,
        likeCount: f.likeCount,
        uri: "at://\(me.did)/app.bsky.feed.generator/\(i < feedNames.count ? feedNames[i] : "feed-\(i)")",
        createdAt: iso(now - (300 - Double(i) * 40) * day)
      )
    }
    world.ownLists = fixtures.lists.enumerated().map { i, l in
      WorldOwnList(
        name: l.name,
        description: l.description,
        purpose: l.purpose,
        uri: "at://\(me.did)/app.bsky.graph.list/\(tid(now - (200 - Double(i) * 30) * day, i))",
        members: JSArray.slice(cast, Double(i * 7), Double(i * 7 + 9)).map(\.did),
        createdAt: iso(now - (200 - Double(i) * 30) * day)
      )
    }
    var items: [JSONValue] = [["id": "following", "type": "timeline", "value": "following", "pinned": true]]
    for (i, f) in world.feeds.enumerated() {
      items.append(["id": .string("saved-\(i)"), "type": "feed", "value": .string(f.uri), "pinned": .bool(i == 0)])
    }
    world.preferences = [["$type": "app.bsky.actor.defs#savedFeedsPrefV2", "items": .array(items)]]
    if let interaction = fixtures.postInteraction {
      var pref = interaction
      pref["$type"] = "app.bsky.actor.defs#postInteractionSettingsPref"
      world.preferences.append(.object(pref))
    }
    world.drafts = fixtures.drafts.enumerated().map { i, d in
      let when = iso(now - d.daysAgo * day)
      let texts = [d.text] + (d.thread ?? [])
      return WorldDraft(
        id: tid(now - d.daysAgo * day, 40 + i),
        draft: ["posts": .array(texts.map { ["text": .string($0)] }), "langs": ["en"]],
        createdAt: when,
        updatedAt: when
      )
    }
    // Posts by people in the cast, saved for later: the synthetic posts
    // harness/views.js answers for any cast URI.
    world.bookmarks = (0..<fixtures.bookmarks).map { i in
      WorldBookmark(
        uri: "at://\(cast[i * 3].did)/app.bsky.feed.post/\(tid(now - Double(i * 2 + 1) * day, 60 + i))",
        createdAt: iso(now - Double(i * 2 + 1) * day + 3_600_000)
      )
    }
    // What the page writes and deletes, over the fixtures (HarnessRepo).
    world.written = JSOrderedMap()
    world.removed = JSOrderedSet()
    world.blobs = JSOrderedMap()
    world.revision = 0
    for (i, template) in fixtures.templates.enumerated() {
      let created = iso(now - (90 - Double(i) * 20) * day)
      var value = template
      value["$type"] = "net.anisota.feed.template"
      value["createdAt"] = .string(created)
      let key = "net.anisota.feed.template/\(tid(JSDate.parse(created, timeZone: .gmt), 80 + i))"
      world.written[key] = WorldWritten(value: .object(value), cid: "bafyharness")
    }
  }
}
