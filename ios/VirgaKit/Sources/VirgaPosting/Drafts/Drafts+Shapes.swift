// Ports src/posting/drafts/drafts.js
//
// The two shapes of a draft: a ComposerState written as Bluesky's draft
// (app.bsky.draft.defs#draft, with Anisota's fields and Virga's `virgaCard`
// beside the lexicon's on each post), a draft read back as a ComposerState,
// what a drafts list shows for one, and the paths a draft names. All pure:
// JSONValue in, JSONValue out, with the web's members.

import Foundation
import VirgaCore
import VirgaNetwork

extension Drafts {
  static let draftType = "app.bsky.draft.defs#draft"
  static let draftPostType = "app.bsky.draft.defs#draftPost"
  static let recordType = "app.bsky.embed.record"
  static let recordWithMediaType = "app.bsky.embed.recordWithMedia"
  static let imagesType = "app.bsky.embed.images"
  static let videoType = "app.bsky.embed.video"
  static let externalType = "app.bsky.embed.external"
  static let bskyCdn = "https://cdn.bsky.app"

  /// The post's field for what a draft's card can't otherwise keep:
  /// `{ thumb?: https URL, edited?: true }`.
  static let cardExtra = "virgaCard"

  static func str(_ value: JSONValue?) -> String { value?.stringValue ?? "" }

  static func isObject(_ value: JSONValue?) -> Bool { ComposerJS.isObject(value) }

  /// `isBlob(blob) && blobDid === owner` (`owner` null for none).
  static func owned(_ blob: JSONValue?, _ blobDid: JSONValue?, _ owner: JSONValue) -> Bool {
    Blobs.isBlob(blob) && ComposerJS.strictEquals(blobDid, owner)
  }

  /// `{ width, height }` rounded, when both are over 0; nil otherwise.
  static func aspect(_ value: JSONValue?) -> JSONValue? {
    guard let value, isObject(value) else { return nil }
    guard ComposerJS.greater(value["width"], .number(0)), ComposerJS.greater(value["height"], .number(0)) else {
      return nil
    }
    return ["width": .number(value["width"].jsNumber.jsRounded), "height": .number(value["height"].jsNumber.jsRounded)]
  }

  /// `typeof value === 'string' && value` parsed as a URL, kept when it is https.
  static func httpsUrl(_ value: JSONValue?) -> String? {
    guard let text = value?.stringValue, !text.isEmpty, let url = try? WHATWGURL(text) else { return nil }
    return url.protocolString == "https:" ? url.href : nil
  }

  /// The CDN's image for a blob of `did`'s, or nil.
  static func cdnImage(_ did: String?, _ cid: JSONValue?, size: String = "feed_thumbnail") -> String? {
    guard let did, !did.isEmpty, let cid, cid.isTruthy else { return nil }
    return "\(bskyCdn)/img/\(size)/plain/\(did)/\(cid.jsString)@jpeg"
  }

  /// `isBlob(blob) ? toJsonShape(blob) : null`.
  static func plainBlob(_ blob: JSONValue?) -> JSONValue? { Blobs.isBlob(blob) ? blob : nil }

  // MARK: Composer state → draft

  static func textProblem(_ text: String, _ index: Int, locale: String?) -> DraftsError? {
    if Graphemes.countGraphemes(text) > limits.textGraphemes || text.utf8.count > limits.textBytes {
      let count = AppLocale.formatNumber(limits.textGraphemes, locale: locale)
      return DraftsError(
        "Post \(index + 1) is longer than a draft can hold (\(count) characters).", code: "DRAFT_TOO_LONG",
        postIndex: index)
    }
    return nil
  }

  /// What Anisota reads: the post's embed as it would be published, with
  /// blobs only where this account already holds them.
  static func extensionEmbed(_ post: JSONValue, _ owner: JSONValue) -> JSONValue? {
    var media: JSONValue?
    let video = post["video"]
    let images = ComposerJS.list(ComposerJS.or(post["images"], nil))
    if let video, video.isTruthy, owned(video["blob"], video["blobDid"], owner) {
      var embed: JSONValue = ["$type": .string(videoType), "video": video["blob"] ?? .null]
      if let alt = video["alt"], alt.isTruthy { embed["alt"] = alt }
      if let ar = aspect(video["aspectRatio"]) { embed["aspectRatio"] = ar }
      media = embed
    } else if !(video?.isTruthy ?? false), !images.isEmpty,
      images.allSatisfy({ owned($0["blob"], $0["blobDid"], owner) })
    {
      media = [
        "$type": .string(imagesType),
        "images": .array(
          images.prefix(limits.images).map { image in
            var out: JSONValue = ["image": image["blob"] ?? .null, "alt": .string(str(image["alt"]))]
            if let ar = aspect(image["aspectRatio"]) { out["aspectRatio"] = ar }
            return out
          }),
      ]
    } else if !(video?.isTruthy ?? false), images.isEmpty, let card = post["card"], let url = card["url"], url.isTruthy {
      var external: JSONValue = [
        "uri": url, "title": .string(str(card["title"])), "description": .string(str(card["description"])),
      ]
      if owned(card["thumbBlob"], card["thumbBlobDid"], owner) { external["thumb"] = card["thumbBlob"] }
      media = ["$type": .string(externalType), "external": external]
    }
    var record: JSONValue?
    if let ref = post["record"], ref["uri"]?.isTruthy == true, ref["cid"]?.isTruthy == true {
      record = ["$type": .string(recordType), "record": ["uri": ref["uri"]!, "cid": ref["cid"]!]]
    }
    if let record, let media { return ["$type": .string(recordWithMediaType), "record": record, "media": media] }
    return record ?? media
  }

  static func draftPost(
    _ post: JSONValue, _ text: JSONValue, index: Int, tags: [String], selfLabels: JSONValue?, reply: JSONValue?,
    owner: JSONValue, locale: String?
  ) throws -> JSONValue {
    let words = str(text["text"])
    var out: JSONValue = ["$type": .string(draftPostType), "text": .string(words)]
    if let problem = textProblem(words, index, locale: locale) { throw problem }
    if let selfLabels { out["labels"] = selfLabels }

    let images = ComposerJS.list(ComposerJS.or(post["images"], nil)).filter { $0["localRef"]?.isTruthy == true }
      .prefix(limits.images)
    if !images.isEmpty {
      out["embedImages"] = .array(
        images.map { image in
          var embed: JSONValue = [
            "$type": "app.bsky.draft.defs#draftEmbedImage", "localRef": ["path": image["localRef"] ?? .null],
          ]
          if let alt = image["alt"], alt.isTruthy { embed["alt"] = alt }
          return embed
        })
    }
    if let video = post["video"], let ref = video["localRef"], ref.isTruthy {
      var embed: JSONValue = ["$type": "app.bsky.draft.defs#draftEmbedVideo", "localRef": ["path": ref]]
      if let alt = video["alt"], alt.isTruthy { embed["alt"] = alt }
      out["embedVideos"] = [embed]
    }
    if let card = post["card"], let url = card["url"], url.isTruthy {
      out["embedExternals"] = [["$type": "app.bsky.draft.defs#draftEmbedExternal", "uri": url]]
      // A card image that isn't uploaded yet is only an address (the card
      // service's), and whether the writer edited the card isn't a field of
      // either shape. Both ride on the post, beside `embed` rather than in
      // it, so nothing that publishes an `embed` as it stands carries them out.
      var extra: [String: JSONValue] = [:]
      let thumbUrl = owned(card["thumbBlob"], card["thumbBlobDid"], owner) ? nil : httpsUrl(card["thumb"])
      if let thumbUrl { extra["thumb"] = .string(thumbUrl) }
      if card["edited"]?.isTruthy == true { extra["edited"] = true }
      if !extra.isEmpty { out[cardExtra] = .object(extra) }
    }
    if let ref = post["record"], ref["uri"]?.isTruthy == true, ref["cid"]?.isTruthy == true {
      out["embedRecords"] = [
        ["$type": "app.bsky.draft.defs#draftEmbedRecord", "record": ["uri": ref["uri"]!, "cid": ref["cid"]!]]
      ]
    }

    if let facets = text["facets"]?.arrayValue, !facets.isEmpty { out["facets"] = .array(facets) }
    if !tags.isEmpty { out["tags"] = .array(tags.map(JSONValue.string)) }
    if let embed = extensionEmbed(post, owner) { out["embed"] = embed }
    if let reply { out["reply"] = reply }
    return out
  }

  /// The draft a ComposerState saves as. `texts` are resolvePostTexts'
  /// output, one `{ text, facets }` per post (so mentions, inline links and
  /// shortened links are written as a post would carry them). Media must
  /// already have `localRef`s (storeDraftMedia) or this account's blobs;
  /// anything else is left out. Tags and labels go on every post, as a
  /// published thread carries them. Reply and quote settings are kept only
  /// when chosen for this post (`gates.custom`, which always writes
  /// `postgateEmbeddingRules`); otherwise the draft follows the account's
  /// defaults when it's opened again. Throws `DRAFT_TOO_LONG` for a post
  /// over 1,000 characters (the count written in `locale`, nil the active one).
  public static func composerStateToDraft(
    _ state: JSONValue?, texts: [JSONValue] = [], deviceId: String? = nil, deviceName: String? = nil,
    owner: String? = nil, locale: String? = nil
  ) throws -> JSONValue {
    let ownerDid: JSONValue = owner.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? state?["asDid"].truthy ?? .null
    let posts = Array(ComposerJS.list(ComposerJS.or(state?["posts"], nil)).prefix(limits.posts))
    if posts.isEmpty { throw DraftsError("A draft needs a post.") }
    let tags = Tags.normalizeTags(ComposerJS.or(state?["tags"], nil) ?? [])
    let selfLabels = ComposerModel.labelsToSelfLabels(ComposerJS.or(state?["labels"], nil) ?? [])
    var reply: JSONValue?
    if let r = state?["reply"], r["uri"]?.isTruthy == true, r["cid"]?.isTruthy == true {
      var root: [String: JSONValue] = [:]
      if r["root"]?["uri"]?.isTruthy == true {
        root["uri"] = r["root"]?["uri"]
        root["cid"] = r["root"]?["cid"]
      } else {
        root["uri"] = r["uri"]
        root["cid"] = r["cid"]
      }
      reply = ["root": .object(root), "parent": ["uri": r["uri"]!, "cid": r["cid"]!]]
    }

    let name = (deviceName ?? "").jsSlice(0, 100)
    var draft: JSONValue = [
      "$type": .string(draftType),
      "deviceName": .string(name.isEmpty ? deviceNameDefault : name),
      "posts": .array(
        try posts.enumerated().map { index, post in
          let given: JSONValue? = index < texts.count && texts[index].isTruthy ? texts[index] : JSONValue?.none
          let text: JSONValue = given ?? ["text": post["text"].truthy ?? "", "facets": []]
          return try draftPost(
            post, text, index: index, tags: tags, selfLabels: selfLabels, reply: index == 0 ? reply : nil,
            owner: ownerDid, locale: locale)
        }),
    ]
    if let deviceId, isUUIDv4(deviceId) { draft["deviceId"] = .string(deviceId) }
    let langs = ComposerJS.list(ComposerJS.or(state?["langs"], nil)).filter { $0.stringValue?.isEmpty == false }
      .prefix(limits.langs)
    if !langs.isEmpty { draft["langs"] = .array(Array(langs)) }
    // A reply carries no gates: they belong to the thread's root.
    if let gates = state?["gates"], gates["custom"]?.isTruthy == true, reply == nil {
      let rules = Gates.gatesToRules(gates)
      if let allow = rules.threadgateAllow { draft["threadgateAllow"] = .array(allow) }
      // Always written for a choice made for this post, empty when quoting
      // is allowed: with neither field, "anyone can reply and quote" would
      // read back as "use my defaults".
      draft["postgateEmbeddingRules"] = .array(rules.postgateEmbeddingRules ?? [])
    }
    return draft
  }

  // MARK: Draft → composer state

  /// Splits a stored embed into its record and media halves.
  static func embedParts(_ embed: JSONValue?) -> (record: JSONValue?, media: JSONValue?) {
    guard let embed, isObject(embed) else { return (nil, nil) }
    if embed["$type"]?.stringValue == recordType { return (embed["record"], nil) }
    if embed["$type"]?.stringValue == recordWithMediaType {
      return (embed["record"]?["record"].truthy, embed["media"].truthy)
    }
    return (nil, embed)
  }

  static let atCollection = JSRegex(#"^at://[^/]+/([^/]+)/"#)

  /// `{ kind, uri, cid }` for a ref to a record the composer can attach, or nil.
  static func recordAttachment(_ ref: JSONValue?) -> JSONValue? {
    guard let ref, let uri = ref["uri"], uri.isTruthy else { return nil }
    let text = uri.jsString
    let collection = atCollection.firstMatch(in: text)?.group(1, in: Array(text.utf16))
    guard let kind = PostLink.kindForCollection(collection) else { return nil }
    return ["kind": .string(kind), "uri": uri, "cid": ref["cid"].truthy ?? .null]
  }

  static func readImages(_ post: JSONValue, _ media: JSONValue?, _ owner: String?, readId: (String) -> String)
    -> [JSONValue]
  {
    let stored = media?["$type"]?.stringValue == imagesType ? media?["images"]?.arrayValue ?? [] : []
    let local = post["embedImages"]?.arrayValue ?? []
    let count = Swift.min(limits.images, Swift.max(local.count, stored.count))
    var out: [JSONValue] = []
    for i in 0..<count {
      let ref: JSONValue? = i < local.count ? local[i] : nil
      // Blob halves line up with local ones only when both lists are whole.
      let fromEmbed: JSONValue? = (local.isEmpty || local.count == stored.count) && i < stored.count ? stored[i] : nil
      let blob = plainBlob(fromEmbed?["image"])
      let path = ref?["localRef"]?["path"]
      if !(path?.isTruthy ?? false) && blob == nil { continue }
      var image: JSONValue = [
        "id": .string(readId("image")),
        "mime": blob?["mimeType"].truthy ?? "",
        "size": blob?["size"].truthy ?? 0,
        "alt": .string(str(ref?["alt"]).isEmpty ? str(fromEmbed?["alt"]) : str(ref?["alt"])),
      ]
      if let path, path.isTruthy { image["localRef"] = path }
      if let blob {
        image["blob"] = blob
        if let owner { image["blobDid"] = .string(owner) }
        image["previewUrl"] = cdnImage(owner, Blobs.blobCid(blob)).map(JSONValue.string) ?? .null
      }
      if let ar = aspect(fromEmbed?["aspectRatio"]) { image["aspectRatio"] = ar }
      out.append(image)
    }
    return out
  }

  static func readVideo(_ post: JSONValue, _ media: JSONValue?, _ owner: String?) -> JSONValue? {
    let stored: JSONValue? = media?["$type"]?.stringValue == videoType ? media : nil
    let local: JSONValue? = post["embedVideos"]?.arrayValue.flatMap { $0.first }
    let blob = plainBlob(stored?["video"])
    let path = local?["localRef"]?["path"]
    if !(path?.isTruthy ?? false) && blob == nil { return nil }
    var video: JSONValue = [
      "mime": blob?["mimeType"].truthy ?? "",
      "size": blob?["size"].truthy ?? 0,
      "alt": .string(str(local?["alt"]).isEmpty ? str(stored?["alt"]) : str(local?["alt"])),
      "status": .string(blob != nil ? "ready" : "idle"),
    ]
    if let path, path.isTruthy { video["localRef"] = path }
    if let blob {
      video["blob"] = blob
      if let owner { video["blobDid"] = .string(owner) }
    }
    if let ar = aspect(stored?["aspectRatio"]) { video["aspectRatio"] = ar }
    return video
  }

  static func readCard(_ post: JSONValue, _ media: JSONValue?, _ owner: String?) -> JSONValue? {
    let extra: JSONValue = isObject(post[cardExtra]) ? post[cardExtra]! : [:]
    let thumbUrl = httpsUrl(extra["thumb"])
    guard var card = readCardFields(post, media, owner, thumbUrl) else { return nil }
    if extra["edited"] == .bool(true) { card["edited"] = true }
    return card
  }

  static func readCardFields(_ post: JSONValue, _ media: JSONValue?, _ owner: String?, _ thumbUrl: String?)
    -> JSONValue?
  {
    if media?["$type"]?.stringValue == externalType, let external = media?["external"], let uri = external["uri"],
      uri.isTruthy
    {
      let thumbBlob = plainBlob(external["thumb"])
      let thumb = thumbBlob != nil ? cdnImage(owner, Blobs.blobCid(thumbBlob)) : thumbUrl
      var card: JSONValue = [
        "url": uri, "title": .string(str(external["title"])), "description": .string(str(external["description"])),
        "thumb": thumb.map(JSONValue.string) ?? .null,
      ]
      if let thumbBlob {
        card["thumbBlob"] = thumbBlob
        if let owner { card["thumbBlobDid"] = .string(owner) }
      }
      return card
    }
    // Only the address survives in the lexicon's field (a draft from
    // Bluesky's app): openDraft reads the rest of the card again from it.
    guard let uri = post["embedExternals"]?.arrayValue?.first?["uri"]?.stringValue, !uri.isEmpty else { return nil }
    return ["url": .string(uri), "title": "", "description": "", "thumb": thumbUrl.map(JSONValue.string) ?? .null]
  }

  static func readPost(_ post: JSONValue?, _ owner: String?, readId: (String) -> String) -> JSONValue {
    let (record, media) = embedParts(post?["embed"])
    let fromRecords = post?["embedRecords"]?.arrayValue.flatMap { $0.first?["record"] } ?? nil
    let facets = post?["facets"]?.arrayValue ?? []
    let text = facets.isEmpty ? str(post?["text"]) : InlineLinks.composerTextFromRecord(str(post?["text"]), facets)
    let body = post ?? [:]
    var out = ComposerModel.emptyPost().json
    out["text"] = .string(text)
    out["images"] = .array(readImages(isObject(body) ? body : [:], media, owner, readId: readId))
    out["video"] = readVideo(isObject(body) ? body : [:], media, owner) ?? .null
    out["record"] = recordAttachment(record) ?? recordAttachment(fromRecords) ?? .null
    out["card"] = readCard(isObject(body) ? body : [:], media, owner) ?? .null
    return out
  }

  /// A draft as the composer holds it, for `asDid` (the account whose draft
  /// it is). Starts from `emptyComposerState({ asDid, defaults })`, so what
  /// the draft doesn't say (no languages, no reply settings) comes from the
  /// account's defaults. Media come back as `localRef`s (and blobs, where
  /// the draft carries them); loadDraftMedia fills in the files this device
  /// holds. A post being replied to comes back as `{ uri, cid, root }`, for
  /// the composer to read again. `readId` names each image read (the web's
  /// `image-<now in base 36>-<n>`).
  public static func draftToComposerState(
    _ draftView: JSONValue?, asDid: String?, defaults: JSONValue? = nil,
    readId: (String) -> String = { Drafts.readId($0) }
  ) -> JSONValue {
    var state = ComposerModel.emptyComposerState(asDid: asDid.map(JSONValue.string), defaults: defaults).json
    let draft: JSONValue = isObject(draftView?["draft"]) ? draftView!["draft"]! : [:]
    let posts = Array((draft["posts"]?.arrayValue ?? []).prefix(limits.posts))
    let first: JSONValue = posts.first.flatMap { $0.isTruthy ? $0 : JSONValue?.none } ?? [:]
    if !posts.isEmpty { state["posts"] = .array(posts.map { readPost($0, asDid, readId: readId) }) }
    if let parent = first["reply"]?["parent"], let uri = parent["uri"], uri.isTruthy {
      var root: JSONValue = ["uri": uri, "cid": parent["cid"].truthy ?? .null]
      if let r = first["reply"]?["root"], let rootUri = r["uri"], rootUri.isTruthy {
        root = ["uri": rootUri, "cid": r["cid"].truthy ?? .null]
      }
      state["reply"] = ["uri": uri, "cid": parent["cid"].truthy ?? .null, "root": root]
    } else {
      state["reply"] = .null
    }
    state["tags"] = .array(Tags.normalizeTags(first["tags"]?.arrayValue.map(JSONValue.array) ?? []).map(JSONValue.string))
    state["labels"] = .array(ComposerModel.selfLabelsToLabels(first["labels"]).map(JSONValue.string))
    state["source"] = [
      "kind": "draft", "id": draftView?["id"].truthy ?? .null,
      "ownerDid": asDid.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null,
    ]
    let langs = (draft["langs"]?.arrayValue ?? []).filter { $0.stringValue?.isEmpty == false }.prefix(limits.langs)
    if !langs.isEmpty { state["langs"] = .array(Array(langs)) }
    if draft["threadgateAllow"]?.arrayValue != nil || draft["postgateEmbeddingRules"]?.arrayValue != nil {
      var gates = Gates.gatesFromRules(draft).json
      gates["custom"] = true
      state["gates"] = gates
    }
    return state
  }

  static let readIds = Locked(0)

  /// `${prefix}-${Date.now().toString(36)}-${++readIds}`.
  public static func readId(_ prefix: String, now: Double = Date().timeIntervalSince1970 * 1000) -> String {
    let n = readIds.withLock { value -> Int in
      value += 1
      return value
    }
    return "\(prefix)-\(String(Int64(now.rounded(.down)), radix: 36))-\(n)"
  }

  // MARK: List rows

  /// Every localRef path a draft names (any truthy value the draft holds there).
  public static func draftLocalRefs(_ draftView: JSONValue?) -> [JSONValue] {
    var refs: [JSONValue] = []
    for post in draftView?["draft"]?["posts"]?.arrayValue ?? [] {
      for image in post["embedImages"]?.arrayValue ?? [] {
        if let path = image["localRef"]?["path"], path.isTruthy { refs.append(path) }
      }
      for video in post["embedVideos"]?.arrayValue ?? [] {
        if let path = video["localRef"]?["path"], path.isTruthy { refs.append(path) }
      }
    }
    return refs
  }

  /// `(value || []).length` as JavaScript reads it: an array's or a
  /// string's length, NaN for anything truthy without one.
  static func looseLength(_ value: JSONValue?) -> Double {
    guard let value, value.isTruthy else { return 0 }
    switch value {
    case .array(let items): return Double(items.count)
    case .string(let text): return Double(text.utf16.count)
    default: return .nan
    }
  }

  /// What a drafts list shows for one draft, without opening it: `{ id,
  /// text, posts, isThread, isReply, tags, langs, images, video, link,
  /// record, labels, createdAt, updatedAt, deviceName, savedHere,
  /// mediaElsewhere, view }`. `savedHere` is true when this device saved it
  /// (its `deviceId` is `deviceId`); `mediaElsewhere` when it names media
  /// this device didn't keep, so opening it here will ask for them again.
  public static func summarizeDraft(_ draftView: JSONValue?, deviceId: String? = nil) -> JSONValue {
    let draft: JSONValue = isObject(draftView?["draft"]) ? draftView!["draft"]! : [:]
    let posts = draft["posts"]?.arrayValue ?? []
    let first: JSONValue = posts.first.flatMap { $0.isTruthy ? $0 : JSONValue?.none } ?? [:]
    let (record, media) = embedParts(first["embed"])
    let localImages = looseLength(first["embedImages"])
    let storedImages = media?["$type"]?.stringValue == imagesType ? looseLength(media?["images"]) : 0
    let savedHere = deviceId.map { !$0.isEmpty && draft["deviceId"]?.stringValue?.jsEquals($0) == true } ?? false
    let refs = draftLocalRefs(draftView)
    let images = localImages.isNaN || storedImages.isNaN ? Double.nan : Swift.max(localImages, storedImages)
    let videos = looseLength(first["embedVideos"])
    let link: JSONValue? =
      media?["$type"]?.stringValue == externalType
      ? media?["external"]?["uri"] : first["embedExternals"]?.arrayValue?.first?["uri"]
    return [
      "id": draftView?["id"].truthy ?? .null,
      "text": .string(str(first["text"])),
      "posts": .number(Double(posts.count)),
      "isThread": .bool(posts.count > 1),
      "isReply": .bool(first["reply"]?["parent"]?["uri"]?.isTruthy == true),
      "tags": .array(Tags.normalizeTags(first["tags"]?.arrayValue.map(JSONValue.array) ?? []).map(JSONValue.string)),
      "langs": draft["langs"]?.arrayValue.map(JSONValue.array) ?? [],
      "labels": .array(ComposerModel.selfLabelsToLabels(first["labels"]).map(JSONValue.string)),
      "images": images.isNaN ? .null : .number(images),
      "video": .bool(videos != 0 && !videos.isNaN || media?["$type"]?.stringValue == videoType),
      "link": link.truthy ?? .null,
      "record": recordAttachment(record) ?? recordAttachment(first["embedRecords"]?.arrayValue?.first?["record"]) ?? .null,
      "createdAt": draftView?["createdAt"].truthy ?? .null,
      "updatedAt": draftView?["updatedAt"].truthy ?? draftView?["createdAt"].truthy ?? .null,
      "deviceName": draft["deviceName"]?.stringValue.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null,
      "savedHere": .bool(savedHere),
      "mediaElsewhere": .bool(!refs.isEmpty && !savedHere),
      "view": draftView ?? .null,
    ]
  }
}
