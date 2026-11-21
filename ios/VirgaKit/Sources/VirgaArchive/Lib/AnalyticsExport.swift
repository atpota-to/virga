// Ports src/lib/analyticsExport.js
//
// The archive as files the owner can keep. Pure builders: they take the rows
// the dashboard already holds and return text; handing it over as a file is
// the UI's job (ArchiveExports gives it an ExportFile).
//
//   archiveJson   every store verbatim, the sync meta, and notes on what
//                 the rows can and cannot vouch for
//   postsCsv      one row per post with its counts, newest first

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaRepo

/// `new Date(now).toISOString()` refused an invalid time.
public struct ExportTimeError: Error, LocalizedError, Hashable, Sendable {
  public var errorDescription: String? { "Invalid time value" }
}

public enum AnalyticsExport {
  public static let exportFormat = "virga-analytics-export"
  public static let exportVersion = 1

  /// The archive stores, in the order the JSON lists them.
  public static let storeKeys = ["posts", "followers", "following", "blocks", "inbound", "outbound", "atmosphere"]

  /// What each store is, and where it stops being the whole truth.
  public static let notes: [(key: String, text: String)] = [
    (
      "posts",
      "Your own posts and replies; reposts are not included. text is the whole post. len is its length as Bluesky counts it; "
        + "media is image, video, gif or link (a link card), with mediaCount items of which altCount are described; tags, links (hosts) and mentions (DIDs) come from the post’s facets; "
        + "threadOf and threadKey name the thread a reply belongs to. Rows archived before these were kept (meta.posts.shape below 2) have a 200-character text and none of them until the next sync. "
        + "Engagement counts are as of the sync that last fetched each post: ordinary syncs refresh recent posts only, a Rebuild refreshes all of them. "
        + "Posts deleted since the last Rebuild may still be listed."
    ),
    (
      "followers",
      "Current followers, each dated by their follow record. Anyone who has since unfollowed, or whose account is gone, is not listed."
    ),
    (
      "following",
      "Your own follow records, one row per record (a repo can hold two for one account), each dated by its record key. Read in full at every sync."
    ),
    (
      "blocks",
      "Block records in other repos that currently point at you, directly or through a moderation list, each dated by its record key."
    ),
    (
      "inbound",
      "Likes, reposts, replies, quotes and mentions from your notifications. Coverage reaches back only as far as the notification history did when Virga first synced (meta.inbound.coverageMs). "
        + "subject is the post an event was about, on events archived since that was kept."
    ),
    ("outbound", "Your own likes and reposts. Your replies and quotes are in posts, under replyTo and quoteOf."),
    ("atmosphere", "Every record in every collection of your repo: its URI, collection and date. Record contents are not included."),
    ("actors", "Profile cards for accounts the People lists have shown."),
  ]

  /// One store's rows as JSON.
  static func storeRows(_ archive: ArchiveData?, _ key: String) -> [JSONValue] {
    guard let archive else { return [] }
    switch key {
    case "posts": return archive.posts.map(\.json)
    case "followers": return archive.followers.map(\.json)
    case "following": return archive.following.map(\.json)
    case "blocks": return archive.blocks.map(\.json)
    case "inbound": return archive.inbound.map(\.json)
    case "outbound": return archive.outbound.map(\.json)
    case "atmosphere": return archive.atmosphere.map(\.json)
    default: return []
    }
  }

  /// An object written with its members in this order.
  static func ordered(_ members: [(String, String)]) -> String {
    "{" + members.map { "\(JSONStringify.quote($0.0)):\($0.1)" }.joined(separator: ",") + "}"
  }

  /// The whole archive as one JSON document: counts above the rows, so a
  /// reader sees the size before the bulk. The document's own members are
  /// in the web's order; inside a row or the meta, members are sorted.
  public static func archiveJson(
    _ archive: ArchiveData?, did: String? = nil, handle: String? = nil, actors: [ActorCard] = [], now: Double
  ) throws -> String {
    guard let exportedAt = JSDate.toISOString(now) else { throw ExportTimeError() }
    var stores: [(String, String)] = []
    var counts: [(String, String)] = []
    for key in storeKeys {
      let rows = storeRows(archive, key)
      stores.append((key, JSONStringify.stringify(.array(rows))))
      counts.append((key, String(rows.count)))
    }
    counts.append(("actors", String(actors.count)))
    let text: (String?) -> String = { $0.map(JSONStringify.quote) ?? "null" }
    let members: [(String, String)] =
      [
        ("format", JSONStringify.quote(exportFormat)),
        ("version", String(exportVersion)),
        ("exportedAt", JSONStringify.quote(exportedAt)),
        ("did", text(did)),
        ("handle", text(handle)),
        ("notes", ordered(notes.map { ($0.key, JSONStringify.quote($0.text)) })),
        ("counts", ordered(counts)),
        ("meta", JSONStringify.stringify(archive?.meta.json ?? .object([:]))),
      ] + stores + [("actors", JSONStringify.stringify(.array(actors.map(\.json))))]
    return ordered(members)
  }

  /// The columns of the posts CSV, in order.
  public static let csvColumns = [
    "created_at", "kind", "text", "likes", "reposts", "replies", "quotes", "engagement", "has_media", "reply_to",
    "quote_of", "url", "uri", "media", "media_count", "alt_text_count", "length", "tags", "links", "langs",
  ]

  /// One post's cells, in column order (nil is an empty cell).
  static func cells(_ p: PostRow, did: String?, handle: String?) -> [String?] {
    let kind: String
    if let replyTo = p.replyTo, !replyTo.isEmpty {
      kind = Optional(replyTo).jsEquals(did) ? "thread" : "reply"
    } else {
      kind = "post"
    }
    let who = did.flatMap { $0.isEmpty ? nil : $0 } ?? handle
    func nonEmpty(_ s: String?) -> String { s.flatMap { $0.isEmpty ? nil : $0 } ?? "" }
    return [
      p.at,
      kind,
      p.text,
      String(p.likes),
      String(p.reposts),
      String(p.replies),
      String(p.quotes),
      String(Analytics.engagementOf(p, "all")),
      (p.hasMedia ?? false) ? "true" : "false",
      nonEmpty(p.replyTo),
      nonEmpty(p.quoteOf),
      postUrl(who, p.rkey),
      p.uri.isEmpty ? nil : p.uri,
      nonEmpty(p.media),
      String(p.mediaCount ?? 0),
      String(p.altCount ?? 0),
      p.len.map(String.init) ?? "",
      (p.tags ?? []).joined(separator: " "),
      (p.links ?? []).joined(separator: " "),
      (p.langs ?? []).joined(separator: " "),
    ]
  }

  /// The post archive as CSV (RFC 4180: quoted where needed, CRLF rows),
  /// newest first, after a byte-order mark so Excel reads it as UTF-8.
  public static func postsCsv(_ posts: [PostRow]?, did: String? = nil, handle: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()) -> String {
    let parse = { (p: PostRow) in JSDate.parse(p.at ?? "undefined", timeZone: timeZone) }
    let rows = JSSort.sort(posts ?? []) { a, b in
      let ta = parse(a)
      let tb = parse(b)
      if !ta.isFinite { return tb.isFinite ? 1 : 0 }
      if !tb.isFinite { return -1 }
      return tb - ta
    }
    var lines = [csvColumns.joined(separator: ",")]
    for p in rows { lines.append(cells(p, did: did, handle: handle).map(csvCell).joined(separator: ",")) }
    return "\u{FEFF}\(lines.joined(separator: "\r\n"))\r\n"
  }

  /// `alice.example-analytics-2026-10-29.json`: the handle, what it is, the local day.
  public static func exportFilename(
    _ handle: String?, _ what: String, _ ext: String, now: Double, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> String {
    let day: String
    if let d = JSDate.fields(JSDate.timeClip(now), timeZone: timeZone) {
      day = [d.year, d.month + 1, d.date].map(Periods.pad2).joined(separator: "-")
    } else {
      day = "NaN-NaN-NaN"
    }
    let stem = handle.flatMap { $0.isEmpty ? nil : $0 } ?? "archive"
    return "\(stem)-\(what)-\(day).\(ext)"
  }

  /// A CSV cell: quoted when it holds a quote, comma or line break.
  static func csvCell(_ value: String?) -> String {
    let s = value ?? ""
    guard s.utf16.contains(where: { $0 == 0x22 || $0 == 0x2C || $0 == 0x0D || $0 == 0x0A }) else { return s }
    var units: [UInt16] = [0x22]
    for unit in s.utf16 {
      units.append(unit)
      if unit == 0x22 { units.append(0x22) }
    }
    units.append(0x22)
    return String(jsUnits: units)
  }

  /// The bsky.app link for one post, by DID when there is one.
  static func postUrl(_ who: String?, _ rkey: String?) -> String {
    guard let who, !who.isEmpty, let rkey, !rkey.isEmpty else { return "" }
    return "https://bsky.app/profile/\(who)/post/\(rkey)"
  }
}
