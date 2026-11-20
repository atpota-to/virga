// Ports src/posting/lib/embeds.js
//
// The embed a post carries, built from the composer's attachments over blobs
// already uploaded as the write account. A post has one record slot (a quoted
// post, a feed, a list or a starter pack) and one media slot; when both are
// filled they go out together as recordWithMedia. Media precedence is video,
// then images, then a link card.
//
// Embeds are lexicon objects of several shapes, built here as JSONValue with
// exactly the web's keys (a missing value is left out, as JSON.stringify
// leaves out undefined). Inputs are read as loosely as the web reads them.

import Foundation
import VirgaCore

public enum Embeds {
  /// `{ $type: 'app.bsky.embed.record', record: { uri, cid } }`.
  public static func buildRecordEmbed(_ record: JSONValue) -> JSONValue {
    var ref: [String: JSONValue] = [:]
    ref["uri"] = record["uri"]
    ref["cid"] = record["cid"]
    return ["$type": "app.bsky.embed.record", "record": .object(ref)]
  }

  public static func buildRecordEmbed(uri: String, cid: String) -> JSONValue {
    buildRecordEmbed(["uri": .string(uri), "cid": .string(cid)])
  }

  /// Wrap a record embed with media if there is any.
  public static func combineRecordWithMedia(_ recordEmbed: JSONValue, _ mediaEmbed: JSONValue?) -> JSONValue {
    guard let mediaEmbed, mediaEmbed.isTruthy else { return recordEmbed }
    return ["$type": "app.bsky.embed.recordWithMedia", "record": recordEmbed, "media": mediaEmbed]
  }

  static func ratio(_ aspectRatio: JSONValue?) -> JSONValue? {
    guard let aspectRatio, aspectRatio.isTruthy else { return nil }
    let width = aspectRatio["width"].jsNumber
    let height = aspectRatio["height"].jsNumber
    guard width > 0, height > 0 else { return nil }
    return ["width": .number(width.jsRounded), "height": .number(height.jsRounded)]
  }

  static func orEmpty(_ value: JSONValue?) -> JSONValue {
    guard let value, value.isTruthy else { return "" }
    return value
  }

  /// A video embed. `aspectRatio` only with both sides known.
  public static func buildVideoEmbed(blob: JSONValue?, alt: JSONValue? = nil, aspectRatio: JSONValue? = nil) -> JSONValue {
    var embed: [String: JSONValue] = ["$type": "app.bsky.embed.video", "alt": orEmpty(alt)]
    embed["video"] = blob
    if let r = ratio(aspectRatio) { embed["aspectRatio"] = r }
    return .object(embed)
  }

  /// One image of an images embed. `blob` is already a blob.
  public static func buildImageRecord(alt: JSONValue? = nil, blob: JSONValue?, aspectRatio: JSONValue? = nil) -> JSONValue {
    var rec: [String: JSONValue] = ["alt": orEmpty(alt)]
    rec["image"] = blob
    if let r = ratio(aspectRatio) { rec["aspectRatio"] = r }
    return .object(rec)
  }

  public static func buildImagesEmbed(_ imageRecords: [JSONValue]) -> JSONValue {
    ["$type": "app.bsky.embed.images", "images": .array(imageRecords)]
  }

  /// A link card embed. `thumbBlob` is the uploaded thumbnail, or nil for a
  /// card without one.
  public static func buildExternalEmbed(_ card: JSONValue, _ thumbBlob: JSONValue? = nil) -> JSONValue {
    var external: [String: JSONValue] = [
      "title": orEmpty(card["title"]),
      "description": orEmpty(card["description"]),
    ]
    external["uri"] = card["url"]
    if let thumbBlob, thumbBlob.isTruthy { external["thumb"] = thumbBlob }
    // Kept even on a retitled card: the refs describe the page.
    if let refs = normalizeAssociatedRefs(card["associatedRefs"]) { external["associatedRefs"] = .array(refs) }
    return ["$type": "app.bsky.embed.external", "external": .object(external)]
  }

  /// getEmbedExternalView resolves at most four AT-URIs per card.
  public static let maxAssociatedRefs = 4

  /// `external.associatedRefs`: strongRefs to the records behind a linked
  /// page, coerced to `at://` URIs with a CID, deduped, capped; nil when
  /// there are none. This is linkCard.js's `normalizeAssociatedRefs`
  /// (src/posting/lib/linkCard.js, ported whole with the publish domain),
  /// which embeds.js imports.
  public static func normalizeAssociatedRefs(_ raw: JSONValue?) -> [JSONValue]? {
    guard case .array(let items)? = raw else { return nil }
    var refs: [JSONValue] = []
    var uris: [String] = []
    for item in items {
      switch item {
      case .object, .array: break
      default: continue
      }
      let uri = item["uri"]?.stringValue?.jsTrimmed() ?? ""
      let cid = item["cid"]?.stringValue?.jsTrimmed() ?? ""
      if !PostingJS.hasPrefix(uri, "at://") || cid.isEmpty { continue }
      if uris.contains(where: { $0.utf16.elementsEqual(uri.utf16) }) { continue }
      uris.append(uri)
      refs.append(["$type": "com.atproto.repo.strongRef", "uri": .string(uri), "cid": .string(cid)])
      if refs.count == maxAssociatedRefs { break }
    }
    return refs.isEmpty ? nil : refs
  }

  /// `value[index]` as JavaScript reads it: an array's element, a string's
  /// code unit as a one-unit string, or an object's member named by the
  /// index; nil (undefined) otherwise.
  static func element(_ value: JSONValue?, _ index: Int) -> JSONValue? {
    switch value {
    case .array(let items)? where items.indices.contains(index): return .some(items[index])
    case .string(let text)? where index >= 0 && index < text.jsLength: return .some(.string(text.jsCharAt(index)))
    case .object(let members)?: return members[String(index)]
    default: return .none
    }
  }

  /// `value?.length > 0` as JavaScript reads it: an array's or a string's
  /// length, or an object's `length` member compared as a number (so
  /// `{ length: 2, 0: blob }` has one); nothing else has a length.
  static func hasLength(_ value: JSONValue?) -> Bool {
    switch value {
    case .array(let a)?: return !a.isEmpty
    case .string(let s)?: return !s.isEmpty
    case .object(let members)?: return members["length"].jsNumber > 0
    default: return false
    }
  }

  /// A post's embed, or nil for none.
  ///
  /// - Parameters:
  ///   - post: a PostDraft (`video`, `images`, `card`, `record`).
  ///   - blobs: what was uploaded for it as the write account:
  ///     `{ images: [blob] (in the post's image order), video, cardThumb }`.
  public static func buildPostEmbed(_ post: JSONValue?, _ blobs: JSONValue? = nil) -> JSONValue? {
    let blobs = blobs ?? [:]
    var media: JSONValue?
    if let video = post?["video"], video.isTruthy, let blob = blobs["video"], blob.isTruthy {
      media = buildVideoEmbed(blob: blob, alt: video["alt"], aspectRatio: video["aspectRatio"])
    } else if hasLength(post?["images"]), hasLength(blobs["images"]), let images = post?["images"]?.arrayValue {
      media = buildImagesEmbed(
        images.enumerated().map { index, image in
          buildImageRecord(alt: image["alt"], blob: element(blobs["images"], index), aspectRatio: image["aspectRatio"])
        })
    } else if let card = post?["card"], let url = card["url"], url.isTruthy {
      let thumb = blobs["cardThumb"]
      media = buildExternalEmbed(card, thumb?.isTruthy == true ? thumb : nil)
    }

    if let record = post?["record"], record["uri"]?.isTruthy == true, record["cid"]?.isTruthy == true {
      return combineRecordWithMedia(buildRecordEmbed(record), media)
    }
    return media
  }

  /// Rewrite app.bsky.embed.gallery (and its #view) as the images shape, so
  /// one renderer handles both; also the media side of recordWithMedia.
  /// Other embeds pass through.
  public static func normalizeImageEmbed(_ embed: JSONValue?) -> JSONValue? {
    guard let embed, embed.isTruthy, let type = embed["$type"], type.isTruthy else { return embed }
    let typeName = type.stringValue
    let items = embed["items"]?.arrayValue ?? []

    if typeName == "app.bsky.embed.gallery#view" {
      var out = embed
      out["$type"] = "app.bsky.embed.images#view"
      out["images"] = .array(
        items.map { item in
          var image: [String: JSONValue] = ["alt": orEmpty(item["alt"])]
          image["thumb"] = item["thumbnail"]
          image["fullsize"] = item["fullsize"]
          image["aspectRatio"] = item["aspectRatio"]
          return .object(image)
        })
      return out
    }

    if typeName == "app.bsky.embed.gallery" {
      var out = embed
      out["$type"] = "app.bsky.embed.images"
      out["images"] = .array(
        items.map { item in
          var image: [String: JSONValue] = ["alt": orEmpty(item["alt"])]
          image["image"] = item["image"]
          image["aspectRatio"] = item["aspectRatio"]
          return .object(image)
        })
      return out
    }

    let mediaType = embed["media"]?["$type"]?.stringValue
    if typeName == "app.bsky.embed.recordWithMedia#view" || typeName == "app.bsky.embed.recordWithMedia",
      mediaType == "app.bsky.embed.gallery#view" || mediaType == "app.bsky.embed.gallery"
    {
      var out = embed
      out["media"] = normalizeImageEmbed(embed["media"]) ?? .null
      return out
    }
    return embed
  }
}
