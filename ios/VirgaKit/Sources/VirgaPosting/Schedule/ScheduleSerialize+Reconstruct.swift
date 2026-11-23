// Ports src/posting/schedule/scheduleSerialize.js
//
// A scheduled row back as composer state (reconstructFromScheduled), to
// edit and save back over the row. The web makes its files at once; here
// each image's bytes become a file through ComposerFiles, so the call is
// async. `makePreviewUrl(file)` is URL.createObjectURL's place (none by
// default: VirgaUI passes its own); a closure that throws or answers nil
// gives the image no preview, as the web's guarded call does.

import Foundation
import VirgaCore

extension ScheduleSerialize {
  /// What a row's files are made with.
  struct RowFiles {
    let files: any ComposerFiles
    let makePreviewUrl: (@Sendable (JSONValue) throws -> String?)?
  }

  /// A row's reply as ComposerState.reply: the refs it goes out with, and
  /// who it answers as far as the row remembers (the composer reads the
  /// post again to show it whole).
  static func replyFromRow(_ payload: JSONValue) -> JSONValue {
    guard let parent = payload["reply"]?["parent"], ComposerJS.truthy(parent["uri"]), ComposerJS.truthy(parent["cid"])
    else { return .null }
    let root = payload["reply"]?["root"]
    let ownRoot = ComposerJS.truthy(root?["uri"]) && ComposerJS.truthy(root?["cid"])
    var reply: [String: JSONValue] = [
      "uri": parent["uri"]!,
      "cid": parent["cid"]!,
      "root": ownRoot ? ["uri": root!["uri"]!, "cid": root!["cid"]!] : ["uri": parent["uri"]!, "cid": parent["cid"]!],
    ]
    if let hint = payload["replyTo"], TimerJS.isObject(hint) {
      if let text = hint["text"]?.stringValue { reply["text"] = .string(text) }
      if ComposerJS.truthy(hint["handle"]) || ComposerJS.truthy(hint["displayName"]) {
        let did = PostLink.parseRecordUri(parent["uri"]?.stringValue)?.did ?? ""
        reply["author"] = [
          "did": .string(did),
          "handle": ComposerJS.or(hint["handle"], "")!,
          "displayName": ComposerJS.or(hint["displayName"], "")!,
          "avatar": .null,
        ]
      }
    }
    return .object(reply)
  }

  /// `media?.[key]`, a key read as its String form.
  static func stored(_ media: JSONValue?, _ key: JSONValue?) -> JSONValue? {
    guard case .object(let members)? = media else { return nil }
    return members.jsValue(key.map(\.jsString) ?? "undefined")
  }

  static func imageFromSpec(_ spec: JSONValue, _ media: JSONValue?, _ n: Int, _ files: RowFiles) async throws
    -> JSONValue
  {
    let held = stored(media, spec["mediaId"])
    var base: [String: JSONValue] = [
      "id": .string(ComposerModel.newId("i")),
      "alt": .string(spec["alt"]?.stringValue ?? ""),
    ]
    let ratio = spec["aspectRatio"]
    if ComposerJS.greater(ratio?["width"], .number(0)) && ComposerJS.greater(ratio?["height"], .number(0)) {
      var kept: [String: JSONValue] = [:]
      kept["width"] = ratio?["width"]
      kept["height"] = ratio?["height"]
      base["aspectRatio"] = .object(kept)
    }
    guard ComposerJS.truthy(held?["base64"]) else {
      // Kept in place without bytes, so the composer asks for the image
      // again (validateComposer: IMAGE_MISSING) instead of the next save
      // dropping it.
      base["mime"] = ComposerJS.or(held?["encoding"], "image/jpeg")!
      base["size"] = 0
      return .object(base)
    }
    let file = try await base64ToFile(
      held?["base64"], held?["encoding"], "scheduled-image-\(n).\(extFor(held?["encoding"]))", files: files.files)
    base["file"] = file.json
    base["mime"] = .string(file.type)
    base["size"] = .number(file.size)
    if let make = files.makePreviewUrl, let url = (try? make(file.json)) ?? nil, !url.isEmpty {
      base["previewUrl"] = .string(url)
    }
    return .object(base)
  }

  static func cardFromSpec(_ spec: JSONValue, _ media: JSONValue?, _ files: RowFiles) async throws -> JSONValue {
    guard let uri = spec["uri"], uri.isTruthy else { return .null }
    var card: [String: JSONValue] = [
      "url": uri,
      "title": ComposerJS.or(spec["title"], "")!,
      "description": ComposerJS.or(spec["description"], "")!,
      "thumb": .null,
    ]
    if let refs = LinkCard.normalizeAssociatedRefs(spec["associatedRefs"]) { card["associatedRefs"] = .array(refs) }
    let held = ComposerJS.truthy(spec["thumbMediaId"]) ? stored(media, spec["thumbMediaId"]) : nil
    if ComposerJS.truthy(held?["base64"]) {
      let file = try await base64ToFile(
        held?["base64"], held?["encoding"], "scheduled-thumb.\(extFor(held?["encoding"]))", files: files.files)
      card["thumbFile"] = file.json
      // What the writer saw: their own image, not one the page offers.
      card["edited"] = true
    } else if let url = spec["thumbUrl"], url.isTruthy {
      card["thumb"] = url
    }
    return .object(card)
  }

  static func recordFromSpec(_ spec: JSONValue?) -> JSONValue {
    guard let uri = spec?["uri"], uri.isTruthy, let cid = spec?["cid"], cid.isTruthy else { return .null }
    let kind = PostLink.parseRecordUri(uri.stringValue)?.kind ?? "post"
    return ["kind": .string(kind.isEmpty ? "post" : kind), "uri": uri, "cid": cid]
  }

  static func applyEmbed(_ embed: JSONValue?, _ media: JSONValue?, _ post: JSONValue, _ files: RowFiles)
    async throws -> JSONValue
  {
    guard let embed, embed.isTruthy else { return post }
    var out = post
    switch embed["type"]?.stringValue {
    case "images":
      guard case .array(let listed)? = ComposerJS.or(embed["images"], []) else {
        throw ScheduleSerializeTypeError("(embed.images || []).map is not a function")
      }
      var images: [JSONValue] = []
      for (n, im) in listed.enumerated() {
        images.append(try await imageFromSpec(im, media, n, files))
      }
      out["images"] = .array(images)
      return out
    case "external":
      out["card"] = try await cardFromSpec(embed, media, files)
      return out
    case "record":
      out["record"] = recordFromSpec(embed)
      return out
    case "recordWithMedia":
      out["record"] = recordFromSpec(embed)
      return try await applyEmbed(embed["media"], media, out, files)
    default:
      return post
    }
  }

  static func postFromSpec(_ spec: JSONValue, _ media: JSONValue?, _ files: RowFiles) async throws -> JSONValue {
    let record = ComposerJS.or(spec["record"], [:]) ?? [:]
    // The stored text has links shortened, with the address in the facet,
    // and inline links as bare labels; both go back to what the writer
    // typed, or the next save schedules a shortened or missing link.
    let raw = ComposerJS.or(record["text"], "")
    let text = InlineLinks.composerTextFromRecord(raw?.stringValue ?? "", record["facets"]?.arrayValue)
    var post = ComposerModel.emptyPost().json
    post["text"] = .string(text)
    return try await applyEmbed(spec["embed"], media, post, files)
  }

  /// A scheduled row (and its media from getScheduledMedia) as composer
  /// state, to edit and save back over the row. Every post of a thread
  /// comes back; langs, labels and tags are read off the root, where every
  /// post carries them. The row's gates are kept as its own choice, and its
  /// timer as the writer's rule; a row with no timer has none, whatever the
  /// default. A scheduled reply keeps what it answers, and a repeating post
  /// its rule.
  ///
  /// - Parameters:
  ///   - row: as listScheduled / getScheduled return it.
  ///   - media: `{ [mediaId]: { base64, encoding } }`.
  ///   - asDid: the account the row is scheduled as.
  ///   - files: where the images' bytes become files.
  ///   - timeZone: the device's zone, for a time without an offset.
  /// Throws atob's Base64DecodeError for stored bytes that aren't base64.
  public static func reconstructFromScheduled(
    _ row: JSONValue?, _ media: JSONValue? = [:], asDid: String? = nil, files: any ComposerFiles,
    makePreviewUrl: (@Sendable (JSONValue) throws -> String?)? = nil, timeZone: TimeZone? = nil
  ) async throws -> ComposerState {
    let rowFiles = RowFiles(files: files, makePreviewUrl: makePreviewUrl)
    let payload = ComposerJS.or(row?["payload"], [:]) ?? [:]
    let listed = payload["posts"]?.arrayValue ?? []
    let specs: [JSONValue] = listed.isEmpty ? [[:]] : listed
    let root = ComposerJS.or(specs.first?["record"], [:]) ?? [:]
    let gates = ComposerJS.or(payload["gates"], [:]) ?? [:]
    let scheduledFor = ComposerJS.coalesce(row?["scheduledFor"], ComposerJS.coalesce(row?["scheduled_for"], nil))
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let at: Double? = ComposerJS.truthy(scheduledFor) ? TimerJS.dateMs(scheduledFor, timeZone: zone) : nil
    let queued = ComposerJS.truthy(row?["queued"])
    let repeatRule = queued ? nil : Repeat.normalizeRepeat(payload["repeat"])

    var posts: [JSONValue] = []
    for spec in specs { posts.append(try await postFromSpec(spec, media, rowFiles)) }

    var gateRules: [String: JSONValue] = [:]
    gateRules["threadgateAllow"] = ComposerJS.coalesce(gates["threadgate"], nil) ?? .null
    gateRules["postgateEmbeddingRules"] = ComposerJS.coalesce(gates["postgate"], nil) ?? .null
    var stateGates = Gates.gatesFromRules(.object(gateRules)).json
    stateGates["custom"] = true

    var schedule: JSONValue = .null
    if queued {
      schedule = ["mode": "queue"]
    } else if let at, at.isFinite, let iso = JSDate.toISOString(at) {
      schedule = ["mode": "at", "at": .string(iso)]
      if let repeatRule { schedule["repeat"] = (try? JSONValue(encoding: repeatRule)) ?? .null }
    }

    let lifespan: JSONValue = TimerJS.inZone(zone) {
      if let spec = payload["selfDestruct"], spec.isTruthy {
        var fields = ComposerJS.spread(spec)
        fields["enabled"] = true
        return SelfDestruct.readStoredTimer(.object(fields)).timer.json
      }
      return SelfDestruct.normalizeTimer(["enabled": false] as JSONValue).json
    }

    let clientKey = row?["clientKey"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? "virga"
    let state: JSONValue = [
      "posts": .array(posts),
      "reply": replyFromRow(payload),
      "tags": .array(Tags.normalizeTags(root["tags"]).map(JSONValue.string)),
      "langs": root["langs"]?.arrayValue.map(JSONValue.array) ?? [],
      "labels": .array(ComposerModel.selfLabelsToLabels(root["labels"]).map(JSONValue.string)),
      "gates": stateGates,
      "asDid": .string(asDid ?? ""),
      "schedule": schedule,
      "lifespan": lifespan,
      "source": [
        "kind": "scheduled",
        "id": ComposerJS.coalesce(row?["id"], nil) ?? .null,
        "clientKey": .string(clientKey),
      ],
    ]
    return ComposerModel.normalizeComposerState(state)
  }
}
