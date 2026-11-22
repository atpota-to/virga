// Parity for src/posting/lib/publish.js (fixture publish.publish): the
// signature two publishes share, the duplicate guard, the records a state
// becomes, and whole publishes replayed from MockTransport: the PDS behind
// Virga's server, the video service and a card image's host, with the
// progress events and the re-encoder's calls.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

/// The result a fixture records of a publish: the result, or `{ $error }`.
func publishedJSON(_ body: () async throws -> PublishResult) async -> JSONValue {
  do {
    return json(try await body())
  } catch let error as PublishError {
    return [
      "$error": [
        "message": .string(error.message), "name": .string(error.name), "code": .string(error.code),
        "status": error.status.map { .number(Double($0)) } ?? .null,
        "problems": error.problems.map { json($0) } ?? .null,
      ]
    ]
  } catch {
    return ["$throws": .string(jsMessage(error))]
  }
}

/// A list compared as a multiset: work that runs side by side reports in any order.
func sortedByJSON(_ list: JSONValue?) -> JSONValue {
  .array((list?.arrayValue ?? []).sorted { $0.jsonString() < $1.jsonString() })
}

@Suite struct PublishParity {
  static let f = "publish.publish"

  static func fixedRandom(_ count: Int) -> [UInt8] { (0..<count).map { UInt8(($0 * 37 + 11) % 256) } }

  @Test func constants() throws {
    for c in try cases(Self.f, "publishConstants") {
      check(
        [
          "IMAGE_UPLOAD_CONCURRENCY": .number(Double(Publish.imageUploadConcurrency)),
          "DUPLICATE_WINDOW_MS": .number(Publish.duplicateWindowMs),
        ], c)
    }
  }

  @Test func publishSignature() throws {
    for c in try cases(Self.f, "publishSignature") {
      let signature = Publish.publishSignature(c.input["state"], c.string("did"))
      #expect(c.output.stringValue?.jsEquals(signature) == true, "\(c): \(signature) ≠ \(c.output)")
    }
  }

  @Test func createDuplicateGuard() throws {
    for c in try cases(Self.f, "createDuplicateGuard") {
      let t = Locked(0.0)
      let guardian = Publish.createDuplicateGuard(
        windowMs: c.input["windowMs"]?.doubleValue ?? Publish.duplicateWindowMs, now: { t.wrappedValue })
      var out: [JSONValue] = []
      for step in c.input["steps"]?.arrayValue ?? [] {
        t.withLock { $0 = step[2]?.doubleValue ?? 0 }
        let signature = step[1]?.stringValue ?? ""
        switch step[0]?.stringValue {
        case "isDuplicate": out.append(.bool(guardian.isDuplicate(signature)))
        case "remember":
          guardian.remember(signature)
          out.append(.null)
        default:
          guardian.clear()
          out.append(.null)
        }
      }
      check(.array(out), c)
    }
  }

  @Test func buildPostRecords() throws {
    for c in try cases(Self.f, "buildPostRecords") {
      let now: Double
      switch c.input["now"] {
      case .number(let n)?: now = n
      case .string?: now = .nan
      default: now = PublishFixture.now
      }
      let result = outcome {
        .array(
          try Publish.buildPostRecords(
            c.input["state"] ?? .null, nowMs: now, blobs: c.input["blobs"]?.arrayValue ?? [],
            texts: c.input["texts"]?.arrayValue ?? []))
      }
      check(result, c)
    }
  }

  @Test func publish() async throws {
    for c in try cases(Self.f, "publish") {
      let transport = CountingTransport(replayTransport(c.output))
      let timers = ScriptedTimers(c.output["fired"], transport: transport)
      let encoder = PublishEncoder(c.input["images"])
      let media = publishMedia(transport, timers, encoder: encoder)
      let who = c.string("target") ?? "me"
      let did = who == "other" ? PublishFixture.other : PublishFixture.me
      let target: PublishTarget? =
        who == "none"
        ? nil : PublishTarget(did: did, agent: PublishFixture.agent(transport, did: did), pdsUrl: "https://pds.example.com")
      let mentions = c.input["mentions"]?.objectValue ?? [:]
      let events = Locked<[JSONValue]>([])
      let result = await publishedJSON {
        try await Publish.publish(
          c.input["state"], target, media: media, onProgress: { e in events.withLock { $0.append(e) } },
          resolveMention: { handle in mentions[handle]?.stringValue }, now: { PublishFixture.now },
          requireAltText: c.input["options"]?["requireAltText"] == .bool(true), duplicateGuard: nil,
          uploadVideo: Publish.defaultUploadVideo(media: media, now: { PublishFixture.now }, randomBytes: Self.fixedRandom),
          validationCache: MentionValidationCache(), mintTid: FixedTIDs().mint, timeZone: TimeZone(identifier: "UTC")!)
      }
      let uploads = (c.input["state"]?["posts"]?.arrayValue ?? []).reduce(0) { $0 + ($1["images"]?.arrayValue?.count ?? 0) }
      checkReplay(c, sent: transport.requests, result: result, waits: timers.waits, ordered: uploads <= 1)
      // Strict about nulls: an event's member the web leaves undefined is absent, one it sets to null is null.
      let d = Parity.diff(
        sortedByJSON(.array(events.withLock { $0 })), sortedByJSON(c.output["events"]), path: "events", strictNulls: true)
      #expect(d == nil, "\(c) events: \(d ?? "")")
      checkPart(.array(await encoder.calls), c.output["calls"] ?? [], c, "calls")
    }
  }

  @Test func publishTwice() async throws {
    for c in try cases(Self.f, "publishTwice") {
      let transport = CountingTransport(replayTransport(c.output))
      let timers = ScriptedTimers(nil, transport: transport)
      let media = publishMedia(transport, timers, encoder: PublishEncoder(nil))
      let target = PublishTarget(
        did: PublishFixture.me, agent: PublishFixture.agent(transport), pdsUrl: "https://pds.example.com")
      let t = Locked(0.0)
      let guardian = Publish.createDuplicateGuard(now: { t.wrappedValue })
      let tids = FixedTIDs()
      var results: [JSONValue] = []
      for step in c.input["steps"]?.arrayValue ?? [] {
        t.withLock { $0 = step.doubleValue ?? 0 }
        do {
          let r = try await Publish.publish(
            c.input["state"], target, media: media, resolveMention: { _ in nil }, now: { PublishFixture.now },
            duplicateGuard: guardian, validationCache: MentionValidationCache(), mintTid: tids.mint,
            timeZone: TimeZone(identifier: "UTC")!)
          results.append(["ok": json(r.root)])
        } catch let error as PublishError {
          results.append(["code": .string(error.code), "message": .string(error.message)])
        }
      }
      checkReplay(c, sent: transport.requests, result: .array(results), waits: timers.waits)
    }
  }
}

@Suite struct PublishBehaviour {
  static func state(images: [JSONValue] = []) -> ComposerState {
    var state = ComposerModel.emptyComposerState(asDid: PublishFixture.me, langs: ["en"])
    var post = ComposerModel.emptyPost()
    post.text = "x"
    post.json["images"] = .array(images)
    state.posts = [post]
    return state
  }

  static func media(_ transport: any HTTPTransport) -> PublishMedia {
    PublishMedia(
      files: InMemoryComposerFiles(), encoder: PublishEncoder(nil), transport: transport,
      clock: ScriptedTimers(nil).clock)
  }

  /// publish.test.js: cancels during uploads and writes nothing.
  @Test func cancelledDuringUploadsWritesNothing() async throws {
    let transport = MockTransport()
    let uploading = AsyncGate()
    transport.on("POST", .urlPrefix("https://server.example/api/oauth/upload-blob")) { _ in
      uploading.open()
      try await Task.sleep(nanoseconds: 3_600_000_000_000)
      return .status(500)
    }
    let image: JSONValue = ["id": "i", "alt": "", "file": ComposerFile(name: "a.jpg", type: "image/jpeg", size: 2).json]
    let state = Self.state(images: [image])
    let target = PublishTarget(did: PublishFixture.me, agent: PublishFixture.agent(transport))
    let media = Self.media(transport)
    let task = Task {
      try await Publish.publish(state, target, media: media, duplicateGuard: nil)
    }
    await uploading.wait()
    task.cancel()
    let outcome = await task.result
    guard case .failure(let error as PublishError) = outcome else {
      Issue.record("expected a PublishError, got \(outcome)")
      return
    }
    #expect(error.code == "ABORTED")
    #expect(error.message == "Cancelled.")
    #expect(transport.requests.count == 1)
    #expect(ComposerSubmit.publishErrorView(error).silent)
  }

  /// The progress a single image reports, in order, then the write.
  @Test func progressInOrder() async throws {
    let transport = MockTransport()
    transport.on("POST", .urlPrefix("https://server.example/api/oauth/upload-blob")) { _ in
      .json([
        "success": true,
        "data": ["blob": ["$type": "blob", "ref": ["$link": "bafkreiup"], "mimeType": "image/jpeg", "size": 2]],
      ])
    }
    transport.on("POST", .url("https://server.example/api/oauth/proxy")) { _ in
      .json(["success": true, "data": ["uri": "at://did:plc:writer/app.bsky.feed.post/3k", "cid": "bafyc"]])
    }
    let image: JSONValue = ["id": "i", "alt": "", "file": ComposerFile(name: "a.jpg", type: "image/jpeg", size: 2).json]
    let events = Locked<[String]>([])
    let target = PublishTarget(did: PublishFixture.me, agent: PublishFixture.agent(transport))
    let result = try await Publish.publish(
      Self.state(images: [image]), target, media: Self.media(transport),
      onProgress: { e in
        events.withLock { $0.append("\(e["phase"]?.stringValue ?? "")/\(e["kind"]?.stringValue ?? e["count"]?.jsString ?? "")") }
      }, duplicateGuard: nil)
    #expect(events.wrappedValue == ["uploading/images", "uploaded/image", "uploading/images", "writing/1"])
    #expect(result.root?.uri == "at://did:plc:writer/app.bsky.feed.post/3k")
    #expect(result.warnings.isEmpty)
  }

  /// The composer's error view reads a publish failure's code.
  @Test func errorViews() {
    let scope = PublishError("MISSING_SCOPE", "Virga needs permission to post. Sign in again to grant it.", status: 403)
    #expect(ComposerSubmit.publishErrorView(scope).permission)
    let failed = PublishError("WRITE_FAILED", "  Bad record ", status: 0)
    #expect(failed.status == nil)
    #expect(ComposerSubmit.publishErrorView(failed).message == "Bad record")
  }
}
