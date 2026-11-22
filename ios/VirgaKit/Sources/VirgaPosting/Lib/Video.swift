// Ports src/posting/lib/video.js
//
// Video for posts, through Bluesky's video service: one upload of the whole
// file, then the service's job is polled until it hands back the blob it
// wrote to the account's PDS. Everything is done as the write account: its
// PDS mints the service-auth tokens, so the blob lands in the repo the post is
// written to.
//
// The service needs two kinds of token. Calls about the account (upload
// limits, job status) carry one addressed to the service itself. The upload
// carries one addressed to the account's PDS for `com.atproto.repo.uploadBlob`,
// which the service presents when it writes the processed blob there.
//
// On iOS this is all network: the bytes are the app's (a picked movie read
// into Data), and nothing here needs AVFoundation. Requests go through
// VirgaNetwork's HTTPTransport, waits and the clock through its NetworkClock,
// and the tokens through the write account's agent (VideoServiceAuthAgent,
// which XRPCAgent is). Cancelling the task is the web's AbortSignal.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaRepo

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// Mints service-auth tokens as the write account: `getServiceAuth`'s
/// answer body (`res.data`, `{ token }`).
public protocol VideoServiceAuthAgent: Sendable {
  func getServiceAuth(aud: String, lxm: String, exp: Int?) async throws -> JSONValue
}

extension XRPCAgent: VideoServiceAuthAgent {
  public func getServiceAuth(aud: String, lxm: String, exp: Int?) async throws -> JSONValue {
    var params: XRPCParams = ["aud": .string(aud), "lxm": .string(lxm)]
    if let exp { params = ["aud": .string(aud), "lxm": .string(lxm), "exp": .integer(exp)] }
    return try await query("com.atproto.server.getServiceAuth", params).data
  }
}

/// Who a video goes up as: `{ did, agent, pdsUrl }`.
public struct VideoTarget: Sendable {
  public var did: String
  public var pdsUrl: String?
  public var agent: any VideoServiceAuthAgent

  public init(did: String, pdsUrl: String?, agent: any VideoServiceAuthAgent) {
    self.did = did
    self.pdsUrl = pdsUrl
    self.agent = agent
  }
}

/// The video to send: its type and size (what the checks read) and its bytes.
public struct VideoFile: Sendable, Hashable {
  public var type: String
  public var size: Double
  public var data: Data

  public init(type: String, data: Data) {
    self.type = type
    self.size = Double(data.count)
    self.data = data
  }

  /// A file whose size is given apart from its bytes (for the checks only).
  public init(type: String, size: Double, data: Data = Data()) {
    self.type = type
    self.size = size
    self.data = data
  }

  /// The file as validateVideoFile reads it.
  public var json: JSONValue { ["type": .string(type), "size": .number(size)] }
}

/// validateVideoFile's answer: `{ ok: true }` or `{ ok: false, code, message }`.
public struct VideoFileCheck: Codable, Hashable, Sendable {
  public var ok: Bool
  public var code: String?
  public var message: String?

  public static let ok = VideoFileCheck(ok: true, code: nil, message: nil)
}

/// A video failure with a sentence the composer can show as it is.
public struct VideoError: Error, LocalizedError, Sendable {
  public let name = "VideoError"
  public var message: String
  public var code: String
  public var status: Int?
  /// The job's own failure code and error (a failed job).
  public var failureCode: JSONValue?
  public var jobError: JSONValue?
  /// What it came from, as `err.cause.message`.
  public var causeMessage: String?

  public init(_ message: String, code: String = "VIDEO_FAILED", status: Int? = nil, cause: (any Error)? = nil) {
    self.message = message
    self.code = code
    self.status = status
    causeMessage = cause.map(jsMessage)
  }

  public var errorDescription: String? { message }
}

/// The upload was called off (the web's AbortError).
public struct VideoCancelledError: Error, LocalizedError, Hashable, Sendable {
  public let name = "AbortError"
  public let canceled = true
  public init() {}
  public var errorDescription: String? { "The video upload was cancelled." }
}

/// What uploadVideo hands back: the blob as a record carries it, and the job.
public struct UploadedVideo: Codable, Hashable, Sendable {
  public var blob: JSONValue
  public var jobId: String?

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(blob, forKey: .blob)
    try container.encode(jobId, forKey: .jobId)  // null, as the web writes it
  }
}

/// A step of an upload, for the busy line: `{ phase, progress? }`.
public struct VideoProgress: Codable, Hashable, Sendable {
  /// 'checking' | 'uploading' | 'processing'.
  public var phase: String
  /// The service's progress as it sent it (`s.progress || 0`), while processing.
  public var progress: JSONValue?

  public init(phase: String, progress: JSONValue? = nil) {
    self.phase = phase
    self.progress = progress
  }

  /// The progress as a number (0 when there is none).
  public var progressValue: Double { progress?.jsNumber ?? 0 }
}

/// A poll's report: `{ state, progress, message }`.
public struct VideoJobProgress: Codable, Hashable, Sendable {
  public var state: JSONValue?
  public var progress: JSONValue
  public var message: JSONValue?
}

/// How a job is polled (pollVideoJobStatus's options).
public struct VideoPollOptions: Sendable, Hashable {
  public var pollIntervalMs: Double
  /// The wait after a failed poll; nil waits `pollIntervalMs × (failures + 1)`.
  public var failureIntervalMs: Double?
  public var maxPollTimeMs: Double
  public var maxConsecutiveFailures: Int
  public var maxCompletedWithoutBlobPolls: Int

  public init(
    pollIntervalMs: Double = 1000,
    failureIntervalMs: Double? = nil,
    maxPollTimeMs: Double = Video.videoPollMaxTimeMs,
    maxConsecutiveFailures: Int = 3,
    maxCompletedWithoutBlobPolls: Int = Video.videoPollMaxCompletedWithoutBlob
  ) {
    self.pollIntervalMs = pollIntervalMs
    self.failureIntervalMs = failureIntervalMs
    self.maxPollTimeMs = maxPollTimeMs
    self.maxConsecutiveFailures = maxConsecutiveFailures
    self.maxCompletedWithoutBlobPolls = maxCompletedWithoutBlobPolls
  }
}

/// A caller's tuning for uploadVideo's poll (`options.poll`): each set field
/// overrides uploadVideo's long-video numbers.
public struct VideoPollTuning: Sendable, Hashable {
  public var pollIntervalMs: Double?
  public var failureIntervalMs: Double??
  public var maxPollTimeMs: Double?
  public var maxConsecutiveFailures: Int?
  public var maxCompletedWithoutBlobPolls: Int?

  public init(
    pollIntervalMs: Double? = nil, failureIntervalMs: Double?? = nil, maxPollTimeMs: Double? = nil,
    maxConsecutiveFailures: Int? = nil, maxCompletedWithoutBlobPolls: Int? = nil
  ) {
    self.pollIntervalMs = pollIntervalMs
    self.failureIntervalMs = failureIntervalMs
    self.maxPollTimeMs = maxPollTimeMs
    self.maxConsecutiveFailures = maxConsecutiveFailures
    self.maxCompletedWithoutBlobPolls = maxCompletedWithoutBlobPolls
  }
}

public enum Video {
  public static let videoServiceHost = "video.bsky.app"
  public static let videoServiceUrl = "https://\(videoServiceHost)"
  public static let videoServiceDid = "did:web:\(videoServiceHost)"

  // ISO megabytes: the service refuses at exactly 300,000,000 bytes.
  public static let videoMaxSizeBytes: Double = 300 * 1000 * 1000
  public static let videoMaxSizeLabel = "300 MB"
  public static let videoMaxDurationSeconds = 600
  public static let videoSupportedMimeTypes = ["video/mp4", "video/quicktime", "video/webm", "video/mpeg"]
  public static let videoFileInputAccept = videoSupportedMimeTypes.joined(separator: ",")
  public static let videoAltMaxGraphemes = 1000

  // The upload token outlives a slow upload of a large file, and stays under
  // an hour, the longest a PDS will mint one for.
  public static let videoUploadTokenTtlSeconds = 30 * 60

  // A ten-minute video routinely takes more than five minutes to process.
  public static let videoPollMaxTimeMs: Double = 30 * 60 * 1000
  public static let videoPollIntervalMs: Double = 1500
  public static let videoPollFailureIntervalMs: Double = 5000
  public static let videoPollMaxConsecutiveFailures = 50
  // Grace polls for a job reported complete before its blob shows up.
  public static let videoPollMaxCompletedWithoutBlob = 5

  static let mimeExtensions = [
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/mpeg": "mpeg",
  ]

  // What the service says when it refuses, in plain words.
  static let limitMessages: [String: String] = [
    "User is not allowed to upload videos": "This account isn’t able to upload videos.",
    "Uploading is disabled at the moment": "Video uploads are turned off for now. Try again later.",
    "Failed to get user's upload stats":
      "Couldn’t tell whether this account can upload video right now. Try again.",
    "User has exceeded daily upload bytes limit":
      "This account has reached today’s video upload limit. It resets tomorrow.",
    "User has exceeded daily upload videos limit":
      "This account has reached today’s limit on videos. It resets tomorrow.",
    "Account is not old enough to upload videos": "This account isn’t old enough to upload video yet.",
    "Confirm your email address to upload videos": "Confirm this account’s email address to upload video.",
  ]

  /// An absolute video-service URL, dropping nullish params.
  /// `route` is the path set as the URL's pathname (a leading '/' is
  /// supplied when missing, as the setter does); `params` are the entries
  /// of the web's params object, in order.
  public static func videoServiceUrl(_ route: String, _ params: [(String, JSONValue?)] = []) -> String {
    let route = PostingJS.hasPrefix(route, "/") ? route : "/" + route
    var pairs: [(String, String)] = []
    for (key, value) in params {
      guard let value, !value.isNull else { continue }
      if let index = pairs.firstIndex(where: { $0.0.jsEquals(key) }) {
        pairs[index].1 = value.jsString
      } else {
        pairs.append((key, value.jsString))
      }
    }
    let query = JSURI.searchParams(pairs)
    return videoServiceUrl + route + (query.isEmpty ? "" : "?\(query)")
  }

  /// `1234567` → `'1.2 MB'`, in the service's ISO megabytes.
  public static func formatVideoSize(_ bytes: JSONValue?) -> String {
    let value = bytes?.jsNumber ?? .nan
    guard value.isFinite, value > 0 else { return "0.0 MB" }
    return "\((value / 1000 / 1000).jsToFixed(1)) MB"
  }

  public static func formatVideoSize(_ bytes: Double) -> String { formatVideoSize(.number(bytes)) }

  /// Whether a file can be sent: a supported type, not empty, not over the
  /// size limit. The file is read as the web reads it (`file.size`, `file.type`).
  public static func validateVideoFile(_ file: JSONValue?) -> VideoFileCheck {
    guard let file, file.isTruthy, let size = file["size"]?.doubleValue else {
      return VideoFileCheck(ok: false, code: "VIDEO_MISSING", message: "Choose a video to add.")
    }
    guard ComposerJS.includes(videoSupportedMimeTypes, file["type"]) else {
      return VideoFileCheck(ok: false, code: "VIDEO_TYPE", message: "Videos can be MP4, MOV, WebM or MPEG.")
    }
    if size <= 0 { return VideoFileCheck(ok: false, code: "VIDEO_EMPTY", message: "This video file is empty.") }
    if size > videoMaxSizeBytes {
      return VideoFileCheck(
        ok: false, code: "VIDEO_TOO_LARGE",
        message: "Videos can be up to \(videoMaxSizeLabel); this one is \(formatVideoSize(size)).")
    }
    return .ok
  }

  public static func validateVideoFile(_ file: VideoFile?) -> VideoFileCheck { validateVideoFile(file?.json) }

  /// The job status in a service answer: getJobStatus wraps it in
  /// `{ jobStatus }`, uploadVideo returns it flat.
  public static func normalizeJobStatus(_ result: JSONValue?) -> JSONValue? {
    // An array is an object too, but has no jobId, state or blob.
    guard let result, case .object = result else { return nil }
    let status: JSONValue = ComposerJS.isObject(result["jobStatus"]) ? result["jobStatus"]! : result
    // (Not `cond ? status : nil`: JSONValue takes a nil literal as null.)
    guard ComposerJS.truthy(status["jobId"]) || ComposerJS.truthy(status["state"]) || ComposerJS.truthy(status["blob"])
    else { return nil }
    return status
  }

  /// Whether a blob is one a record can carry. Only a blob the service sent
  /// will do; one made up from a job id would publish a video that never loads.
  public static func isUsableVideoBlob(_ blob: JSONValue?) -> Bool {
    guard let blob else { return false }
    switch blob {
    case .object, .array: break
    default: return false
    }
    if let link = blob["ref"]?["$link"]?.stringValue, !link.isEmpty { return true }
    if let cid = blob["cid"]?.stringValue, !cid.isEmpty { return true }
    return false
  }

  /// The limit message as a sentence, or the service's own words.
  public static func videoLimitMessage(_ message: JSONValue?) -> String {
    if let text = message?.stringValue, let known = limitMessages.jsValue(text) { return known }
    if let message, message.isTruthy { return message.stringValue ?? message.jsString }
    return "This account can’t upload video right now."
  }

  public static func videoLimitMessage(_ message: String?) -> String {
    videoLimitMessage(message.map(JSONValue.string))
  }

  // MARK: Polling

  /// A token for the poll: one in hand, or a way to mint one.
  public enum Token: Sendable {
    case value(String)
    case mint(@Sendable () async throws -> String)
  }

  /// Poll a processing job until the service returns its blob. Resolves to
  /// the job status, always with a usable blob.
  public static func pollVideoJobStatus(
    _ jobId: JSONValue?,
    token: Token,
    onProgress: (@Sendable (VideoJobProgress) -> Void)? = nil,
    options: VideoPollOptions = VideoPollOptions(),
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock
  ) async throws -> JSONValue {
    let startTime = clock.now()
    var consecutiveFailures = 0
    var completedWithoutBlob = 0

    while true {
      if Task.isCancelled { throw VideoCancelledError() }
      if clock.now() - startTime > options.maxPollTimeMs {
        throw VideoError(
          "This video is still processing after a long wait. Try adding it again later.",
          code: "VIDEO_PROCESSING_TIMEOUT")
      }

      var jobStatus: JSONValue
      do {
        let bearer: String
        switch token {
        case .value(let value): bearer = value
        case .mint(let mint): bearer = try await mint()
        }
        let response = try await transport.send(
          HTTPRequest(
            url: videoServiceUrl("/xrpc/app.bsky.video.getJobStatus", [("jobId", jobId ?? .null)]),
            headers: ["Authorization": "Bearer \(bearer)"]))
        let result = try response.json()
        consecutiveFailures = 0
        let status = normalizeJobStatus(result)

        // A blob means ready, whatever else the answer says: a video sent
        // twice comes back as error "already_exists" with a good blob.
        if let status, isUsableVideoBlob(status["blob"]) { return status }
        if !response.ok { throw PollFailure(message: "Failed to get job status") }
        guard let status else { throw PollFailure(message: "Malformed job status response") }
        jobStatus = status
      } catch {
        if Task.isCancelled || error is CancellationError || error is VideoCancelledError {
          throw VideoCancelledError()
        }
        consecutiveFailures += 1
        if consecutiveFailures >= options.maxConsecutiveFailures { throw error }
        await clock.sleep(options.failureIntervalMs ?? options.pollIntervalMs * Double(consecutiveFailures + 1))
        if Task.isCancelled { throw VideoCancelledError() }
        continue
      }

      onProgress?(
        VideoJobProgress(
          state: jobStatus["state"], progress: ComposerJS.or(jobStatus["progress"], .number(0)) ?? .number(0),
          message: jobStatus["message"]))

      if jobStatus["state"] == "JOB_STATE_FAILED" {
        let words = ComposerJS.or(jobStatus["message"], ComposerJS.or(jobStatus["error"], nil))
        var failure = VideoError(
          words.map { $0.stringValue ?? $0.jsString } ?? "The video service couldn’t process this video.",
          code: "VIDEO_PROCESSING_FAILED")
        failure.failureCode = jobStatus["failureCode"]
        failure.jobError = jobStatus["error"]
        throw failure
      }
      if jobStatus["state"] == "JOB_STATE_COMPLETED" {
        completedWithoutBlob += 1
        if completedWithoutBlob > options.maxCompletedWithoutBlobPolls {
          throw VideoError(
            jobStatus["error"] == "already_exists"
              ? "This video was already processed, but the service didn’t send it back. Trim or re-save the video and try again."
              : "Video processing finished without returning a video. Try adding it again.",
            code: "VIDEO_NO_BLOB")
        }
      }
      await clock.sleep(options.pollIntervalMs)
      if Task.isCancelled { throw VideoCancelledError() }
    }
  }

  /// A failed poll's plain Error.
  struct PollFailure: Error, LocalizedError {
    var message: String
    var errorDescription: String? { message }
  }

  static func pdsAudience(_ pdsUrl: String?) throws -> String {
    guard let pdsUrl, let url = try? WHATWGURL(pdsUrl) else {
      throw VideoError("Couldn’t find this account’s server to upload the video to.", code: "VIDEO_NO_PDS")
    }
    return "did:web:\(url.hostname)"
  }

  static func mintToken(_ target: VideoTarget, aud: String, lxm: String, exp: Int? = nil) async throws -> String {
    let data = try await target.agent.getServiceAuth(aud: aud, lxm: lxm, exp: exp == 0 ? nil : exp)
    guard let token = data["token"], token.isTruthy else {
      throw VideoError("Couldn’t get permission to upload the video.", code: "VIDEO_AUTH")
    }
    return token.stringValue ?? token.jsString
  }

  /// The write account's video upload limits:
  /// `{ canUpload, message?, remainingDailyVideos?, remainingDailyBytes? }`.
  public static func getVideoUploadLimits(
    _ target: VideoTarget, transport: any HTTPTransport = HTTP.transport
  ) async throws -> JSONValue {
    let token = try await mintToken(target, aud: videoServiceDid, lxm: "app.bsky.video.getUploadLimits")
    let response = try await transport.send(
      HTTPRequest(url: videoServiceUrl("/xrpc/app.bsky.video.getUploadLimits"), headers: ["Authorization": "Bearer \(token)"]))
    let body = try? response.json()
    guard response.ok, let body, body.isTruthy else {
      throw VideoError("Couldn’t check this account’s video limits. Try again.", code: "VIDEO_LIMITS", status: response.status)
    }
    return body
  }

  static func randomName(_ type: String, _ randomBytes: (Int) -> [UInt8]) -> String {
    let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
    let token = String(randomBytes(12).map { alphabet[Int($0) % alphabet.count] })
    return "\(token).\(mimeExtensions.jsValue(type) ?? "mp4")"
  }

  /// Random bytes for the upload's name (crypto.getRandomValues).
  public static func systemRandomBytes(_ count: Int) -> [UInt8] {
    var generator = SystemRandomNumberGenerator()
    return (0..<count).map { _ in UInt8.random(in: 0...255, using: &generator) }
  }

  /// Upload a video as the write account and wait for the service to process
  /// it. Only the bytes leave for the video service; the file's own name
  /// stays behind (the upload is named with `randomBytes`).
  public static func uploadVideo(
    _ target: VideoTarget,
    _ file: VideoFile,
    onProgress: (@Sendable (VideoProgress) -> Void)? = nil,
    now: @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 },
    poll: VideoPollTuning = VideoPollTuning(),
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock,
    randomBytes: (Int) -> [UInt8] = Video.systemRandomBytes
  ) async throws -> UploadedVideo {
    let check = validateVideoFile(file)
    if !check.ok { throw VideoError(check.message ?? "", code: check.code ?? "VIDEO_FAILED") }
    if Task.isCancelled { throw VideoCancelledError() }

    onProgress?(VideoProgress(phase: "checking"))
    let limits = try await getVideoUploadLimits(target, transport: transport)
    if !ComposerJS.truthy(limits["canUpload"]) {
      throw VideoError(videoLimitMessage(limits["message"]), code: "VIDEO_LIMIT")
    }

    let audience = try pdsAudience(target.pdsUrl)
    let exp = Int((now() / 1000).rounded(.down)) + videoUploadTokenTtlSeconds
    let uploadToken = try await mintToken(target, aud: audience, lxm: "com.atproto.repo.uploadBlob", exp: exp)
    if Task.isCancelled { throw VideoCancelledError() }

    onProgress?(VideoProgress(phase: "uploading"))
    let response: HTTPResponse
    do {
      response = try await transport.send(
        HTTPRequest(
          method: "POST",
          url: videoServiceUrl(
            "/xrpc/app.bsky.video.uploadVideo",
            [("did", .string(target.did)), ("name", .string(randomName(file.type, randomBytes)))]),
          headers: ["Authorization": "Bearer \(uploadToken)", "Content-Type": file.type],
          body: file.data))
    } catch {
      if Task.isCancelled || error is CancellationError { throw VideoCancelledError() }
      throw VideoError(
        "Couldn’t reach the video service. Check your connection and try again.", code: "VIDEO_NETWORK", cause: error)
    }
    let body = try? response.json()
    var jobStatus = normalizeJobStatus(body)

    // 409 already_exists carries the earlier job for the same bytes.
    let alreadySent = response.status == 409 && jobStatus?["error"] == "already_exists"
    if !response.ok && !alreadySent {
      throw VideoError(
        videoLimitMessage(ComposerJS.or(body?["message"], body?["error"])), code: "VIDEO_REFUSED",
        status: response.status)
    }
    if !isUsableVideoBlob(jobStatus?["blob"]) {
      guard let jobId = jobStatus?["jobId"], jobId.isTruthy else {
        throw VideoError("The video service didn’t start processing this video. Try again.", code: "VIDEO_NO_JOB")
      }
      onProgress?(VideoProgress(phase: "processing", progress: 0))
      let minted = Locked<String?>(nil)
      let token = Token.mint {
        if let token = minted.withLock({ $0 }) { return token }
        let token = try await mintToken(target, aud: videoServiceDid, lxm: "app.bsky.video.getJobStatus")
        minted.withLock { $0 = token }
        return token
      }
      jobStatus = try await pollVideoJobStatus(
        jobId,
        token: token,
        onProgress: { status in
          onProgress?(VideoProgress(phase: "processing", progress: status.progress.isTruthy ? status.progress : .number(0)))
        },
        options: VideoPollOptions(
          pollIntervalMs: poll.pollIntervalMs ?? videoPollIntervalMs,
          failureIntervalMs: poll.failureIntervalMs ?? videoPollFailureIntervalMs,
          maxPollTimeMs: poll.maxPollTimeMs ?? videoPollMaxTimeMs,
          maxConsecutiveFailures: poll.maxConsecutiveFailures ?? videoPollMaxConsecutiveFailures,
          maxCompletedWithoutBlobPolls: poll.maxCompletedWithoutBlobPolls ?? videoPollMaxCompletedWithoutBlob),
        transport: transport,
        clock: clock)
    }

    let status = jobStatus ?? [:]
    let blob = RecordCid.toJsonShape(status["blob"] ?? .null)
    let jobId = ComposerJS.or(status["jobId"], nil).map { $0.stringValue ?? $0.jsString }
    if !ComposerJS.truthy(blob["$type"]), let cid = blob["cid"], cid.isTruthy {
      // The legacy `{ cid, mimeType }` form, in the shape records carry.
      return UploadedVideo(
        blob: [
          "$type": "blob",
          "ref": ["$link": cid],
          "mimeType": ComposerJS.or(blob["mimeType"], .string(file.type)) ?? .string(file.type),
          "size": ComposerJS.coalesce(blob["size"], .number(file.size)) ?? .number(file.size),
        ],
        jobId: jobId)
    }
    return UploadedVideo(blob: blob, jobId: jobId)
  }
}
