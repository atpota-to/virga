// lib/video.js held to composer.video: the checks and readers, and the
// service's exchanges replayed through MockTransport with a scripted
// agent minting the tokens.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

/// The write account's agent: hands out a case's tokens in turn (the last
/// again past the end), recording what it was asked for.
actor ScriptedAuthAgent: VideoServiceAuthAgent {
  let tokens: [JSONValue]
  var calls: [JSONValue] = []

  init(_ tokens: [JSONValue]) { self.tokens = tokens }

  func getServiceAuth(aud: String, lxm: String, exp: Int?) async throws -> JSONValue {
    var call: [String: JSONValue] = ["aud": .string(aud), "lxm": .string(lxm)]
    if let exp { call["exp"] = .number(Double(exp)) }
    let token = tokens[Swift.min(calls.count, tokens.count - 1)]
    calls.append(.object(call))
    if token == "throw" { throw JSError(message: "PDS said no") }
    if token.isNull { return [:] }
    return ["token": token]
  }
}

@Suite struct VideoParity {
  static let f = "composer.video"

  /// The generator's crypto.getRandomValues.
  static func fixedRandom(_ count: Int) -> [UInt8] { (0..<count).map { UInt8(($0 * 37 + 11) % 256) } }

  @Test func readers() throws {
    for c in try cases(Self.f, "videoConstants") {
      check(
        [
          "VIDEO_SERVICE_HOST": .string(Video.videoServiceHost),
          "VIDEO_SERVICE_URL": .string(Video.videoServiceUrl),
          "VIDEO_SERVICE_DID": .string(Video.videoServiceDid),
          "VIDEO_MAX_SIZE_BYTES": .number(Video.videoMaxSizeBytes),
          "VIDEO_MAX_SIZE_LABEL": .string(Video.videoMaxSizeLabel),
          "VIDEO_MAX_DURATION_SECONDS": .number(Double(Video.videoMaxDurationSeconds)),
          "VIDEO_SUPPORTED_MIME_TYPES": json(Video.videoSupportedMimeTypes),
          "VIDEO_FILE_INPUT_ACCEPT": .string(Video.videoFileInputAccept),
          "VIDEO_ALT_MAX_GRAPHEMES": .number(Double(Video.videoAltMaxGraphemes)),
          "VIDEO_UPLOAD_TOKEN_TTL_SECONDS": .number(Double(Video.videoUploadTokenTtlSeconds)),
          "VIDEO_POLL_MAX_TIME_MS": .number(Video.videoPollMaxTimeMs),
          "VIDEO_POLL_INTERVAL_MS": .number(Video.videoPollIntervalMs),
          "VIDEO_POLL_FAILURE_INTERVAL_MS": .number(Video.videoPollFailureIntervalMs),
          "VIDEO_POLL_MAX_CONSECUTIVE_FAILURES": .number(Double(Video.videoPollMaxConsecutiveFailures)),
          "VIDEO_POLL_MAX_COMPLETED_WITHOUT_BLOB": .number(Double(Video.videoPollMaxCompletedWithoutBlob)),
        ], c)
    }
    for c in try cases(Self.f, "videoServiceUrl") {
      let entries: [(String, JSONValue?)] = (c.input["entries"]?.arrayValue ?? []).map {
        ($0[0]?.stringValue ?? "", $0[1])
      }
      check(.string(Video.videoServiceUrl(c.string("route") ?? "", entries)), c)
    }
    for c in try cases(Self.f, "formatVideoSize") { check(.string(Video.formatVideoSize(c.input["bytes"])), c) }
    for c in try cases(Self.f, "validateVideoFile") { check(json(Video.validateVideoFile(c.input["file"])), c) }
    for c in try cases(Self.f, "normalizeJobStatus") { check(Video.normalizeJobStatus(c.input["result"]) ?? .null, c) }
    for c in try cases(Self.f, "isUsableVideoBlob") { check(.bool(Video.isUsableVideoBlob(c.input["blob"])), c) }
    for c in try cases(Self.f, "videoLimitMessage") { check(.string(Video.videoLimitMessage(c.input["message"])), c) }
  }

  @Test func getVideoUploadLimits() async throws {
    for c in try cases(Self.f, "getVideoUploadLimits") {
      let recorded = RecordedFetch(c.output)
      let transport = recorded.transport()
      let agent = ScriptedAuthAgent(c.input["tokens"]?.arrayValue ?? [])
      let target = VideoTarget(did: "did:plc:mira", pdsUrl: nil, agent: agent)
      let result = await RecordedFetch.outcome { try await Video.getVideoUploadLimits(target, transport: transport) }
      let d = recorded.check(sent: transport.requests, result: result)
      #expect(d == nil, "\(c): \(d ?? "")")
      checkPart(.array(await agent.calls), c.output["auth"] ?? [], c, "auth")
    }
  }

  @Test func pollVideoJobStatus() async throws {
    for c in try cases(Self.f, "pollVideoJobStatus") {
      let recorded = RecordedFetch(c.output)
      let transport = recorded.transport()
      let clock = RecordingClock()
      let o = c.input["options"] ?? [:]
      let options = VideoPollOptions(
        pollIntervalMs: o["pollIntervalMs"]?.doubleValue ?? 10,
        failureIntervalMs: o["failureIntervalMs"]?.doubleValue,
        maxPollTimeMs: o["maxPollTimeMs"]?.doubleValue ?? Video.videoPollMaxTimeMs,
        maxConsecutiveFailures: o["maxConsecutiveFailures"]?.intValue ?? 3,
        maxCompletedWithoutBlobPolls: o["maxCompletedWithoutBlobPolls"]?.intValue ?? Video.videoPollMaxCompletedWithoutBlob)
      let progress = Locked<[JSONValue]>([])
      let result = await RecordedFetch.outcome {
        try await Video.pollVideoJobStatus(
          "j 1", token: .value("tok-job"), onProgress: { p in progress.withLock { $0.append(json(p)) } },
          options: options, transport: transport, clock: clock.clock)
      }
      let d = recorded.check(sent: transport.requests, result: result, waits: clock.waits)
      #expect(d == nil, "\(c): \(d ?? "")")
      checkPart(.array(progress.withLock { $0 }), c.output["progress"] ?? [], c, "progress")
    }
  }

  @Test func uploadVideo() async throws {
    for c in try cases(Self.f, "uploadVideo") {
      let recorded = RecordedFetch(c.output)
      let transport = recorded.transport()
      let clock = RecordingClock()
      let agent = ScriptedAuthAgent(c.input["tokens"]?.arrayValue ?? [])
      let target = VideoTarget(did: "did:plc:mira", pdsUrl: c.string("pdsUrl"), agent: agent)
      let size = c.input["file"]?["size"]?.intValue ?? 0
      let file = VideoFile(type: c.input["file"]?["type"]?.stringValue ?? "", data: Data(count: size))
      let progress = Locked<[JSONValue]>([])
      let now = clock.now
      let result = await RecordedFetch.outcome {
        json(
          try await Video.uploadVideo(
            target, file, onProgress: { p in progress.withLock { $0.append(json(p)) } }, now: { now },
            poll: VideoPollTuning(pollIntervalMs: 10), transport: transport, clock: clock.clock,
            randomBytes: Self.fixedRandom))
      }
      let d = recorded.check(sent: transport.requests, result: result, waits: clock.waits)
      #expect(d == nil, "\(c): \(d ?? "")")
      checkPart(.array(await agent.calls), c.output["auth"] ?? [], c, "auth")
      checkPart(.array(progress.withLock { $0 }), c.output["progress"] ?? [], c, "progress")
    }
  }
}

/// Checks one part of a case's output.
func checkPart(
  _ actual: JSONValue, _ expected: JSONValue, _ c: ParityCase, _ label: String,
  sourceLocation: SourceLocation = #_sourceLocation
) {
  let d = Parity.diff(actual, expected)
  #expect(d == nil, "\(c) \(label): \(d ?? "")", sourceLocation: sourceLocation)
}
