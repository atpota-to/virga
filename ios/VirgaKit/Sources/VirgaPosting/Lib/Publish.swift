// Ports src/posting/lib/publish.js
//
// Publishing: the composer's state to records in the write account's repo.
//
// Order: the text pipeline starts first (mentions resolve over the network)
// and is parked while media uploads; then the records are built and written
// in one go. A single post is one createRecord, or one applyWrites when it
// carries a threadgate or postgate; a thread is one applyWrites holding every
// post, the root's threadgate and a postgate per post, its replies chained
// through locally computed CIDs. Every write uses a client-chosen key and is
// retried idempotently (PublishRecord), and nothing is ever rolled back:
// applyWrites is atomic, and blobs no record names are collected by the PDS.
//
// Everything is done as `target`: uploads, video, card thumbnails, the
// writes. A blob uploaded as another account is uploaded again, because a
// record can only name blobs in its own repo.
//
// The web's `signal` is the task's cancellation: it cancels uploads; once the
// write starts it runs to the end. Its `fetch`, `compress` and `decode` are
// PublishMedia's transport and encoder, and the files' bytes come from
// PublishMedia.files.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// The account a post is written as: `targetFor(did)`'s `{ did, agent, pdsUrl }`.
public struct PublishTarget: Sendable {
  public var did: String
  public var agent: XRPCAgent
  public var pdsUrl: String?

  public init(did: String, agent: XRPCAgent, pdsUrl: String? = nil) {
    self.did = did
    self.agent = agent
    self.pdsUrl = pdsUrl
  }
}

/// What uploads need besides the agent: the picked files' bytes, the image
/// re-encoder (a card thumbnail is shrunk before it is uploaded), the
/// network for the card and video services, and the clock their timeouts
/// and the writes' run on.
public struct PublishMedia: Sendable {
  public var files: any ComposerFiles
  public var encoder: any ImageEncoder
  public var transport: any HTTPTransport
  public var clock: NetworkClock

  public init(
    files: any ComposerFiles, encoder: any ImageEncoder, transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock
  ) {
    self.files = files
    self.encoder = encoder
    self.transport = transport
    self.clock = clock
  }
}

/// A publish that didn't happen, with a code the composer can act on:
/// NO_TARGET, WRONG_ACCOUNT, INVALID (with `problems`), DUPLICATE,
/// UPLOAD_FAILED, MEDIA_MISSING, VIDEO_* (the video service's), ABORTED,
/// MISSING_SCOPE, WRITE_FAILED.
public struct PublishError: Error, LocalizedError, JSErrorConvertible, CancelMarkedError, Sendable {
  public let name = "PublishError"
  public var code: String
  public var message: String
  public var problems: [ComposerProblem]?
  public var cause: (any Error)?
  public var status: Int?

  public init(
    _ code: String, _ message: String, problems: [ComposerProblem]? = nil, cause: (any Error)? = nil,
    status: Int? = nil
  ) {
    self.code = code
    self.message = message
    self.problems = problems
    self.cause = cause
    // `if (status) this.status = status`
    self.status = status == 0 ? nil : status
  }

  public var errorDescription: String? { message }
  public var canceled: Bool { false }
  public var jsFields: JSErrorFields { JSErrorFields(name: name, message: message, code: .string(code), status: status) }
}

/// What publish wrote: the posts (`{ uri, cid }` each, the root first) and
/// the records as written, and anything that went out short of what was
/// asked (a card without its image).
public struct PublishResult: Codable, Hashable, Sendable {
  public struct Ref: Codable, Hashable, Sendable {
    public var uri: JSONValue
    public var cid: JSONValue
  }

  public struct Written: Codable, Hashable, Sendable {
    public var uri: JSONValue
    public var cid: JSONValue
    public var record: JSONValue
  }

  public var posts: [Ref]
  public var root: Ref?
  public var written: [Written]
  public var warnings: [JSONValue]
}

/// Refuses the same post twice within a window. Only a publish that went out
/// is remembered, so a failed one can be retried at once.
public final class DuplicateGuard: Sendable {
  private let last = Locked<(signature: String, at: Double)?>(nil)
  public let windowMs: Double
  private let now: @Sendable () -> Double

  public init(
    windowMs: Double = Publish.duplicateWindowMs,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }
  ) {
    self.windowMs = windowMs
    self.now = now
  }

  public func isDuplicate(_ signature: String) -> Bool {
    guard let last = last.withLock({ $0 }) else { return false }
    return last.signature.jsEquals(signature) && now() - last.at < windowMs
  }

  public func remember(_ signature: String) {
    let at = now()
    last.withLock { $0 = (signature, at) }
  }

  public func clear() {
    last.withLock { $0 = nil }
  }
}

public enum Publish {
  static let post = "app.bsky.feed.post"
  public static let imageUploadConcurrency = 4
  public static let duplicateWindowMs: Double = 2 * 60 * 1000

  /// `createDuplicateGuard({ windowMs, now })`.
  public static func createDuplicateGuard(
    windowMs: Double = duplicateWindowMs,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }
  ) -> DuplicateGuard {
    DuplicateGuard(windowMs: windowMs, now: now)
  }

  /// The app's guard, used when a caller doesn't bring its own.
  public static let defaultDuplicateGuard = DuplicateGuard()

  /// The video upload publish makes (`uploadVideo(target, file, { onProgress })`).
  public typealias UploadVideo = @Sendable (
    _ target: PublishTarget, _ file: ComposerFile, _ onProgress: @escaping @Sendable (VideoProgress) -> Void
  ) async throws -> UploadedVideo

  // MARK: Duplicate guard

  /// `${file.name || ''}:${file.size ?? ''}:${file.lastModified ?? ''}`, or '' for no file.
  static func fingerprintFile(_ file: JSONValue?) -> String {
    guard let file, file.isTruthy else { return "" }
    let name = file["name"].truthy?.jsString ?? ""
    let size = file["size"].nonNull?.jsString ?? ""
    let modified = file["lastModified"].nonNull?.jsString ?? ""
    return "\(name):\(size):\(modified)"
  }

  /// `a || b || …`: the first truthy value.
  static func firstTruthy(_ values: JSONValue?...) -> JSONValue? {
    values.first { $0?.isTruthy == true } ?? nil
  }

  /// What makes two publishes the same post: the account, the reply target,
  /// and each post's text and attachments (the web's JSON.stringify of
  /// `{ did, reply, posts: [{ text, images, video, record, card }] }`).
  public static func publishSignature(_ state: JSONValue?, _ did: String?) -> String {
    func pair(_ key: String, _ value: JSONValue) -> String { "\(JSONStringify.quote(key)):\(JSONStringify.stringify(value))" }
    let posts = ComposerJS.list(ComposerJS.or(state?["posts"], nil)).map { p -> String in
      let text = (p["text"]?.stringValue ?? "").jsTrimmed()
      let images = ComposerJS.list(ComposerJS.or(p["images"], nil)).map { i -> JSONValue in
        let id = firstTruthy(.string(fingerprintFile(i["file"])), Blobs.blobCid(i["blob"]))?.jsString ?? ""
        let alt = i["alt"].truthy?.jsString ?? ""
        return .string("\(id)|\(alt)")
      }
      var video: JSONValue = .null
      if let v = p["video"], v.isTruthy {
        video = firstTruthy(.string(fingerprintFile(v["file"])), Blobs.blobCid(v["blob"])) ?? "video"
      }
      let record = p["record"]?["uri"].truthy ?? .null
      let card = p["card"]?["url"].truthy ?? .null
      return "{"
        + [
          pair("text", .string(text)), pair("images", .array(images)), pair("video", video), pair("record", record),
          pair("card", card),
        ].joined(separator: ",") + "}"
    }
    var members: [String] = []
    if let did { members.append(pair("did", .string(did))) }
    members.append(pair("reply", state?["reply"]?["uri"].truthy ?? .null))
    members.append("\(JSONStringify.quote("posts")):[\(posts.joined(separator: ","))]")
    return "{\(members.joined(separator: ","))}"
  }

  public static func publishSignature(_ state: ComposerState, _ did: String?) -> String {
    publishSignature(state.json, did)
  }

  // MARK: Records

  /// `{ root, parent }` for a reply, or nil: the post replied to, under its
  /// thread's root (itself when it is the root).
  static func replyRefs(_ reply: JSONValue?) -> JSONValue? {
    guard let reply, let uri = reply["uri"], uri.isTruthy, let cid = reply["cid"], cid.isTruthy else { return nil }
    let parent: JSONValue = ["uri": uri, "cid": cid]
    var root = parent
    if let r = reply["root"], let rootUri = r["uri"], rootUri.isTruthy, let rootCid = r["cid"], rootCid.isTruthy {
      root = ["uri": rootUri, "cid": rootCid]
    }
    return ["root": root, "parent": parent]
  }

  /// The post records for `state`, over blobs already uploaded as the write
  /// account. Tags and labels go on every post. `createdAt` is `nowMs`, one
  /// millisecond later for each post after the first. Only the first post
  /// carries `reply` (when the composer replies); a thread's later posts get
  /// theirs when the batch is built, since they name CIDs computed there.
  ///
  /// - Parameters:
  ///   - blobs: per post, `{ images, video, cardThumb }`.
  ///   - texts: per post, `{ text, facets }` (resolvePostTexts' output); a
  ///     post without one goes out as its trimmed text, no facets.
  /// - Throws: InvalidTimeValueError for a time that isn't one.
  public static func buildPostRecords(
    _ state: JSONValue, nowMs: Double, blobs: [JSONValue] = [], texts: [JSONValue]
  ) throws -> [JSONValue] {
    let start = JSDate.timeClip(nowMs)
    let tags = Tags.normalizeTags(state["tags"])
    let labels = ComposerModel.labelsToSelfLabels(state["labels"])
    let langs = (state["langs"]?.arrayValue ?? []).filter(\.isTruthy)
    let reply = replyRefs(state["reply"])

    return try ComposerJS.list(state["posts"]).enumerated().map { i, draft in
      let given: JSONValue? = i < texts.count && texts[i].isTruthy ? texts[i] : JSONValue?.none
      let text: JSONValue? = given.map { $0["text"] } ?? .string((draft["text"]?.stringValue ?? "").jsTrimmed())
      let facets: JSONValue? = given.map { $0["facets"] } ?? []
      var record: [String: JSONValue] = ["$type": .string(post)]
      if let text { record["text"] = text }
      if let facets, Embeds.hasLength(facets) { record["facets"] = facets }
      if let embed = Embeds.buildPostEmbed(draft, i < blobs.count && blobs[i].isTruthy ? blobs[i] : [:]) {
        record["embed"] = embed
      }
      if !langs.isEmpty { record["langs"] = .array(langs) }
      if let labels { record["labels"] = labels }
      if !tags.isEmpty { record["tags"] = .array(tags.map(JSONValue.string)) }
      if i == 0, let reply { record["reply"] = reply }
      guard let createdAt = JSDate.toISOString(start + Double(i)) else { throw InvalidTimeValueError() }
      record["createdAt"] = .string(createdAt)
      return .object(record)
    }
  }

  public static func buildPostRecords(
    _ state: ComposerState, now: Date = Date(), blobs: [JSONValue] = [], texts: [FacetedText]
  ) throws -> [JSONValue] {
    try buildPostRecords(
      state.json, nowMs: (now.timeIntervalSince1970 * 1000).rounded(.down), blobs: blobs,
      texts: texts.map { (try? JSONValue(encoding: $0)) ?? .null })
  }

  // MARK: Uploads

  /// `signal?.aborted || err?.name === 'AbortError' || err?.canceled`.
  static func isAbort(_ error: any Error) -> Bool {
    if Task.isCancelled || error is CancellationError { return true }
    let object = PublishRecord.errorObject(error)
    return object["name"]?.stringValue == "AbortError" || object["canceled"]?.isTruthy == true
  }

  static func uploadFailure(_ error: any Error, _ what: String) -> PublishError {
    let message = PublishRecord.errorObject(error)["message"].truthy?.jsString
    return PublishError("UPLOAD_FAILED", message.map { "\(what): \($0)" } ?? what, cause: error)
  }

  /// The TypeError the web's uploadBlob meets for an image whose `file` is
  /// truthy but not a file.
  struct NotAFileError: Error, LocalizedError {
    var errorDescription: String? { "data.arrayBuffer is not a function" }
  }

  /// The video upload publish makes by default: Bluesky's video service, as
  /// the write account, over `media`'s transport and clock.
  public static func defaultUploadVideo(media: PublishMedia, now: @escaping @Sendable () -> Double) -> UploadVideo {
    { target, file, onProgress in
      let data = try await media.files.bytes(of: file)
      return try await Video.uploadVideo(
        VideoTarget(did: target.did, pdsUrl: target.pdsUrl, agent: target.agent),
        VideoFile(type: file.type, size: file.size, data: data), onProgress: onProgress, now: now,
        transport: media.transport, clock: media.clock)
    }
  }

  struct Uploaded {
    var blobs: [JSONValue]
    var warnings: [JSONValue]
  }

  static func uploadMedia(
    _ state: JSONValue, _ target: PublishTarget, media: PublishMedia, onProgress: (@Sendable (JSONValue) -> Void)?,
    uploadVideo: UploadVideo
  ) async throws -> Uploaded {
    let report: @Sendable (JSONValue) -> Void = { event in onProgress?(event) }
    let posts = ComposerJS.list(state["posts"])
    var blobs: [JSONValue] = posts.map { _ in ["images": [], "video": nil, "cardThumb": nil] }
    var warnings: [JSONValue] = []

    struct Item: Sendable {
      var postIndex: Int
      var image: JSONValue
      var imageIndex: Int
    }
    let images = posts.enumerated().flatMap { postIndex, post in
      ComposerJS.list(post["images"]).enumerated().map { Item(postIndex: postIndex, image: $0.element, imageIndex: $0.offset) }
    }
    let total = Double(images.count)
    let done = Locked(0.0)
    if !images.isEmpty { report(["phase": "uploading", "kind": "images", "done": 0, "total": .number(total)]) }
    let uploaded = try await AsyncPool.mapWithConcurrency(images, imageUploadConcurrency) { item, _ -> JSONValue in
      let image = item.image
      var blob: JSONValue
      if let held = image["blob"], held.isTruthy, image["blobDid"]?.stringValue?.jsEquals(target.did) == true {
        blob = held
      } else if image["file"]?.isTruthy == true {
        do {
          guard let file = ComposerFile(json: image["file"]) else { throw NotAFileError() }
          let mime = image["mime"].truthy?.jsString
          let encoding = mime ?? (file.type.isEmpty ? "image/jpeg" : file.type)
          let data = try await media.files.bytes(of: file)
          blob = try JSONValue(encoding: try await Blobs.uploadBlob(agent: target.agent, data: data, encoding: encoding))
        } catch {
          if isAbort(error) { throw error }
          throw uploadFailure(error, "An image couldn’t be uploaded")
        }
        report([
          "phase": "uploaded", "kind": "image", "postIndex": .number(Double(item.postIndex)),
          "id": image["id"] ?? .null, "blob": blob, "blobDid": .string(target.did),
        ])
      } else {
        throw PublishError("MEDIA_MISSING", "An image needs to be added again before this can be posted.")
      }
      let count = done.withLock { value -> Double in
        value += 1
        return value
      }
      report(["phase": "uploading", "kind": "images", "done": .number(count), "total": .number(total)])
      return blob
    }
    for (item, blob) in zip(images, uploaded) {
      var list = blobs[item.postIndex]["images"]?.arrayValue ?? []
      while list.count < item.imageIndex { list.append(.null) }
      if list.count == item.imageIndex { list.append(blob) } else { list[item.imageIndex] = blob }
      blobs[item.postIndex]["images"] = .array(list)
    }

    for (postIndex, post) in posts.enumerated() {
      let video = post["video"]
      let card = post["card"]
      if let video, video.isTruthy {
        if let held = video["blob"], held.isTruthy, video["blobDid"]?.stringValue?.jsEquals(target.did) == true,
          Video.isUsableVideoBlob(held)
        {
          blobs[postIndex]["video"] = held
        } else if video["file"]?.isTruthy == true {
          do {
            guard let file = ComposerFile(json: video["file"]) else { throw NotAFileError() }
            let index = Double(postIndex)
            let result = try await uploadVideo(target, file) { p in
              var event: JSONValue = ["phase": "video", "step": .string(p.phase), "postIndex": .number(index)]
              if let progress = p.progress { event["progress"] = progress }
              report(event)
            }
            blobs[postIndex]["video"] = result.blob
            report([
              "phase": "uploaded", "kind": "video", "postIndex": .number(index), "blob": result.blob,
              "blobDid": .string(target.did), "jobId": result.jobId.map(JSONValue.string) ?? .null,
            ])
          } catch {
            if isAbort(error) { throw error }
            let object = PublishRecord.errorObject(error)
            throw PublishError(
              object["code"].truthy?.jsString ?? "VIDEO_FAILED",
              object["message"].truthy?.jsString ?? "The video couldn’t be uploaded.", cause: error)
          }
        } else {
          throw PublishError("MEDIA_MISSING", "The video needs to be added again before this can be posted.")
        }
      } else if let card, card.isTruthy, ComposerJS.length(post["images"]) == 0,
        card["thumb"]?.isTruthy == true || card["thumbFile"]?.isTruthy == true || card["thumbBlob"]?.isTruthy == true
      {
        report(["phase": "uploading", "kind": "card", "postIndex": .number(Double(postIndex))])
        let reused =
          card["thumbBlob"]?.isTruthy == true && card["thumbBlobDid"]?.stringValue?.jsEquals(target.did) == true
        if let thumb = try await LinkCard.uploadCardThumb(target, card, media: media) {
          blobs[postIndex]["cardThumb"] = thumb
          if !reused {
            report([
              "phase": "uploaded", "kind": "cardThumb", "postIndex": .number(Double(postIndex)), "blob": thumb,
              "blobDid": .string(target.did),
            ])
          }
        } else {
          warnings.append([
            "postIndex": .number(Double(postIndex)), "code": "CARD_THUMB_FAILED",
            "message": "The link card went out without its image.",
          ])
        }
      }
    }
    return Uploaded(blobs: blobs, warnings: warnings)
  }

  /// `/missing required scope/i`, the `i` written out.
  static let missingScope = JSRegex(
    "[mM][iI][sS][sS][iI][nN][gG] [rR][eE][qQ][uU][iI][rR][eE][dD] [sS][cC][oO][pP][eE]")

  static func writeFailure(_ error: any Error) -> PublishError {
    let object = PublishRecord.errorObject(error)
    let message = object["message"].truthy?.jsString ?? ""
    let status = object["status"]?.doubleValue.flatMap { Int(exactly: $0) }
    if missingScope.test(message) || object["error"]?.stringValue == "ScopeMissingError" {
      return PublishError(
        "MISSING_SCOPE", "Virga needs permission to post. Sign in again to grant it.", cause: error, status: status)
    }
    return PublishError(
      "WRITE_FAILED", message.isEmpty ? "The post couldn’t be published. Try again." : message, cause: error,
      status: status)
  }

  // MARK: Publishing

  /// Publish the composer's posts as `target`.
  ///
  /// - Parameters:
  ///   - state: a ComposerState; `state.gates` is used as given (the
  ///     composer resolves the account's defaults into it beforehand).
  ///   - target: `targetFor(did)`; nil is the web's missing target.
  ///   - onProgress: `{ phase: 'uploading'|'uploaded'|'video'|'writing', … }`;
  ///     'uploaded' events carry the blob and its DID so the composer can
  ///     keep it.
  ///   - now: the clock (epoch ms), read for validation and for createdAt.
  ///   - duplicateGuard: nil for none.
  ///   - uploadVideo: nil for Bluesky's video service through `media`.
  ///   - mintTid: the record keys (the web's nextTid).
  ///   - timeZone: the zone a zone-less time is read in.
  /// - Throws: PublishError.
  public static func publish(
    _ state: JSONValue?,
    _ target: PublishTarget?,
    media: PublishMedia,
    onProgress: (@Sendable (JSONValue) -> Void)? = nil,
    resolveMention: ResolveMention? = nil,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 },
    requireAltText: Bool = false,
    duplicateGuard: DuplicateGuard? = Publish.defaultDuplicateGuard,
    uploadVideo: UploadVideo? = nil,
    validationCache: MentionValidationCache = .shared,
    mintTid: @escaping @Sendable (Double) throws -> String = ThreadBatch.nextTid,
    timeZone: TimeZone? = nil
  ) async throws -> PublishResult {
    guard let target, !target.did.isEmpty else { throw PublishError("NO_TARGET", "Choose an account to post as.") }
    if let asDid = state?["asDid"], asDid.isTruthy, asDid.stringValue?.jsEquals(target.did) != true {
      // Never fall back to another account than the one the writer chose.
      throw PublishError("WRONG_ACCOUNT", "This post is set to go out from a different account.")
    }
    let state = state ?? .null
    let problems = ComposerModel.validateComposer(state, now: now(), requireAltText: requireAltText, timeZone: timeZone)
    if let first = problems.first { throw PublishError("INVALID", first.message, problems: problems) }
    let signature = publishSignature(state, target.did)
    if duplicateGuard?.isDuplicate(signature) == true {
      throw PublishError("DUPLICATE", "This was just posted. Change something to post it again.")
    }

    // Started first and parked while media uploads.
    let textsTask = Task {
      try await ComposerModel.resolvePostTexts(state, resolveMention: resolveMention, validationCache: validationCache)
    }

    let uploaded: Uploaded
    do {
      uploaded = try await uploadMedia(
        state, target, media: media, onProgress: onProgress,
        uploadVideo: uploadVideo ?? defaultUploadVideo(media: media, now: now))
    } catch {
      if isAbort(error) { throw PublishError("ABORTED", "Cancelled.", cause: error) }
      throw error
    }
    if Task.isCancelled { throw PublishError("ABORTED", "Cancelled.") }

    let texts = try await textsTask.value.map { (try? JSONValue(encoding: $0)) ?? .null }
    let records = try buildPostRecords(state, nowMs: now(), blobs: uploaded.blobs, texts: texts)
    let replying = state["reply"]?.isTruthy == true
    let rules = replying ? GateRules(threadgateAllow: nil, postgateEmbeddingRules: nil) : Gates.gatesToRules(state["gates"])

    onProgress?(["phase": "writing", "count": .number(Double(records.count))])

    let repo = target.did
    var written: [PublishResult.Written]
    do {
      if records.count == 1 {
        let data = try await PublishRecord.createPostWithGates(
          target.agent, repo: repo, collection: post, record: records[0], threadgateRules: rules.threadgateAllow,
          postgateRules: rules.postgateEmbeddingRules, clock: media.clock, mintTid: mintTid)
        written = [PublishResult.Written(uri: data["uri"] ?? .null, cid: data["cid"] ?? .null, record: records[0])]
      } else {
        let zone = timeZone ?? AppLocale.activeTimeZone()
        let replyTo = replyRefs(state["reply"]).flatMap { refs -> ThreadReplyTo? in
          guard let root = strongRef(refs["root"]), let parent = strongRef(refs["parent"]) else { return nil }
          return ThreadReplyTo(root: root, parent: parent)
        }
        let start = JSDate.parse(records.first?["createdAt"]?.jsString ?? "undefined", timeZone: zone)
        let batch = try ThreadBatch.buildThreadWrites(
          did: repo, collection: post, records: records, replyTo: replyTo, nowMs: start, timeZone: zone,
          mintTid: mintTid)
        let rkey = batch.created[0].rkey
        // A threadgate covers the whole thread from its root, but a postgate
        // guards only the post it names, so every post of a new thread gets
        // its own or the rest of the thread stays quotable.
        let gateWrites =
          replying
          ? []
          : batch.created.enumerated().flatMap { i, created in
            PublishRecord.buildGateWrites(
              did: repo, rkey: created.rkey, threadgateRules: i == 0 ? rules.threadgateAllow : nil,
              postgateRules: rules.postgateEmbeddingRules, createdAt: created.record["createdAt"] ?? .null)
          }
        let writes = batch.writes + gateWrites
        let agent = target.agent
        _ = try await PublishRecord.publishWithIdempotentRetry(
          agent, repo: repo, collection: post, rkey: rkey, clock: media.clock, mintTid: mintTid
        ) { _ in
          try await PublishRecord.applyWrites(agent, repo: repo, validate: true, writes: writes)
        }
        written = batch.created.map {
          PublishResult.Written(uri: .string($0.uri), cid: .string($0.cid), record: $0.record)
        }
      }
    } catch {
      throw writeFailure(error)
    }

    duplicateGuard?.remember(signature)
    let posts = written.map { PublishResult.Ref(uri: $0.uri, cid: $0.cid) }
    return PublishResult(posts: posts, root: posts.first, written: written, warnings: uploaded.warnings)
  }

  public static func publish(
    _ state: ComposerState,
    _ target: PublishTarget?,
    media: PublishMedia,
    onProgress: (@Sendable (JSONValue) -> Void)? = nil,
    resolveMention: ResolveMention? = nil,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 },
    requireAltText: Bool = false,
    duplicateGuard: DuplicateGuard? = Publish.defaultDuplicateGuard,
    uploadVideo: UploadVideo? = nil
  ) async throws -> PublishResult {
    try await publish(
      state.json, target, media: media, onProgress: onProgress, resolveMention: resolveMention, now: now,
      requireAltText: requireAltText, duplicateGuard: duplicateGuard, uploadVideo: uploadVideo)
  }

  /// A reply ref as ThreadBatch takes it.
  static func strongRef(_ ref: JSONValue?) -> StrongRef? {
    guard let uri = ref?["uri"], let cid = ref?["cid"] else { return nil }
    return StrongRef(uri: uri.stringValue ?? uri.jsString, cid: cid.stringValue ?? cid.jsString)
  }
}
