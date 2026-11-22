// Ports src/posting/lib/composerModel.js
//
// The composer's state, as one value a reducer moves: every post is a
// PostDraft in `posts` (a single post is a thread of one), and the
// composer-wide choices sit beside them. The shape is the contract between
// the composer, drafts, scheduling and publishing (ComposerModel+Types.swift).
//
// Every function reads its input as the web reads the plain object it is
// given (ComposerJS), so a state an older build saved, or one a later build
// adds members to, comes through exactly as it does on the web. The reducer
// is ComposerModel+Reducer.swift.
//
// Where the web would throw a TypeError on a malformed shape (a post whose
// `text` is a number reaching `text.trim()`, a state whose `posts` isn't an
// array reaching `.some`), the port reads the value as empty instead.

import Foundation
import VirgaCore

public enum ComposerModel {
  public static let maxPosts = 25
  public static let maxImages = 4
  public static let maxPostGraphemes = PostingLimits.maxPostGraphemes
  public static let maxPostBytes = PostingLimits.maxPostBytes
  public static let maxLangs = 3
  public static let scheduleMinLeadMs: Double = 60_000
  public static let scheduleMaxDays: Double = 90

  /// Self-labels a post can carry; the first three are exclusive.
  public static let adultLabels = ["sexual", "nudity", "porn"]
  public static let selfLabels = adultLabels + ["graphic-media"]

  static let recordKinds = ["post", "feed", "list", "starterpack"]
  static let videoStatuses = ["idle", "uploading", "processing", "ready", "error"]

  // MARK: Ids

  private static let idCounter = Locked(0)

  /// An id unique within this run of the app, for posts and images:
  /// `<prefix><now in base 36><counter in base 36><six random base-36 digits>`,
  /// as the web makes them.
  public static func newId(_ prefix: String = "p", now: Date = Date()) -> String {
    let count = idCounter.withLock { value -> Int in
      value += 1
      return value
    }
    let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
    var generator = SystemRandomNumberGenerator()
    let random = String((0..<6).map { _ in alphabet[Int(generator.next(upperBound: UInt32(36)))] })
    let ms = Int64((now.timeIntervalSince1970 * 1000).rounded(.down))
    return "\(prefix)\(String(ms, radix: 36))\(String(count, radix: 36))\(random)"
  }

  // MARK: Normalizing

  /// An empty post.
  public static func emptyPost() -> PostDraft {
    PostDraft(json: [
      "id": .string(newId("p")), "text": "", "images": [], "video": nil, "record": nil, "card": nil,
    ])
  }

  static func normalizeImage(_ raw: JSONValue?) -> JSONValue? {
    guard ComposerJS.isObject(raw), let raw else { return nil }
    var out = ComposerJS.spread(raw)
    out["id"] = ComposerJS.or(raw["id"], .string(newId("i")))
    out["alt"] = .string(ComposerJS.str(raw["alt"]))
    return .object(out)
  }

  static func normalizeVideo(_ raw: JSONValue?) -> JSONValue? {
    guard ComposerJS.isObject(raw), let raw else { return nil }
    let status: JSONValue =
      ComposerJS.includes(videoStatuses, raw["status"])
      ? raw["status"]! : (ComposerJS.truthy(raw["blob"]) ? "ready" : "idle")
    var out = ComposerJS.spread(raw)
    out["alt"] = .string(ComposerJS.str(raw["alt"]))
    out["status"] = status
    return .object(out)
  }

  static func normalizeRecord(_ raw: JSONValue?) -> JSONValue? {
    guard ComposerJS.isObject(raw), let raw, raw["uri"]?.stringValue != nil else { return nil }
    var out = ComposerJS.spread(raw)
    out["kind"] = ComposerJS.includes(recordKinds, raw["kind"]) ? raw["kind"]! : "post"
    return .object(out)
  }

  static func normalizeCard(_ raw: JSONValue?) -> JSONValue? {
    guard ComposerJS.isObject(raw), let raw, let url = raw["url"]?.stringValue, !url.isEmpty else { return nil }
    var out = ComposerJS.spread(raw)
    out["title"] = .string(ComposerJS.str(raw["title"]))
    out["description"] = .string(ComposerJS.str(raw["description"]))
    if let thumb = raw["thumb"]?.stringValue, !thumb.isEmpty {
      out["thumb"] = .string(thumb)
    } else {
      out["thumb"] = .null
    }
    return .object(out)
  }

  /// A PostDraft with every field present and of the right kind.
  public static func normalizePost(_ raw: JSONValue?) -> PostDraft {
    let src: JSONValue = ComposerJS.isObject(raw) ? raw! : [:]
    var out = ComposerJS.spread(src)
    out["id"] = ComposerJS.or(src["id"], .string(newId("p")))
    out["text"] = .string(ComposerJS.str(src["text"]))
    out["images"] = .array(ComposerJS.list(src["images"]).compactMap(normalizeImage))
    out["video"] = normalizeVideo(src["video"]) ?? .null
    out["record"] = normalizeRecord(src["record"]) ?? .null
    out["card"] = normalizeCard(src["card"]) ?? .null
    return PostDraft(json: .object(out))
  }

  public static func normalizePost(_ raw: PostDraft) -> PostDraft { normalizePost(raw.json) }

  static func normalizeGates(_ raw: JSONValue?) -> JSONValue {
    let src: JSONValue = ComposerJS.isObject(raw) ? raw! : [:]
    return [
      "custom": .bool(ComposerJS.truthy(src["custom"])),
      "reply": src["reply"]?.arrayValue.map(JSONValue.array) ?? .null,
      "quotes": .bool(src["quotes"] != .bool(false)),
    ]
  }

  static func normalizeSchedule(_ raw: JSONValue?) -> JSONValue {
    guard ComposerJS.isObject(raw), let raw else { return .null }
    if raw["mode"] == "queue" { return ["mode": "queue"] }
    if raw["mode"] == "at", let at = raw["at"]?.stringValue {
      // A post at a set time may repeat; the rule rides with the time, and
      // the schedule module reads it (schedule/repeat.js). The queue has none.
      if ComposerJS.isObject(raw["repeat"]) {
        return ["mode": "at", "at": .string(at), "repeat": raw["repeat"]!]
      }
      return ["mode": "at", "at": .string(at)]
    }
    return .null
  }

  /// A ComposerState with every field present: what `load` and `reset`
  /// store, so a draft or an old autosave can't leave a hole the UI trips on.
  public static func normalizeComposerState(_ raw: JSONValue?) -> ComposerState {
    let src: JSONValue = ComposerJS.isObject(raw) ? raw! : [:]
    let posts = Array(ComposerJS.list(src["posts"]).prefix(maxPosts)).map { normalizePost($0).json }
    var out = ComposerJS.spread(src)
    out["posts"] = .array(posts.isEmpty ? [emptyPost().json] : posts)
    if ComposerJS.isObject(src["reply"]), src["reply"]?["uri"]?.stringValue != nil {
      out["reply"] = src["reply"]
    } else {
      out["reply"] = .null
    }
    out["tags"] = .array(ComposerJS.stringList(src["tags"]).map(JSONValue.string))
    out["langs"] = .array(ComposerJS.stringList(src["langs"]).prefix(maxLangs).map(JSONValue.string))
    out["labels"] = .array(ComposerJS.stringList(src["labels"]).map(JSONValue.string))
    out["gates"] = normalizeGates(src["gates"])
    out["asDid"] = .string(ComposerJS.str(src["asDid"]))
    out["schedule"] = normalizeSchedule(src["schedule"])
    out["lifespan"] = ComposerJS.isObject(src["lifespan"]) ? src["lifespan"]! : ["enabled": false]
    out["source"] = ComposerJS.isObject(src["source"]) ? src["source"]! : .null
    return ComposerState(json: .object(out))
  }

  public static func normalizeComposerState(_ raw: ComposerState) -> ComposerState {
    normalizeComposerState(raw.json)
  }

  /// A fresh composer for `asDid`, with the account's posting defaults
  /// (`langs`; `gates` and `lifespan` when the composer has already resolved
  /// them). Gates start not custom: the composer fills in the account's
  /// defaults with setDefaultGates. `defaults` is the web's object
  /// `{ langs?, gates?, lifespan? }` (null reads as none).
  public static func emptyComposerState(asDid: JSONValue?, defaults: JSONValue? = nil) -> ComposerState {
    let options = defaults ?? [:]
    let gates: JSONValue? = ComposerJS.isObject(options["gates"]) ? options["gates"] : nil
    return normalizeComposerState([
      "posts": [emptyPost().json],
      "reply": nil,
      "tags": [],
      "langs": .array(ComposerJS.stringList(options["langs"]).prefix(maxLangs).map(JSONValue.string)),
      "labels": [],
      "gates": [
        "custom": false,
        "reply": ComposerJS.coalesce(gates?["reply"], .null) ?? .null,
        "quotes": .bool(gates.map { $0["quotes"] != .bool(false) } ?? true),
      ],
      "asDid": asDid ?? .null,
      "schedule": nil,
      "lifespan": ComposerJS.isObject(options["lifespan"]) ? options["lifespan"]! : ["enabled": false],
      "source": nil,
    ])
  }

  /// A fresh composer for `asDid` with typed defaults.
  public static func emptyComposerState(
    asDid: String, langs: [String]? = nil, gates: JSONValue? = nil, lifespan: JSONValue? = nil
  ) -> ComposerState {
    var defaults: [String: JSONValue] = [:]
    if let langs { defaults["langs"] = .array(langs.map(JSONValue.string)) }
    if let gates { defaults["gates"] = gates }
    if let lifespan { defaults["lifespan"] = lifespan }
    return emptyComposerState(asDid: .string(asDid), defaults: .object(defaults))
  }

  // MARK: Content

  /// Whether a post holds anything: text, media, a record or a card.
  public static func postHasContent(_ post: JSONValue?) -> Bool {
    !ComposerJS.trimmed(post?["text"]).isEmpty
      || ComposerJS.length(post?["images"]) > 0
      || ComposerJS.truthy(post?["video"])
      || ComposerJS.truthy(post?["record"])
      || ComposerJS.truthy(post?["card"])
  }

  public static func postHasContent(_ post: PostDraft) -> Bool { postHasContent(post.json) }

  /// Whether the composer holds nothing worth keeping.
  public static func isEmptyComposer(_ state: JSONValue?) -> Bool {
    !ComposerJS.list(state?["posts"]).contains(where: { postHasContent($0) })
  }

  public static func isEmptyComposer(_ state: ComposerState) -> Bool { isEmptyComposer(state.json) }

  // MARK: Self-labels

  /// Labels as the record's `labels` field, or nil when there are none.
  public static func labelsToSelfLabels(_ labels: JSONValue?) -> JSONValue? {
    let values = ComposerJS.unique(ComposerJS.stringList(labels).filter { selfLabels.jsIncludes($0) })
    if values.isEmpty { return nil }
    return [
      "$type": "com.atproto.label.defs#selfLabels",
      "values": .array(values.map { ["val": .string($0)] }),
    ]
  }

  public static func labelsToSelfLabels(_ labels: [String]) -> JSONValue? {
    labelsToSelfLabels(.array(labels.map(JSONValue.string)))
  }

  /// A record's `labels` field back to the composer's list.
  public static func selfLabelsToLabels(_ selfLabels: JSONValue?) -> [String] {
    let values = ComposerJS.list(selfLabels?["values"])
    let names = values.compactMap { value -> String? in
      guard let val = value["val"]?.stringValue, Self.selfLabels.jsIncludes(val) else { return nil }
      return val
    }
    return ComposerJS.unique(names)
  }

  // MARK: Validation

  /// What stops the composer from being published (or, with `forSchedule`,
  /// scheduled); empty when nothing does. `postIndex` is nil for problems
  /// that aren't one post's.
  ///
  /// Lengths are counted as they will be written: inline links collapsed and
  /// links shortened (`countComposerGraphemes`). `lifespanProblem` is the
  /// timers module's check, injected so this module never imports it. A
  /// scheduled time without an offset is read in `timeZone` (the web's local
  /// zone; nil is AppLocale's active one).
  public static func validateComposer(
    _ state: JSONValue?,
    now: Double = Date().timeIntervalSince1970 * 1000,
    forSchedule: Bool = false,
    requireAltText: Bool = false,
    lifespanProblem: ((JSONValue) -> String?)? = nil,
    timeZone: TimeZone? = nil
  ) -> [ComposerProblem] {
    var problems: [ComposerProblem] = []
    func problem(_ index: Int?, _ code: String, _ message: String) {
      problems.append(ComposerProblem(postIndex: index, code: code, message: message))
    }
    let posts = ComposerJS.list(ComposerJS.or(state?["posts"], nil))

    if !ComposerJS.truthy(state?["asDid"]) { problem(nil, "NO_ACCOUNT", "Choose an account to post as.") }
    if posts.count > maxPosts { problem(nil, "TOO_MANY_POSTS", "A thread can have up to \(maxPosts) posts.") }
    if !posts.contains(where: { postHasContent($0) }) { problem(nil, "EMPTY", "Write something first.") }

    for (i, post) in posts.enumerated() {
      if posts.count > 1 && !postHasContent(post) {
        problem(i, "POST_EMPTY", "Post \(i + 1) is empty. Write something or remove it.")
      }
      let text = ComposerJS.trimmed(post["text"])
      let graphemes = InlineLinks.countComposerGraphemes(text)
      if graphemes > maxPostGraphemes {
        problem(
          i, "TOO_LONG",
          "This post is \(graphemes - maxPostGraphemes) characters over the \(maxPostGraphemes) limit.")
      } else if RichText.utf8Length(InlineLinks.composerCountText(text)) > maxPostBytes {
        problem(i, "TOO_MANY_BYTES", "This post has too many emoji or special characters to fit.")
      }

      let images = ComposerJS.list(post["images"])
      if images.count > maxImages { problem(i, "TOO_MANY_IMAGES", "A post can have up to \(maxImages) images.") }
      if !images.isEmpty && ComposerJS.truthy(post["video"]) {
        problem(i, "MEDIA_CONFLICT", "A post can have images or a video, not both.")
      }
      if images.contains(where: { !ComposerJS.truthy($0["file"]) && !ComposerJS.truthy($0["blob"]) }) {
        problem(i, "IMAGE_MISSING", "An image needs to be added again before this can be posted.")
      }
      if requireAltText && images.contains(where: { ComposerJS.trimmed($0["alt"]).isEmpty }) {
        problem(i, "ALT_MISSING", "Add alt text to every image.")
      }
      if let video = post["video"], video.isTruthy {
        if !ComposerJS.truthy(video["file"]) && !ComposerJS.truthy(video["blob"]) {
          problem(i, "VIDEO_MISSING", "The video needs to be added again before this can be posted.")
        }
        if Graphemes.countGraphemes(textOf(ComposerJS.or(video["alt"], nil))) > Video.videoAltMaxGraphemes {
          problem(i, "ALT_TOO_LONG", "Video alt text can be up to \(Video.videoAltMaxGraphemes) characters.")
        }
        if forSchedule {
          problem(i, "SCHEDULE_VIDEO", "Posts with video can’t be scheduled. Post it now instead.")
        }
      }
      if let record = post["record"], record.isTruthy, !ComposerJS.truthy(record["cid"]) {
        problem(i, "RECORD_UNRESOLVED", "The attached post or feed couldn’t be found. Remove it or try again.")
      }
    }

    let tags = ComposerJS.list(ComposerJS.or(state?["tags"], nil))
    if tags.count > Tags.maxTags { problem(nil, "TOO_MANY_TAGS", "A post can have up to \(Tags.maxTags) tags.") }
    if tags.contains(where: { tag in
      let text = textOf(tag)
      return !tag.isTruthy || Graphemes.countGraphemes(text) > Tags.maxTagGraphemes
        || RichText.utf8Length(text) > Tags.maxTagBytes
    }) {
      problem(nil, "TAG_INVALID", "Tags can be up to \(Tags.maxTagGraphemes) characters.")
    }
    if ComposerJS.list(ComposerJS.or(state?["langs"], nil)).count > maxLangs {
      problem(nil, "TOO_MANY_LANGS", "Choose up to \(maxLangs) languages.")
    }
    let labels = ComposerJS.list(ComposerJS.or(state?["labels"], nil))
    if labels.contains(where: { !ComposerJS.includes(selfLabels, $0) }) {
      problem(nil, "LABEL_INVALID", "One of the content labels isn’t one Bluesky knows.")
    }
    if labels.filter({ ComposerJS.includes(adultLabels, $0) }).count > 1 {
      problem(nil, "LABEL_CONFLICT", "Choose one adult content label.")
    }
    if !ComposerJS.truthy(state?["reply"]), let rules = state?["gates"]?["reply"]?.arrayValue,
      rules.count > Gates.maxReplyRules
    {
      problem(nil, "GATES_TOO_MANY", "Choose up to \(Gates.maxReplyRules) groups who can reply.")
    }

    // A reply can be scheduled for a set time, but not queued: it answers one
    // post at one moment, not whichever slot comes free.
    let schedule = state?["schedule"]
    if forSchedule && ComposerJS.truthy(state?["reply"]) && schedule?["mode"] == "queue" {
      problem(nil, "QUEUE_REPLY", "A reply can’t wait in the queue. Schedule it for a set time instead.")
    }

    if forSchedule && schedule?["mode"] == "at" {
      let zone = timeZone ?? AppLocale.activeTimeZone()
      let at = JSDate.parse(schedule?["at"].map(\.jsString) ?? "undefined", timeZone: zone)
      let nowMs = JSDate.timeClip(now)
      if !at.isFinite {
        problem(nil, "SCHEDULE_INVALID", "Choose a time to post it.")
      } else if at < nowMs + scheduleMinLeadMs {
        problem(nil, "SCHEDULE_PAST", "Choose a time at least a minute from now.")
      } else if at > nowMs + scheduleMaxDays * 86_400_000 {
        problem(nil, "SCHEDULE_TOO_FAR", "Posts can be scheduled up to \(Int(scheduleMaxDays)) days ahead.")
      }
    }

    if let lifespanProblem, let lifespan = state?["lifespan"], ComposerJS.truthy(lifespan["enabled"]) {
      if let message = lifespanProblem(lifespan), !message.isEmpty {
        problem(nil, "LIFESPAN", message)
      }
    }

    return problems
  }

  public static func validateComposer(
    _ state: ComposerState,
    now: Date,
    forSchedule: Bool = false,
    requireAltText: Bool = false,
    lifespanProblem: ((JSONValue) -> String?)? = nil,
    timeZone: TimeZone? = nil
  ) -> [ComposerProblem] {
    validateComposer(
      state.json, now: now.timeIntervalSince1970 * 1000, forSchedule: forSchedule,
      requireAltText: requireAltText, lifespanProblem: lifespanProblem, timeZone: timeZone)
  }

  /// A value counted as text: a string itself, anything else its String form.
  static func textOf(_ value: JSONValue?) -> String {
    guard let value, value.isTruthy else { return "" }
    return value.stringValue ?? value.jsString
  }

  // MARK: Text

  /// Every post's text as it will be written, with its facets: inline links
  /// collapsed, mentions resolved (an unresolvable one stays plain text),
  /// links shortened. The one text pipeline publishing, drafts and
  /// scheduling share. Throws ComposerCancelledError when the task is
  /// cancelled before it starts or by the time it ends.
  public static func resolvePostTexts(
    _ state: JSONValue?,
    resolveMention: ResolveMention? = nil,
    validationCache: MentionValidationCache = .shared
  ) async throws -> [FacetedText] {
    if Task.isCancelled { throw ComposerCancelledError() }
    let posts = ComposerJS.list(ComposerJS.or(state?["posts"], nil))
    var results: [FacetedText] = []
    for post in posts {
      let text = ComposerJS.str(ComposerJS.or(post["text"], nil)).jsTrimmed()
      let detected = await InlineLinks.detectComposerFacets(
        text, DetectFacetsOptions(resolveMention: resolveMention, validationCache: validationCache))
      results.append(LinkShortening.shortenLinkFacets(detected.text, detected.facets))
    }
    if Task.isCancelled { throw ComposerCancelledError() }
    return results
  }

  public static func resolvePostTexts(
    _ state: ComposerState, resolveMention: ResolveMention? = nil,
    validationCache: MentionValidationCache = .shared
  ) async throws -> [FacetedText] {
    try await resolvePostTexts(state.json, resolveMention: resolveMention, validationCache: validationCache)
  }
}
