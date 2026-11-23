// schedule/scheduleSerialize.js held to scheduling.scheduleSerialize: the
// composer's state as the server's scheduling body, a row back as composer
// state, the two in a round trip, and the base64 images travel in.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

enum SerializeFixture {
  static let did = "did:plc:writer"
  /// 2026-09-01T12:00:00.000Z, the generator's clock.
  static let now: Double = 1_788_264_000_000
  static let at = "2026-09-01T17:00:00.000Z"
  static let mentions: JSONValue = ["friend.example.com": "did:plc:friend"]

  /// A clock whose waits end only when called off (the card image's
  /// re-encode always answers first).
  static let clock = NetworkClock(now: { now }) { _ in
    while !Task.isCancelled { try? await Task.sleep(nanoseconds: 3_600_000_000_000) }
  }

  /// Holds the bytes every `bytes:<base64>` ref in `value` names.
  static func hold(_ value: JSONValue?, in files: InMemoryComposerFiles) async {
    var stack = [value ?? .null]
    while let next = stack.popLast() {
      switch next {
      case .object(let members):
        if members["$file"] == .bool(true), let ref = members["ref"]?.stringValue, ref.hasPrefix("bytes:"),
          let data = Data(base64Encoded: String(ref.dropFirst(6)))
        {
          await files.hold(data, ref: ref)
        }
        stack.append(contentsOf: members.values)
      case .array(let items): stack.append(contentsOf: items)
      default: break
      }
    }
  }

  /// A result as the fixture holds it: files without lastModified or ref,
  /// long base64 as its length and SHA-256.
  static func settle(_ value: JSONValue, key: String? = nil) -> JSONValue {
    switch value {
    case .string(let text) where key == "base64" && text.utf16.count > 512:
      let digest = SHA256.hash(Array(text.utf8)).map { String(format: "%02x", $0) }.joined()
      return ["$length": .number(Double(text.utf16.count)), "$sha256": .string(digest)]
    case .array(let items):
      return .array(items.map { settle($0) })
    case .object(var members):
      if members["$file"] == .bool(true) {
        members["lastModified"] = nil
        members["ref"] = nil
      }
      return .object(members.reduce(into: [:]) { $0[$1.key] = settle($1.value, key: $1.key) })
    default:
      return value
    }
  }

  /// URL.createObjectURL as a case has it: a counter, absent, or throwing.
  static func previews(_ mode: String?) -> (@Sendable (JSONValue) throws -> String?)? {
    switch mode {
    case "count":
      let n = Locked(0)
      return { _ in
        let next = n.withLock { value -> Int in
          value += 1
          return value
        }
        return "blob:preview-\(next)"
      }
    case "throw":
      return { _ in throw JSError(message: "no previews") }
    default:
      return nil
    }
  }

  struct Run {
    let files: InMemoryComposerFiles
    let encoder: PublishEncoder
    var media: PublishMedia { PublishMedia(files: files, encoder: encoder, transport: MockTransport(), clock: clock) }
  }

  static func run(_ options: JSONValue?) -> Run {
    Run(files: InMemoryComposerFiles(now: { now }), encoder: PublishEncoder(options?["images"]))
  }

  /// The case's options, as the generator gives them to the web.
  static func options(_ o: JSONValue?, _ run: Run) -> ScheduleSerializeOptions {
    let keys = o?.objectValue?.keys.map { $0 } ?? []
    let has = { (key: String) in keys.contains(key) }
    let table = o?["loadImage"]
    let files = run.files
    var loadImage: (@Sendable (JSONValue) async throws -> ComposerFile?)?
    if let table {
      loadImage = { (image: JSONValue) async throws -> ComposerFile? in
        let found: JSONValue? = table[image["localRef"]?.stringValue ?? ""]
        if found == .string("throw") { throw JSError(message: "the device lost it") }
        guard let found, found.isTruthy else { return nil }
        await hold(found, in: files)
        return ComposerFile(json: found)
      }
    }
    let zone = o?["device"]?.stringValue.flatMap(TimeZone.init(identifier:)) ?? TimeZone(identifier: "UTC")!
    return ScheduleSerializeOptions(
      now: now,
      scheduledFor: has("scheduledFor") ? o?["scheduledFor"] : .string(at),
      queued: o?["queued"]?.boolValue,
      tz: has("tz") ? o?["tz"]?.stringValue : "America/New_York",
      repeat: has("repeat") ? o?["repeat"] : nil,
      repeatTz: o?["repeatTz"]?.stringValue,
      occurrence: o?["occurrence"]?.doubleValue,
      resolveMention: ComposerFixtures.tableResolver(mentions),
      validationCache: MentionValidationCache(),
      loadImage: loadImage,
      media: run.media,
      locale: "en-US",
      timeZone: zone)
  }

  /// A refusal as the generator records one.
  static func refusal(_ error: any Error) -> JSONValue {
    let object = ScheduledPostError.errorObject(error)
    var out: JSONValue = ["name": object["name"] ?? .null, "message": object["message"] ?? .null]
    for key in ["code", "postIndex", "imageId", "size", "limit"] {
      if let value = object[key] { out[key] = value }
    }
    return ["$error": out]
  }

  static func serialize(_ state: JSONValue?, _ o: JSONValue?, _ run: Run) async -> JSONValue {
    await hold(state, in: run.files)
    do {
      let body = try await ScheduleSerialize.serializeForSchedule(state, options(o, run))
      return settle([
        "body": body.json, "warnings": .array(body.warnings), "calls": .array(await run.encoder.calls),
      ])
    } catch {
      return refusal(error)
    }
  }
}

@Suite struct ScheduleSerializeParity {
  static let f = "scheduling.scheduleSerialize"

  @Test func constants() throws {
    for c in try cases(Self.f, "constants") {
      check(
        [
          "MAX_MEDIA_BASE64_CHARS": .number(Double(ScheduleSerialize.maxMediaBase64Chars)),
          "MAX_IMAGE_BYTES": .number(ScheduleSerialize.maxImageBytes),
        ], c)
    }
  }

  @Test func base64() async throws {
    for c in try cases(Self.f, "blobToBase64") {
      let bytes = (c.input["bytes"]?.arrayValue ?? []).compactMap { $0.intValue.map(UInt8.init) }
      check(.string(ScheduleSerialize.blobToBase64(Data(bytes))), c)
    }
    for c in try cases(Self.f, "blobToBase64Large") {
      let size = c.int("size")
      let data = Data((0..<size).map { UInt8(($0 * 7) % 256) })
      let files = InMemoryComposerFiles()
      await files.hold(data, ref: "big")
      let text = try await ScheduleSerialize.blobToBase64(
        ComposerFile(type: "", size: Double(size), ref: "big"), files: files)
      let digest = SHA256.hash(Array(text.utf8)).map { String(format: "%02x", $0) }.joined()
      check(["length": .number(Double(text.utf16.count)), "sha256": .string(digest)], c)
    }
    for c in try cases(Self.f, "base64ToFile") {
      let files = InMemoryComposerFiles()
      let result = await outcome {
        let file = try await ScheduleSerialize.base64ToFile(c.input["base64"], "image/png", "x.png", files: files)
        let bytes = try await files.bytes(of: file)
        return [
          "type": .string(file.type), "name": file.name.map(JSONValue.string) ?? .null, "size": .number(file.size),
          "bytes": .array(bytes.map { .number(Double($0)) }),
        ]
      }
      check(result, c)
    }
    for c in try cases(Self.f, "base64ToFileType") {
      let file = try await ScheduleSerialize.base64ToFile("YQ==", c.input["type"], "x", files: InMemoryComposerFiles())
      check(.string(file.type), c)
    }
  }

  @Test func serializeForSchedule() async throws {
    for c in try cases(Self.f, "serializeForSchedule") {
      let o = c.input["options"]
      let result = await SerializeFixture.serialize(c.input["state"], o, SerializeFixture.run(o))
      check(result, c)
    }
  }

  @Test func reconstructFromScheduled() async throws {
    for c in try cases(Self.f, "reconstructFromScheduled") {
      let files = InMemoryComposerFiles(now: { SerializeFixture.now })
      let input = c.input.objectValue ?? [:]
      let zone = ComposerFixtures.zone(c)
      let result = await outcome {
        let state = try await ScheduleSerialize.reconstructFromScheduled(
          c.input["row"], input.keys.contains("media") ? c.input["media"] : [:], asDid: c.input["asDid"]?.stringValue,
          files: files, makePreviewUrl: SerializeFixture.previews(c.input["previews"]?.stringValue), timeZone: zone)
        return SerializeFixture.settle(state.json)
      }
      checkCanon(result, c)
    }
  }

  @Test func roundTrip() async throws {
    for c in try cases(Self.f, "roundTrip") {
      let o = c.input["options"]
      let run = SerializeFixture.run(o)
      await SerializeFixture.hold(c.input["state"], in: run.files)
      let result = await outcome {
        let first = try await ScheduleSerialize.serializeForSchedule(c.input["state"], SerializeFixture.options(o, run))
        var payload = first.payload
        payload["mediaBytes"] = nil
        let row: JSONValue = [
          "id": "rt", "queued": .bool(first.queued), "scheduledFor": .string(first.scheduledFor), "payload": payload,
        ]
        let back = try await ScheduleSerialize.reconstructFromScheduled(
          row, first.payload["mediaBytes"], asDid: SerializeFixture.did, files: run.files,
          makePreviewUrl: SerializeFixture.previews("count"), timeZone: TimeZone(identifier: "UTC")!)
        var again = o?.objectValue ?? [:]
        again["scheduledFor"] = back.json["schedule"]?["mode"] == "queue" ? .string(first.scheduledFor) : .null
        again["queued"] = .null
        let second = try await ScheduleSerialize.serializeForSchedule(
          back.json, SerializeFixture.options(.object(again), run))
        return SerializeFixture.settle(["first": first.json, "state": back.json, "again": second.json])
      }
      checkCanon(result, c)
    }
  }
}

@Suite struct ScheduleSerializeBehaviour {
  @Test func warningsStayOutOfTheRequest() async throws {
    let run = SerializeFixture.run(["images": ["compress": "throw"]])
    let state: JSONValue = [
      "posts": [["text": "a link", "card": ["url": "https://example.com", "thumbFile": ["$file": true, "type": "image/jpeg", "size": 3]]]],
    ]
    let body = try await ScheduleSerialize.serializeForSchedule(
      state, ScheduleSerializeOptions(now: SerializeFixture.now, scheduledFor: .string(SerializeFixture.at), tz: "UTC", media: run.media))
    #expect(body.warnings == [["code": "CARD_THUMB_FAILED", "postIndex": 0]])
    #expect(body.json["warnings"] == nil)
    #expect(Set(body.json.objectValue?.keys.map { $0 } ?? []) == ["scheduledFor", "target", "queued", "payload"])
  }

  @Test func aRefusalReadsInVirgasWords() async {
    let run = SerializeFixture.run(nil)
    do {
      _ = try await ScheduleSerialize.serializeForSchedule(
        ["posts": [["text": "x", "video": ["status": "ready"]]]],
        ScheduleSerializeOptions(now: SerializeFixture.now, media: run.media))
      Issue.record("scheduled a video")
    } catch {
      #expect(ScheduledPostError.errorObject(error)["code"] == "SCHEDULE_VIDEO")
      #expect(ScheduledPostError.scheduleErrorMessage(error) == "Posts with video can’t be scheduled. Post it now instead.")
    }
  }

  @Test func aCancelledTaskStopsBeforeTheMedia() async throws {
    let run = SerializeFixture.run(nil)
    let task = Task {
      try await ScheduleSerialize.serializeForSchedule(
        ["posts": [["text": "hello"]]],
        ScheduleSerializeOptions(now: SerializeFixture.now, scheduledFor: .string(SerializeFixture.at), media: run.media))
    }
    task.cancel()
    await #expect(throws: ComposerCancelledError.self) { try await task.value }
  }
}
