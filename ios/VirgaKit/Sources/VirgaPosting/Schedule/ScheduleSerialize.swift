// Ports src/posting/schedule/scheduleSerialize.js
//
// The composer's state as Virga's server's scheduling body, and a scheduled
// row back as composer state (ScheduleSerialize+Reconstruct.swift). The two
// are a pair: whatever a row holds must come back into the composer so that
// saving it again writes the same row.
//
// The server stores the body and its worker writes each post later, as the
// account, with no one at the keyboard. So everything the worker can't do
// is refused here: video (it can't upload one), a reply in the weekly queue
// (a reply answers one post at one moment, so it takes a time of its own),
// and a reply or a queued post that repeats. Images travel as base64 and are
// uploaded only when the post goes out, because a PDS drops blobs no record
// points at.
//
// A reply carries the root and parent strong refs (`payload.reply`), which
// the worker writes into the record after checking the parent is still
// there, and a note of who it answers (`payload.replyTo`) for the Scheduled
// page. A repeating post carries its rule (`payload.repeat`, Repeat).
//
// The text pipeline and the embed rules are the ones publishing uses
// (resolvePostTexts, buildPostEmbed), so a scheduled post comes out as the
// same record a live one would.
//
// Files are ComposerFiles' (the web's File and Blob): an image's bytes are
// read through `media.files`, a card's own image is re-encoded by
// `media.encoder` on `media.clock`. The web's `signal` is the task's
// cancellation. Where the web throws a TypeError reading a file that isn't
// one (`blob.arrayBuffer is not a function`), the port throws the same words.

import Foundation
import VirgaCore
import VirgaSession

/// A refusal from the serializer, coded for scheduleErrorMessage: QUEUE_REPLY,
/// REPLY_UNRESOLVED, REPEAT_REPLY, REPEAT_INVALID, SCHEDULE_VIDEO,
/// SCHEDULE_INVALID, SCHEDULE_PAST, SCHEDULE_TOO_FAR, EMPTY, IMAGE_MISSING,
/// IMAGE_TOO_LARGE, TOO_MANY_IMAGES, RECORD_UNRESOLVED, LIFESPAN or
/// MEDIA_TOO_LARGE, with the web's extra members (`postIndex`, `imageId`,
/// `size`, `limit`).
public struct ScheduleSerializeError: Error, LocalizedError, ScheduleErrorObject, JSErrorConvertible, Hashable,
  Sendable
{
  public let name = "ScheduleSerializeError"
  public var code: String
  public var message: String
  public var extra: [String: JSONValue]

  public init(_ code: String, _ message: String, _ extra: [String: JSONValue] = [:]) {
    self.code = code
    self.message = message
    self.extra = extra
  }

  public var postIndex: Int? { extra["postIndex"]?.intValue }
  public var errorDescription: String? { message }
  public var errorObject: JSONValue {
    var out = extra
    out["name"] = .string(name)
    out["message"] = .string(message)
    out["code"] = .string(code)
    return .object(out)
  }
  public var jsFields: JSErrorFields { JSErrorFields(name: name, message: message, code: .string(code)) }
}

/// A TypeError the web throws where a value isn't what it reads it as.
public struct ScheduleSerializeTypeError: Error, LocalizedError, ScheduleErrorObject, Hashable, Sendable {
  public var message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
  public var errorObject: JSONValue { ["name": "TypeError", "message": .string(message)] }
}

/// atob's refusal: a DOMException named InvalidCharacterError.
public struct Base64DecodeError: Error, LocalizedError, ScheduleErrorObject, Hashable, Sendable {
  public var message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
  public var errorObject: JSONValue { ["name": "InvalidCharacterError", "message": .string(message)] }
}

/// What serializeForSchedule is given besides the state (the web's
/// `options`). `now` is epoch ms; `scheduledFor` nil is the state's time
/// (`schedule.at`); `queued` nil is the state's mode; `tz` nil is the
/// device's zone; `repeat` nil (undefined) is the state's rule and `.null`
/// none; `repeatTz` nil is `tz`; `occurrence` nil is 1; `fit` nil is the
/// composer's fit for this post. `loadImage` gives the bytes of an image
/// without a `file` (one restored from a draft). `timeZone` is the device's
/// zone (nil: the active one): a time without an offset is read in it, and
/// a refusal's words are said in it, in `locale`.
public struct ScheduleSerializeOptions: Sendable {
  public var now: Double
  public var scheduledFor: JSONValue?
  public var queued: Bool?
  public var tz: String?
  public var `repeat`: JSONValue?
  public var repeatTz: String?
  public var occurrence: Double?
  public var resolveMention: ResolveMention?
  public var validationCache: MentionValidationCache
  public var fit: TimerFit?
  public var loadImage: (@Sendable (JSONValue) async throws -> ComposerFile?)?
  public var media: PublishMedia
  public var locale: String?
  public var timeZone: TimeZone?

  public init(
    now: Double, scheduledFor: JSONValue? = nil, queued: Bool? = nil, tz: String? = nil,
    repeat: JSONValue? = nil, repeatTz: String? = nil, occurrence: Double? = nil,
    resolveMention: ResolveMention? = nil, validationCache: MentionValidationCache = .shared, fit: TimerFit? = nil,
    loadImage: (@Sendable (JSONValue) async throws -> ComposerFile?)? = nil, media: PublishMedia,
    locale: String? = nil, timeZone: TimeZone? = nil
  ) {
    self.now = now
    self.scheduledFor = scheduledFor
    self.queued = queued
    self.tz = tz
    self.repeat = `repeat`
    self.repeatTz = repeatTz
    self.occurrence = occurrence
    self.resolveMention = resolveMention
    self.validationCache = validationCache
    self.fit = fit
    self.loadImage = loadImage
    self.media = media
    self.locale = locale
    self.timeZone = timeZone
  }
}

/// The body of `POST /api/schedule/create` (and of a content `update`):
/// `{ scheduledFor, target, queued, payload }`, with the composer's
/// `warnings` beside it (CARD_THUMB_FAILED: the card goes without its
/// image), which never reach the request.
public struct ScheduleBody: Hashable, Sendable {
  public var scheduledFor: String
  public var target: String
  public var queued: Bool
  public var payload: JSONValue
  public var warnings: [JSONValue]

  /// The body as the request carries it.
  public var json: JSONValue {
    ["scheduledFor": .string(scheduledFor), "target": .string(target), "queued": .bool(queued), "payload": payload]
  }
}

public enum ScheduleSerialize {
  /// Most base64 characters one body may carry. Vercel refuses a request
  /// body over 4.5 MB before the server sees it; base64 is 4/3 of the
  /// bytes, and the rest is room for the records.
  public static let maxMediaBase64Chars = 4_000_000

  /// The lexicon's ceiling for one post image.
  public static let maxImageBytes: Double = 2_000_000

  static let dayMs: Double = 24 * 60 * 60 * 1000

  static func refuse(_ code: String, _ message: String, _ extra: [String: JSONValue] = [:]) -> ScheduleSerializeError {
    ScheduleSerializeError(code, message, extra)
  }

  // MARK: base64

  /// A Blob's bytes as base64, without a `data:` prefix (btoa over the
  /// bytes as a binary string). The adviser's alt text sends an image this
  /// way too.
  public static func blobToBase64(_ bytes: Data) -> String {
    bytes.base64EncodedString()
  }

  /// blobToBase64 for a file, its bytes read through `files`.
  public static func blobToBase64(_ file: ComposerFile, files: any ComposerFiles) async throws -> String {
    blobToBase64(try await files.bytes(of: file))
  }

  /// `atob(value)` (Node's): the forgiving-base64 decode of `String(value)`,
  /// ASCII whitespace skipped and up to two trailing `=`. Throws
  /// Base64DecodeError with Node's words where it does.
  public static func atob(_ value: JSONValue?) throws -> Data {
    let input = value.map(\.jsString) ?? "undefined"
    var symbols: [UInt8] = []
    var significant = 0
    var equals = 0
    for unit in input.utf16 {
      switch unit {
      case 0x09, 0x0A, 0x0C, 0x0D, 0x20:
        continue
      case 0x3D:
        significant += 1
        equals += 1
        if equals > 2 { throw Base64DecodeError("Invalid character") }
      default:
        guard let v = base64Value(unit) else { throw Base64DecodeError("Invalid character") }
        significant += 1
        // The `=` char is only allowed at the end.
        if equals > 0 { throw Base64DecodeError("Invalid character") }
        symbols.append(v)
      }
    }
    var remainder = significant % 4
    if remainder == 0 {
      remainder = (significant - equals) % 4
    } else if equals > 0 {
      throw Base64DecodeError("Invalid character")
    }
    if remainder == 1 { throw Base64DecodeError("The string to be decoded is not correctly encoded.") }
    var out = Data()
    out.reserveCapacity(symbols.count * 3 / 4)
    var buffer: UInt32 = 0
    var bits = 0
    for v in symbols {
      buffer = (buffer << 6) | UInt32(v)
      bits += 6
      if bits >= 8 {
        bits -= 8
        out.append(UInt8((buffer >> UInt32(bits)) & 0xFF))
      }
    }
    return out
  }

  static func base64Value(_ unit: UInt16) -> UInt8? {
    switch unit {
    case 0x41...0x5A: return UInt8(unit - 0x41)
    case 0x61...0x7A: return UInt8(unit - 0x61 + 26)
    case 0x30...0x39: return UInt8(unit - 0x30 + 52)
    case 0x2B: return 62
    case 0x2F: return 63
    default: return nil
    }
  }

  /// A Blob's `type` as its constructor keeps it: '' when any character is
  /// outside U+0020–U+007E, else lower-cased.
  static func blobType(_ value: String) -> String {
    let units = Array(value.utf16)
    if units.contains(where: { $0 < 0x20 || $0 > 0x7E }) { return "" }
    return String(decoding: units.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 }, as: UTF16.self)
  }

  /// base64 back to a File of `type` (`type || 'application/octet-stream'`).
  public static func base64ToFile(_ base64: JSONValue?, _ type: JSONValue?, _ name: String, files: any ComposerFiles)
    async throws -> ComposerFile
  {
    let bytes = try atob(base64)
    let declared = ComposerJS.truthy(type) ? type!.jsString : "application/octet-stream"
    return try await files.makeFile(bytes, name: name, type: blobType(declared), lastModified: nil)
  }

  /// The device's zone as Intl names it.
  static func deviceTimeZone(_ zone: TimeZone?) -> String {
    PostingQueue.intlName(zone ?? AppLocale.activeTimeZone())
  }

  /// `(typeof type === 'string' && type.split('/')[1]) || 'jpg'`.
  static func extFor(_ type: JSONValue?) -> String {
    guard let text = type?.stringValue else { return "jpg" }
    let parts = PostingQueue.split(text, 0x2F)
    return parts.count > 1 && !parts[1].isEmpty ? parts[1] : "jpg"
  }

  // MARK: Serializing

  static func scheduledTime(_ state: ComposerState, _ options: ScheduleSerializeOptions) throws -> Double {
    let raw = ComposerJS.coalesce(options.scheduledFor, ComposerJS.coalesce(state.json["schedule"]?["at"], nil))
    let zone = options.timeZone ?? AppLocale.activeTimeZone()
    let ms: Double = ComposerJS.truthy(raw) ? JSDate.parse(raw!.jsString, timeZone: zone) : .nan
    if !ms.isFinite { throw refuse("SCHEDULE_INVALID", "Choose a time to post it.") }
    let nowMs = options.now
    if ms <= nowMs { throw refuse("SCHEDULE_PAST", "Choose a time in the future.") }
    if ms > nowMs + Double(PostingQueue.queueHorizonDays) * dayMs {
      throw refuse(
        "SCHEDULE_TOO_FAR", "Posts can be scheduled up to \(PostingQueue.queueHorizonDays) days ahead.")
    }
    return ms
  }

  /// An https address the server's worker may fetch a card's image from.
  static func fetchableThumbUrl(_ url: JSONValue?) -> String? {
    guard let text = url?.stringValue, let parsed = try? WHATWGURL(text) else { return nil }
    return parsed.protocolString == "https:" && !parsed.hostname.isEmpty ? text : nil
  }

  /// A file in a state, or the TypeError the web throws reading its bytes.
  static func file(_ value: JSONValue) throws -> ComposerFile {
    guard let file = ComposerFile(json: value) else {
      throw ScheduleSerializeTypeError("blob.arrayBuffer is not a function")
    }
    return file
  }

  static func imageBytes(_ image: JSONValue, _ options: ScheduleSerializeOptions) async throws -> JSONValue? {
    if let file = image["file"], file.isTruthy { return file }
    if let loadImage = options.loadImage { return try await loadImage(image)?.json }
    return nil
  }

  /// One post's attachments as the server's media: each image's bytes, and
  /// the card's own image when the writer chose one. `mediaBytes` is filled
  /// in.
  static func postMedia(
    _ post: JSONValue, _ index: Int, _ mediaBytes: inout [String: JSONValue], _ warnings: inout [JSONValue],
    _ options: ScheduleSerializeOptions
  ) async throws -> JSONValue {
    let images = post["images"]?.arrayValue ?? []
    var markerImages: [JSONValue] = []
    var cardThumb: JSONValue = .null
    let at: JSONValue = .number(Double(index))
    if images.count > ComposerModel.maxImages {
      throw refuse("TOO_MANY_IMAGES", "A post can have up to 4 images.", ["postIndex": at])
    }
    for (n, image) in images.enumerated() {
      guard let found = try await imageBytes(image, options), found.isTruthy else {
        var extra: [String: JSONValue] = ["postIndex": at]
        extra["imageId"] = image["id"]
        throw refuse("IMAGE_MISSING", "An image needs to be added again before this can be scheduled.", extra)
      }
      if ComposerJS.greater(found["size"], .number(maxImageBytes)) {
        var extra: [String: JSONValue] = ["postIndex": at]
        extra["imageId"] = image["id"]
        throw refuse(
          "IMAGE_TOO_LARGE", "One of the images is over Bluesky’s size limit. Add it again so it can be shrunk.",
          extra)
      }
      let mediaId = "p\(index)-img\(n)"
      let file = try file(found)
      let base64 = try await blobToBase64(file, files: options.media.files)
      let encoding: JSONValue = ComposerJS.or(.string(file.type), ComposerJS.or(image["mime"], "image/jpeg"))!
      mediaBytes[mediaId] = ["base64": .string(base64), "encoding": encoding]
      markerImages.append(["mediaId": .string(mediaId)])
    }

    // Only a card with no images reaches the embed (buildPostEmbed), so only
    // then is its image worth sending.
    if let card = post["card"], ComposerJS.truthy(card["url"]), images.isEmpty {
      if let thumbFile = card["thumbFile"], thumbFile.isTruthy {
        do {
          guard let source = ComposerFile(json: thumbFile) else {
            throw ImageProcessingError("That file isn’t an image.", code: "NOT_AN_IMAGE")
          }
          let prepared = try await Images.prepareImage(
            source, budget: Images.cardThumbBudget, encoder: options.media.encoder, sleep: options.media.clock.sleep)
          let mediaId = "p\(index)-thumb"
          let base64 = try await blobToBase64(prepared.file, files: options.media.files)
          let encoding =
            !prepared.mime.isEmpty ? prepared.mime : (!prepared.file.type.isEmpty ? prepared.file.type : "image/jpeg")
          mediaBytes[mediaId] = ["base64": .string(base64), "encoding": .string(encoding)]
          cardThumb = ["mediaId": .string(mediaId)]
        } catch {
          if error is CancellationError { throw error }
          // The card goes without its image rather than the post not going.
          warnings.append(["code": "CARD_THUMB_FAILED", "postIndex": at])
        }
      } else if let url = fetchableThumbUrl(card["thumb"]) {
        cardThumb = ["url": .string(url)]
      }
    }
    return ["images": .array(markerImages), "video": .null, "cardThumb": cardThumb]
  }

  /// buildPostEmbed's lexicon embed, over media markers, as the server's
  /// EmbedSpec.
  static func toEmbedSpec(_ embed: JSONValue?) -> JSONValue? {
    guard let embed, embed.isTruthy else { return nil }
    switch embed["$type"]?.stringValue {
    case "app.bsky.embed.images":
      let images = (embed["images"]?.arrayValue ?? []).map { im -> JSONValue in
        var spec: [String: JSONValue] = ["alt": ComposerJS.or(im["alt"], "")!]
        spec["mediaId"] = im["image"]?["mediaId"]
        if let ratio = im["aspectRatio"], ratio.isTruthy { spec["aspectRatio"] = ratio }
        return .object(spec)
      }
      return ["type": "images", "images": .array(images)]
    case "app.bsky.embed.external":
      let external = embed["external"]
      var spec: [String: JSONValue] = [
        "type": "external",
        "title": ComposerJS.or(external?["title"], "")!,
        "description": ComposerJS.or(external?["description"], "")!,
      ]
      spec["uri"] = external?["uri"]
      let thumb = external?["thumb"]
      if let id = thumb?["mediaId"], id.isTruthy {
        spec["thumbMediaId"] = id
      } else if let url = thumb?["url"], url.isTruthy {
        spec["thumbUrl"] = url
      }
      if let refs = external?["associatedRefs"], refs.isTruthy {
        spec["associatedRefs"] = .array(
          (refs.arrayValue ?? []).map { ref in
            var out: [String: JSONValue] = [:]
            out["uri"] = ref["uri"]
            out["cid"] = ref["cid"]
            return .object(out)
          })
      }
      return .object(spec)
    case "app.bsky.embed.record":
      var spec: [String: JSONValue] = ["type": "record"]
      spec["uri"] = embed["record"]?["uri"]
      spec["cid"] = embed["record"]?["cid"]
      return .object(spec)
    case "app.bsky.embed.recordWithMedia":
      var spec: [String: JSONValue] = ["type": "recordWithMedia"]
      spec["uri"] = embed["record"]?["record"]?["uri"]
      spec["cid"] = embed["record"]?["record"]?["cid"]
      spec["media"] = toEmbedSpec(embed["media"])
      return .object(spec)
    default:
      return nil
    }
  }

  /// The composer's state as the body of `POST /api/schedule/create` (and
  /// of a content `update`): `{ scheduledFor, target, queued, payload }`.
  ///
  /// The composer resolves what isn't the post's own first: a queue slot
  /// (`scheduledFor`), and the account's default gates when `state.gates`
  /// isn't custom. The timer is the writer's rule fitted to this post and
  /// measured from `scheduledFor`, since a scheduled post's lifespan runs
  /// from when it goes out.
  ///
  /// Throws a ScheduleSerializeError before any network (its codes above),
  /// ComposerCancelledError when the task is cancelled while the texts are
  /// resolved.
  public static func serializeForSchedule(_ state: JSONValue?, _ options: ScheduleSerializeOptions) async throws
    -> ScheduleBody
  {
    let s = ComposerModel.normalizeComposerState(state)
    let json = s.json
    let isQueued = options.queued ?? (json["schedule"]?["mode"] == "queue")
    let reply = json["reply"] ?? .null

    if reply.isTruthy && isQueued {
      throw refuse("QUEUE_REPLY", "A reply can’t wait in the queue. Schedule it for a set time instead.")
    }
    if reply.isTruthy && !ComposerJS.truthy(reply["cid"]) {
      throw refuse(
        "REPLY_UNRESOLVED", "The post you’re replying to couldn’t be read. Try again, or take the reply off.")
    }
    let posts = json["posts"]?.arrayValue ?? []
    if posts.contains(where: { ComposerJS.truthy($0["video"]) }) {
      throw refuse("SCHEDULE_VIDEO", "Posts with video can’t be scheduled. Post it now instead.")
    }
    let whenMs = try scheduledTime(s, options)
    for (i, post) in posts.enumerated() {
      if let record = post["record"], record.isTruthy, !ComposerJS.truthy(record["cid"]) {
        throw refuse(
          "RECORD_UNRESOLVED", "The attached post or feed couldn’t be found. Remove it or try again.",
          ["postIndex": .number(Double(i))])
      }
    }

    let zone = options.tz.flatMap { $0.isEmpty ? nil : $0 } ?? deviceTimeZone(options.timeZone)
    let repeatZone = options.repeatTz.flatMap { $0.isEmpty ? nil : $0 } ?? zone
    let asked: JSONValue? =
      isQueued ? nil : ComposerJS.or(options.repeat != nil ? options.repeat : json["schedule"]?["repeat"], nil)
    if asked != nil && reply.isTruthy { throw refuse("REPEAT_REPLY", Repeat.repeatReplyHint) }
    let whenISO = JSDate.toISOString(whenMs) ?? ""
    if let asked {
      // Judged as the picker left it: an end that is half filled in is
      // asked for, never read as "no end".
      let occurrence = options.occurrence.flatMap { $0 == 0 || $0.isNaN ? nil : $0 } ?? 1
      let wrong = Repeat.repeatProblem(
        asked, .string(whenISO), .string(repeatZone), occurrence: occurrence, timeZone: options.timeZone)
      if !wrong.isEmpty { throw refuse("REPEAT_INVALID", wrong) }
    }
    let rule = Repeat.normalizeRepeat(asked)

    let fit = options.fit ?? SelfDestruct.composerTimerFit(reply: reply.isTruthy)
    let timer = SelfDestruct.scheduledTimerToSend(
      json["lifespan"] ?? .null, fit: fit, publishAt: whenMs, now: options.now, locale: options.locale,
      timeZone: options.timeZone)
    if !timer.problem.isEmpty { throw refuse("LIFESPAN", timer.problem) }

    let texts = try await ComposerModel.resolvePostTexts(
      json, resolveMention: options.resolveMention, validationCache: options.validationCache)

    var warnings: [JSONValue] = []
    var mediaBytes: [String: JSONValue] = [:]
    var markers: [JSONValue] = []
    for (i, post) in posts.enumerated() {
      markers.append(try await postMedia(post, i, &mediaBytes, &warnings, options))
    }
    let total = mediaBytes.values.reduce(0) { $0 + ($1["base64"]?.stringValue?.utf16.count ?? 0) }
    if total > maxMediaBase64Chars {
      throw refuse(
        "MEDIA_TOO_LARGE",
        "That’s more image than can be sent ahead. Use fewer or smaller images, or post it now.",
        ["size": .number(Double(total)), "limit": .number(Double(maxMediaBase64Chars))])
    }

    let tags = Tags.normalizeTags(json["tags"])
    let labels = ComposerModel.labelsToSelfLabels(json["labels"])
    let langs = ComposerJS.list(json["langs"]).filter(\.isTruthy)

    var specs: [JSONValue] = []
    for (i, post) in posts.enumerated() {
      let text = i < texts.count ? texts[i].text : ""
      let facets = i < texts.count ? texts[i].facets : []
      let embed = toEmbedSpec(Embeds.buildPostEmbed(post, markers[i]))
      if text.isEmpty && embed == nil {
        throw refuse("EMPTY", "Write something first.", ["postIndex": .number(Double(i))])
      }
      var record: [String: JSONValue] = ["text": .string(text)]
      if !facets.isEmpty { record["facets"] = (try? JSONValue(encoding: facets)) ?? .array([]) }
      // As a live thread does: every post carries the langs, labels and tags.
      if !langs.isEmpty { record["langs"] = .array(langs) }
      if let labels { record["labels"] = labels }
      if !tags.isEmpty { record["tags"] = .array(tags.map(JSONValue.string)) }
      var out: [String: JSONValue] = ["record": .object(record)]
      if let embed { out["embed"] = embed }
      specs.append(.object(out))
    }

    // A reply takes no gates, as when it is posted live: the thread isn't
    // the account's to gate.
    let gates = reply.isTruthy ? GateRules(threadgateAllow: nil, postgateEmbeddingRules: nil) : Gates.gatesToRules(json["gates"])

    var payload: [String: JSONValue] = [
      "posts": .array(specs),
      "gates": [
        "threadgate": gates.threadgateAllow.map(JSONValue.array) ?? .null,
        "postgate": gates.postgateEmbeddingRules.map(JSONValue.array) ?? .null,
      ],
      "mediaBytes": .object(mediaBytes),
      "tz": .string(zone),
      "selfDestruct": timer.spec?.json ?? .null,
    ]
    if reply.isTruthy {
      var parent: [String: JSONValue] = [:]
      parent["uri"] = reply["uri"]
      parent["cid"] = reply["cid"]
      var root: [String: JSONValue] = parent
      if let r = reply["root"], ComposerJS.truthy(r["uri"]), ComposerJS.truthy(r["cid"]) {
        root = ["uri": r["uri"]!, "cid": r["cid"]!]
      }
      payload["reply"] = ["root": .object(root), "parent": .object(parent)]
      if let replyTo = replyHint(reply) { payload["replyTo"] = replyTo }
    }
    if rule != nil, let server = Repeat.repeatForServer(asked, .string(repeatZone)) { payload["repeat"] = server }
    return ScheduleBody(
      scheduledFor: whenISO, target: "bluesky", queued: isQueued, payload: .object(payload), warnings: warnings)
  }

  public static func serializeForSchedule(_ state: ComposerState, _ options: ScheduleSerializeOptions) async throws
    -> ScheduleBody
  {
    try await serializeForSchedule(state.json, options)
  }

  /// Who a reply answers and the start of what they said, as the Scheduled
  /// page shows it. Nil when the composer knows neither.
  static func replyHint(_ reply: JSONValue) -> JSONValue? {
    let handle = reply["author"]?["handle"]?.stringValue ?? ""
    let displayName = reply["author"]?["displayName"]?.stringValue ?? ""
    let text = reply["text"]?.stringValue.map { $0.jsTrimmed().jsSlice(0, 300) } ?? ""
    guard !handle.isEmpty || !displayName.isEmpty || !text.isEmpty else { return nil }
    return ["handle": .string(handle), "displayName": .string(displayName), "text": .string(text)]
  }
}
