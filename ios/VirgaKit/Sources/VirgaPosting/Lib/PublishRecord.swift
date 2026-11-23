// Ports src/posting/lib/publishRecord.js
//
// Idempotent, retrying publish for PDS repo writes. A plain createRecord lets
// the server pick the rkey, so retrying a write that timed out after landing
// creates a duplicate post. Here the rkey is client-generated (one record per
// repo/collection/rkey, so a retry can't duplicate), and after any failure the
// PDS is asked whether the record already landed (a slow write can succeed
// after our timeout; a duplicate-rkey rejection means an earlier attempt won).
// If it landed, that counts as success.
//
// Every write goes through the write account's XRPCAgent (the session's, over
// Virga's server), with the SDK's own bodies. Timeouts are waits on a
// NetworkClock, the web's setTimeout: a write that loses its race against the
// clock is not called off (the web's isn't either), and the landed-check
// settles what it did. Once a write has started it runs to the end, whatever
// happens to the task that asked for it.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// A write or a landed-check that lost its race against the clock: the web's
/// `Object.assign(new Error(label), { timedOut: true })`.
public struct PublishTimeoutError: Error, LocalizedError, JSErrorConvertible, Hashable, Sendable {
  public var message: String
  public let timedOut = true

  public init(_ message: String) { self.message = message }

  public var errorDescription: String? { message }
  public var jsFields: JSErrorFields { JSErrorFields(message: message) }
}

/// What a retry loop given no attempts throws: the web's `throw undefined`
/// (`lastErr` was never set). Its message is read as nothing; a fixture
/// records it as "undefined".
public struct NothingThrownError: Error, LocalizedError, Hashable, Sendable {
  public init() {}
  public var errorDescription: String? { "undefined" }
}

/// The landed-check found the post's applyWrites answered without the post's
/// result (a PDS that leaves out `results`).
public struct MissingCreateResultError: Error, LocalizedError, JSErrorConvertible, Hashable, Sendable {
  public let message = "applyWrites returned no create result for the post"
  public init() {}
  public var errorDescription: String? { message }
  public var jsFields: JSErrorFields { JSErrorFields(message: message) }
}

/// `(err.message || err.cause?.message || …).toLowerCase is not a function`:
/// the TypeError isTransientNetworkError throws for a message that isn't a
/// string, in V8's words.
public struct TransientCheckTypeError: Error, LocalizedError, Hashable, Sendable {
  public let message =
    "(err.message || (intermediate value) || (intermediate value)(intermediate value)(intermediate value) || \"\").toLowerCase is not a function"
  public init() {}
  public var errorDescription: String? { message }
}

public enum PublishRecord {
  public static let defaultTimeoutMs: Double = 30_000
  static let checkTimeoutMs: Double = 15_000
  public static let defaultAttempts = 2

  static let post = "app.bsky.feed.post"
  static let createType = "com.atproto.repo.applyWrites#create"

  // MARK: Which failures are the network's

  /// `/^(UND_ERR_|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)/i`.
  static let transientCode = JSRegex(
    "^(?:[uU][nN][dD]_[eE][rR][rR]_|[eE][cC][oO][nN][nN]|[eE][tT][iI][mM][eE][dD][oO][uU][tT]"
      + "|[eE][nN][oO][tT][fF][oO][uU][nN][dD]|[eE][aA][iI]_[aA][gG][aA][iI][nN]|[eE][pP][iI][pP][eE])")

  /// The messages of a failure that is the network's (matched lower-cased).
  static let transientMessage = JSRegex(
    "und_err_|failed to fetch|load failed|network ?error|fetch failed|timed out|timeout|connection|econnreset"
      + "|econnrefused|etimedout|enotfound|eai_again|gateway timeout|service unavailable|temporarily unavailable")

  /// `typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : undefined`.
  static func statusOf(_ err: JSONValue) -> Double? {
    if case .number(let n)? = err["status"] { return n }
    if case .number(let n)? = err["statusCode"] { return n }
    return nil
  }

  /// A failure that is the network's, not the request's: a socket error, a
  /// timeout, a gateway that didn't answer. `err` is read as the web reads
  /// the object it is given; a message that isn't a string throws the
  /// TypeError V8 does.
  public static func isTransientNetworkError(_ err: JSONValue?) throws -> Bool {
    guard let err, err.isTruthy else { return false }
    let code = err["code"].truthy ?? err["cause"]?["code"].truthy ?? ""
    if transientCode.test(code.jsString) { return true }

    if let status = statusOf(err), status == 408 || status == 504 { return true }

    var stringError: JSONValue?
    if case .string = err { stringError = err }
    let message = err["message"].truthy ?? err["cause"]?["message"].truthy ?? stringError.truthy ?? ""
    guard case .string(let text) = message else { throw TransientCheckTypeError() }
    return transientMessage.test(text.jsLowercased())
  }

  /// isTransientNetworkError over a Swift error, read as the web reads its
  /// Error object (PublishRecord.errorObject).
  public static func isTransientNetworkError(_ error: (any Error)?) -> Bool {
    guard let error else { return false }
    return (try? isTransientNetworkError(errorObject(error))) ?? false
  }

  /// Only transient failures (timeout, network blip, 5xx, 429) are retried,
  /// which is safe only because the write is idempotent by rkey. Other 4xx
  /// throw at once. A status below 100 isn't an HTTP status: the SDK reports
  /// a fetch that threw as status 1, read as the network failure it is.
  public static func isRetriablePublishError(_ err: JSONValue?) throws -> Bool {
    guard let err, err.isTruthy else { return false }
    if err["timedOut"]?.isTruthy == true { return true }
    if let status = statusOf(err), status >= 100 { return status == 429 || status >= 500 }
    return try isTransientNetworkError(err)
  }

  public static func isRetriablePublishError(_ error: (any Error)?) -> Bool {
    guard let error else { return false }
    return (try? isRetriablePublishError(errorObject(error))) ?? false
  }

  /// A Swift error as the web's Error object: `{ name, message, code?,
  /// status?, error?, timedOut?, canceled? }`. Nothing thrown reads as null.
  public static func errorObject(_ error: any Error) -> JSONValue {
    switch error {
    case is NothingThrownError:
      return .null
    case let timeout as PublishTimeoutError:
      return ["name": "Error", "message": .string(timeout.message), "timedOut": true]
    case let upload as BlobUploadError:
      var out: JSONValue = ["name": .string(upload.name), "message": .string(upload.message)]
      if upload.timedOut { out["timedOut"] = true }
      if upload.canceled { out["canceled"] = true }
      return out
    default:
      return JSErrorFields(error)?.json ?? ["name": "Error", "message": .string(jsMessage(error))]
    }
  }

  // MARK: Racing the clock

  /// `setTimeout`'s delay: `ms` from 0 to 2^31 - 1, at once for anything else.
  static func timerMs(_ ms: Double) -> Double {
    ms >= 0 && ms <= 2_147_483_647 ? ms : 0
  }

  /// `Promise.race([work, timeout])`: the work's outcome, or a
  /// PublishTimeoutError(label) once `ms` passes on `clock` first. The work
  /// is not called off when the time is up (a write in flight is reconciled
  /// by the landed-check, not aborted), and the caller's cancellation doesn't
  /// reach it. The timer is cleared when the work settles first, and waited
  /// for, so its wait is on the clock before this returns, as setTimeout's is.
  static func withTimeout<T: Sendable>(
    _ ms: Double, _ label: String, clock: NetworkClock, _ work: @escaping @Sendable () async throws -> T
  ) async throws -> T {
    let race = TimeoutRace<T>()
    let timer = Task {
      await clock.sleep(timerMs(ms))
      if !Task.isCancelled { race.finish(.failure(PublishTimeoutError(label))) }
    }
    Task {
      do { race.finish(.success(try await work())) } catch { race.finish(.failure(error)) }
    }
    let result = await race.result()
    timer.cancel()
    await timer.value
    return try result.get()
  }

  /// One race: the first outcome to finish, handed to whoever waits.
  final class TimeoutRace<T: Sendable>: Sendable {
    private struct State {
      var waiter: CheckedContinuation<Result<T, any Error>, Never>?
      var result: Result<T, any Error>?
    }

    private let state = Locked(State())

    func result() async -> Result<T, any Error> {
      await withCheckedContinuation { (continuation: CheckedContinuation<Result<T, any Error>, Never>) in
        let early: Result<T, any Error>? = state.withLock { state in
          if let result = state.result { return result }
          state.waiter = continuation
          return nil
        }
        if let early { continuation.resume(returning: early) }
      }
    }

    func finish(_ result: Result<T, any Error>) {
      let waiter: CheckedContinuation<Result<T, any Error>, Never>? = state.withLock { state in
        if state.result != nil { return nil }
        state.result = result
        defer { state.waiter = nil }
        return state.waiter
      }
      waiter?.resume(returning: result)
    }
  }

  // MARK: The repo calls

  /// `agent.com.atproto.repo.getRecord({ repo, collection, rkey })`: the answer's data.
  public static func getRecord(_ agent: XRPCAgent, repo: String, collection: String, rkey: String) async throws
    -> JSONValue
  {
    let params: XRPCParams = ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)]
    return try await agent.query("com.atproto.repo.getRecord", params).data
  }

  /// `agent.com.atproto.repo.createRecord({ repo, collection, rkey, record })`: the answer's data.
  public static func createRecord(
    _ agent: XRPCAgent, repo: String, collection: String, rkey: String, record: JSONValue
  ) async throws -> JSONValue {
    let input: JSONValue = [
      "repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey), "record": record,
    ]
    return try await agent.procedure("com.atproto.repo.createRecord", input: .json(input)).data
  }

  /// `agent.com.atproto.repo.applyWrites({ repo, validate, writes })`: the answer's data.
  public static func applyWrites(_ agent: XRPCAgent, repo: String, validate: Bool, writes: [ApplyWritesCreate])
    async throws -> JSONValue
  {
    let input: JSONValue = [
      "repo": .string(repo), "validate": .bool(validate), "writes": .array(writes.map(\.json)),
    ]
    return try await agent.procedure("com.atproto.repo.applyWrites", input: .json(input)).data
  }

  // MARK: The retry

  /// Run `doWrite(rkey)` with a bounded, idempotent retry.
  ///
  /// - Parameters:
  ///   - agent: the write agent (its `getRecord` is the landed-check).
  ///   - rkey: a fixed rkey to use (nil for a fresh TID from `mintTid` at
  ///     the clock's time); pass one when the caller already built records
  ///     around it (an applyWrites with a threadgate/postgate sharing the
  ///     post's rkey).
  ///   - doWrite: performs the write for the given rkey; returns the
  ///     write's data (ideally carrying `uri`).
  /// - Returns: the write's data, or the landed record's.
  public static func publishWithIdempotentRetry(
    _ agent: XRPCAgent,
    repo: String,
    collection: String,
    rkey: String? = nil,
    timeoutMs: Double = defaultTimeoutMs,
    attempts: Int = defaultAttempts,
    clock: NetworkClock = HTTP.clock,
    mintTid: @Sendable (Double) throws -> String = ThreadBatch.nextTid,
    _ doWrite: @escaping @Sendable (String) async throws -> JSONValue
  ) async throws -> JSONValue {
    let rkey = try rkey ?? mintTid(clock.now())

    // Any failure to confirm counts as "not landed"; safe, since re-writing
    // the same rkey can't duplicate.
    @Sendable func fetchIfLanded() async -> JSONValue? {
      do {
        let data = try await withTimeout(checkTimeoutMs, "Record check timed out", clock: clock) {
          try await getRecord(agent, repo: repo, collection: collection, rkey: rkey)
        }
        guard data["uri"]?.isTruthy == true else { return nil }
        return data
      } catch {
        return nil
      }
    }

    var lastError: (any Error)?
    var attempt = 0
    while attempt < attempts {
      do {
        return try await withTimeout(timeoutMs, "Post creation timed out", clock: clock) { try await doWrite(rkey) }
      } catch {
        // The write may have landed despite the error; if so, return it.
        if let landed = await fetchIfLanded() { return landed }
        lastError = error
        if try isRetriablePublishError(errorObject(error)) && attempt < attempts - 1 {
          attempt += 1
          continue
        }
        throw error
      }
    }
    throw lastError ?? NothingThrownError()
  }

  /// Idempotent drop-in for `createRecord({ repo, collection, record })` on
  /// the publish path: the created (or already-landed) record's data.
  public static func createRecordIdempotent(
    _ agent: XRPCAgent,
    repo: String,
    collection: String,
    record: JSONValue,
    rkey: String? = nil,
    timeoutMs: Double = defaultTimeoutMs,
    attempts: Int = defaultAttempts,
    clock: NetworkClock = HTTP.clock,
    mintTid: @Sendable (Double) throws -> String = ThreadBatch.nextTid
  ) async throws -> JSONValue {
    try await publishWithIdempotentRetry(
      agent, repo: repo, collection: collection, rkey: rkey, timeoutMs: timeoutMs, attempts: attempts, clock: clock,
      mintTid: mintTid
    ) { rkey in
      try await createRecord(agent, repo: repo, collection: collection, rkey: rkey, record: record)
    }
  }

  // MARK: Gates

  /// `allow: []` is a real threadgate (nobody can reply); only nil means no
  /// record. Don't change this to a non-empty check: that ships "nobody can
  /// reply" posts wide open.
  public static func needsThreadgateRecord(_ threadgateRules: JSONValue?) -> Bool {
    threadgateRules?.arrayValue != nil
  }

  public static func needsThreadgateRecord(_ threadgateRules: [JSONValue]?) -> Bool { threadgateRules != nil }

  /// An empty postgate embeddingRules imposes nothing, so only a non-empty
  /// set needs a record.
  public static func needsPostgateRecord(_ postgateRules: JSONValue?) -> Bool {
    !(postgateRules?.arrayValue ?? []).isEmpty
  }

  public static func needsPostgateRecord(_ postgateRules: [JSONValue]?) -> Bool { !(postgateRules ?? []).isEmpty }

  /// The applyWrites#create entries for a post's threadgate/postgate: zero,
  /// one or two. Gate records share the post's rkey (the convention the
  /// AppView expects) and name it by its at:// URI. `createdAt` nil is now.
  ///
  /// - Parameters:
  ///   - threadgateRules: allow rules; [] = nobody can reply, nil = no record.
  ///   - postgateRules: embedding rules; only a non-empty set gets a record.
  public static func buildGateWrites(
    did: String,
    rkey: String,
    threadgateRules: [JSONValue]? = nil,
    postgateRules: [JSONValue]? = nil,
    createdAt: JSONValue? = nil,
    now: Double = Date().timeIntervalSince1970 * 1000
  ) -> [ApplyWritesCreate] {
    var writes: [ApplyWritesCreate] = []
    let postUri = "at://\(did)/app.bsky.feed.post/\(rkey)"
    let stamp: JSONValue = createdAt ?? JSDate.toISOString(now).map(JSONValue.string) ?? .null

    if let threadgateRules, needsThreadgateRecord(threadgateRules) {
      writes.append(
        ApplyWritesCreate(
          collection: "app.bsky.feed.threadgate", rkey: rkey,
          value: [
            "$type": "app.bsky.feed.threadgate", "post": .string(postUri), "createdAt": stamp,
            "allow": .array(threadgateRules), "hiddenReplies": [],
          ]))
    }

    if let postgateRules, needsPostgateRecord(postgateRules) {
      writes.append(
        ApplyWritesCreate(
          collection: "app.bsky.feed.postgate", rkey: rkey,
          value: [
            "$type": "app.bsky.feed.postgate", "post": .string(postUri), "createdAt": stamp,
            "detachedEmbeddingUris": [], "embeddingRules": .array(postgateRules),
          ]))
    }

    return writes
  }

  /// Publish a post with its threadgate/postgate as one atomic applyWrites
  /// (idempotent by shared client rkey), or a plain idempotent createRecord
  /// when no gates are needed. The single primitive for every new top-level
  /// post path, so gates can't go missing on one. Gates apply only to
  /// top-level app.bsky.feed.post records (replies inherit the root's gate),
  /// enforced here rather than per caller.
  ///
  /// - Parameters:
  ///   - record: the fully built post record (with `$type`).
  ///   - threadgateRules: [] = nobody can reply, nil = everybody.
  ///   - postgateRules: non-empty = restrict quoting.
  /// - Returns: the created (or already-landed) post's data.
  public static func createPostWithGates(
    _ agent: XRPCAgent,
    repo: String,
    collection: String = "app.bsky.feed.post",
    record: JSONValue,
    threadgateRules: [JSONValue]? = nil,
    postgateRules: [JSONValue]? = nil,
    rkey: String? = nil,
    timeoutMs: Double = defaultTimeoutMs,
    attempts: Int = defaultAttempts,
    clock: NetworkClock = HTTP.clock,
    mintTid: @Sendable (Double) throws -> String = ThreadBatch.nextTid
  ) async throws -> JSONValue {
    let gatesApply = collection == post && record["reply"]?.isTruthy != true
    let threadgate = gatesApply ? threadgateRules : nil
    let postgate = gatesApply ? postgateRules : nil

    if !needsThreadgateRecord(threadgate) && !needsPostgateRecord(postgate) {
      return try await createRecordIdempotent(
        agent, repo: repo, collection: collection, record: record, rkey: rkey, timeoutMs: timeoutMs,
        attempts: attempts, clock: clock, mintTid: mintTid)
    }

    return try await publishWithIdempotentRetry(
      agent, repo: repo, collection: collection, rkey: rkey, timeoutMs: timeoutMs, attempts: attempts, clock: clock,
      mintTid: mintTid
    ) { rkey in
      let writes =
        [ApplyWritesCreate(collection: collection, rkey: rkey, value: record)]
        + buildGateWrites(
          did: repo, rkey: rkey, threadgateRules: threadgate, postgateRules: postgate, now: clock.now())
      let data = try await applyWrites(agent, repo: repo, validate: true, writes: writes)
      // Normalized to the createRecord shape: the post is results[0]. If a
      // PDS omits it, throw so the landed-check fetches the real ref by rkey
      // rather than returning a ref-less commit envelope.
      guard let result = data["results"]?[0], result["uri"]?.isTruthy == true else {
        throw MissingCreateResultError()
      }
      return result
    }
  }
}

extension ApplyWritesCreate {
  /// The write as applyWrites takes it: `{ $type, collection, rkey, value }`.
  public var json: JSONValue {
    ["$type": .string(Self.type), "collection": .string(collection), "rkey": .string(rkey), "value": value]
  }
}
