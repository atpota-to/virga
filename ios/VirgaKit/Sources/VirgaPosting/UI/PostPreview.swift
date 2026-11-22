// Ports src/posting/ui/postPreview.js
//
// What PostPreview shows of a post, from whatever the caller has: a post
// view from the AppView (author, counts, a hydrated embed), the bare record
// from a repo, or only its URI. Values are read as loosely as the web reads
// them (JSONValue in, the web's object out).

import Foundation
import VirgaCore
import VirgaNetwork

/// The author line: `{ did, handle, displayName, avatar }`.
public struct PostPreviewAuthor: Hashable, Sendable {
  /// `view.author.did` as it was (nil when absent).
  public var did: JSONValue?
  /// The handle, or nil when absent or 'handle.invalid'.
  public var handle: JSONValue?
  public var displayName: String?
  public var avatar: JSONValue?

  public var json: JSONValue {
    var out: JSONValue = [
      "handle": handle ?? .null, "displayName": displayName.map(JSONValue.string) ?? .null, "avatar": avatar ?? .null,
    ]
    if let did { out["did"] = did }
    return out
  }
}

/// `{ replies, reposts, likes, quotes }` (each `view.xCount || 0`).
public struct PostPreviewCounts: Hashable, Sendable {
  public var replies: JSONValue
  public var reposts: JSONValue
  public var likes: JSONValue
  public var quotes: JSONValue

  public var json: JSONValue { ["replies": replies, "reposts": reposts, "likes": likes, "quotes": quotes] }
}

/// `{ uri, url, author, text, at, embed, counts, isReply }` for display.
public struct PostPreviewModel: Hashable, Sendable {
  public var uri: JSONValue?
  public var url: String?
  /// nil without a view.
  public var author: PostPreviewAuthor?
  public var text: String
  public var at: JSONValue?
  public var embed: String?
  /// nil without a view, since a bare record carries none.
  public var counts: PostPreviewCounts?
  public var isReply: Bool

  public var json: JSONValue {
    [
      "uri": uri ?? .null, "url": url.map(JSONValue.string) ?? .null, "author": author?.json ?? .null,
      "text": .string(text), "at": at ?? .null, "embed": embed.map(JSONValue.string) ?? .null,
      "counts": counts?.json ?? .null, "isReply": .bool(isReply),
    ]
  }
}

public enum PostPreview {
  static let previewChars = 280

  /// `${n.toLocaleString(activeLocale())} ${n === 1 ? one : many}` for a
  /// length as JavaScript read it (a number, or an object's own `length`).
  static func plural(_ n: JSONValue, _ one: String, _ many: String, locale: String?) -> String {
    let text: String
    if case .number(let value) = n {
      text = AppLocale.formatNumber(value, locale: locale ?? AppLocale.activeLocale())
    } else {
      text = n.jsString
    }
    return "\(text) \(n == .number(1) ? one : many)"
  }

  /// One line for an embed: "2 images", "A video", "Link: <title>",
  /// "Quotes a post". Counts are written in `locale` (by default the active
  /// one).
  public static func embedSummary(_ embed: JSONValue?, locale: String? = nil) -> String? {
    guard let embed, case .object = embed else { return nil }
    let type = ComposerJS.truthy(embed["$type"]) ? embed["$type"]!.jsString : ""
    let length = type.utf16.count
    let bare = length >= 5 && type.jsSlice(length - 5).jsEquals("#view") ? type.jsSlice(0, length - 5) : type
    switch bare {
    case "app.bsky.embed.images":
      guard let n = AdviserSheetView.lengthOf(embed["images"].truthy ?? []), n.isTruthy else { return nil }
      return plural(n, "image", "images", locale: locale)
    case "app.bsky.embed.video":
      return "A video"
    case "app.bsky.embed.external":
      let ext = embed["external"].truthy ?? [:]
      let title = ext["title"].truthy.map(\.jsString) ?? hostOf(ext["uri"])
      return title.flatMap { $0.isEmpty ? nil : "Link: \($0)" } ?? "A link"
    case "app.bsky.embed.record":
      return quoteSummary(embed["record"])
    case "app.bsky.embed.recordWithMedia":
      let parts = [
        embedSummary(embed["media"], locale: locale),
        quoteSummary(embed["record"]?["record"].truthy ?? embed["record"]),
      ].compactMap { $0 }.filter { !$0.isEmpty }
      return parts.isEmpty ? nil : parts.joined(separator: " · ")
    default:
      return nil
    }
  }

  static func quoteSummary(_ record: JSONValue?) -> String? {
    let uri = record?["uri"]
    switch PostLink.parseRecordUri(uri?.stringValue)?.kind {
    case "feed": return "Shares a feed"
    case "list": return "Shares a list"
    case "starterpack": return "Shares a starter pack"
    default: return uri?.isTruthy == true ? "Quotes a post" : nil
    }
  }

  /// `new URL(url).host.replace(/^www\./, '')`, or nil where URL throws.
  static func hostOf(_ url: JSONValue?) -> String? {
    guard let parsed = WHATWGURL.parse(url?.jsString ?? "undefined") else { return nil }
    let host = parsed.host
    return PostingJS.hasPrefix(host, "www.") ? host.jsSlice(4) : host
  }

  /// A preview of a post from its view, its record or its URI. `author` and
  /// `counts` are nil without a view; `compact` trims the text to 140
  /// characters (else 280), counted in code points.
  public static func postPreviewModel(
    view: JSONValue? = nil, record: JSONValue? = nil, uri: JSONValue? = nil, compact: Bool = false,
    locale: String? = nil
  ) -> PostPreviewModel {
    let rec = record.truthy ?? view?["record"].truthy
    let postUri = uri.truthy ?? view?["uri"].truthy
    var author: PostPreviewAuthor?
    if let a = view?["author"], a.isTruthy {
      let handle = a["handle"]
      let keepHandle = handle?.isTruthy == true && !(handle?.stringValue == "handle.invalid")
      author = PostPreviewAuthor(
        did: a["did"],
        handle: keepHandle ? handle : nil,
        displayName: a["displayName"]?.stringValue.flatMap { $0.jsTrimmed().isEmpty ? nil : $0.jsTrimmed() },
        avatar: a["avatar"].truthy)
    }
    var text = rec?["text"]?.stringValue ?? ""
    let limit = compact ? 140 : previewChars
    let scalars = Array(text.unicodeScalars)
    if scalars.count > limit {
      var cut = String.UnicodeScalarView()
      cut.append(contentsOf: scalars.prefix(limit - 1))
      text = "\(String(cut).jsTrimmingEnd())…"
    }
    var counts: PostPreviewCounts?
    if let view, view.isTruthy {
      func count(_ key: String) -> JSONValue { view[key].truthy ?? 0 }
      counts = PostPreviewCounts(
        replies: count("replyCount"), reposts: count("repostCount"), likes: count("likeCount"),
        quotes: count("quoteCount"))
    }
    let handle = author?.handle?.truthy.map(\.jsString)
    return PostPreviewModel(
      uri: postUri,
      url: postUri == nil ? nil : PostLink.bskyUrlFor(postUri?.stringValue, handle),
      author: author,
      text: text,
      at: rec?["createdAt"].truthy ?? view?["indexedAt"].truthy,
      embed: embedSummary(view?["embed"], locale: locale) ?? embedSummary(rec?["embed"], locale: locale),
      counts: counts,
      isReply: rec?["reply"]?.isTruthy ?? false)
  }
}
