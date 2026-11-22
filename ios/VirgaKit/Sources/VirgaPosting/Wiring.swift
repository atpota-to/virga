// The seams earlier waves left between VirgaPosting and the targets below
// it, wired here (no web module of its own: on the web these are one
// global fetch and one window):
//
// - Timers: VirgaNetwork's VirgaBackend is timers' TimerRequester (the
//   web's `req.request(path, { method, query, body })`), and its
//   BackendError is what the timer service reads a refusal from.
// - Mentions: the shared resolver's fetch over VirgaNetwork's
//   HTTPTransport (`Mentions.useNetwork(transport:)`, which the app calls
//   once at launch).
// - The archive: ArchiveEnvironment.postsChanged from the posting events
//   bus (`PostingEvents.postsChangedListener(target:)`), so a post made or
//   deleted here reaches the archive's model as virga:posts-changed does
//   on the web.
// - Pending work: pendingWork.js's posting services (listScheduled,
//   listTimers, isActiveScheduledRow, isLiveTimer) as VirgaSession's
//   PendingWorkServices (`PendingWorkServices.posting()`), which the app's
//   sign-out and remove-account dialogs read waiting work through.
// - Gates: the write account's XRPCAgent as gates.js's agent
//   (`XRPCGatesAgent`, which posting settings' resolveDefaultGates and
//   updatePostGates take), and XRPCError naming its lexicon error, so a
//   RecordNotFound reads as one.

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaSession

// MARK: - Timers

extension VirgaBackend: TimerRequester {
  /// One call to Virga's server for the timer service: the decoded JSON
  /// body, or the server's refusal as a BackendError (which the service
  /// reads through TimerErrorConvertible). A cancelled task goes through as
  /// CancellationError, which the service reads as an AbortError.
  public func request(_ request: TimerRequest) async throws -> JSONValue? {
    let query = request.query.map { pairs in
      QueryParams(pairs.sorted { $0.key.utf16.lexicographicallyPrecedes($1.key.utf16) }.map { ($0.key, .string($0.value)) })
    }
    return try await self.request(request.path, method: request.method ?? "GET", query: query, body: request.body)
  }
}

extension BackendError: TimerErrorConvertible {
  /// The request error as the timer service reads it: its code, message,
  /// status (0 for no answer), name and payload.
  public var timerServiceError: TimerServiceError {
    TimerServiceError(code: codeString, message: message, status: status, name: name, payload: payload)
  }
}

// MARK: - Pending work

extension PendingWorkServices {
  /// What pendingWork.js imports from the posting services: the scheduled
  /// rows (scheduleService's listScheduled and isActiveScheduledRow) and the
  /// timers (timerService's listTimers, which settles the timers'
  /// availability in `context` as any read of them does, and isLiveTimer),
  /// each over the account's VirgaBackend.
  public static func posting(context: TimerServiceContext = .shared) -> PendingWorkServices {
    PendingWorkServices(
      listScheduled: { req in try await ScheduleService.listScheduled(req).rows },
      listTimers: { req in try await TimerService.listTimers(req, context: context).rows },
      isActiveScheduledRow: { ScheduleService.isActiveScheduledRow($0) },
      isLiveTimer: { TimerService.isLiveTimer($0) })
  }
}

// MARK: - Mentions

extension Mentions {
  /// The resolver's fetch over `transport`: a GET of the address it built,
  /// answered with the status and the body's bytes (the resolver keeps its
  /// own deadline).
  public static func networkFetch(transport: any HTTPTransport = HTTP.transport) -> MentionFetch {
    { url in
      let response = try await transport.send(HTTPRequest(url: url))
      return MentionFetchResponse(status: response.status, body: response.body)
    }
  }

  /// Sets the shared resolver's fetch to VirgaNetwork's transport (the
  /// web's global fetch). The app calls this once at launch.
  public static func useNetwork(transport: any HTTPTransport = HTTP.transport) {
    defaultFetch.withLock { $0 = networkFetch(transport: transport) }
  }
}

// MARK: - The archive

extension PostingEvents {
  /// ArchiveEnvironment.postsChanged from the posting events bus: each
  /// virga:posts-changed for `did` (`{ did, added, removed }`) reaches
  /// `onChange`; the returned function stops listening.
  public static func postsChangedListener(target: PostingEventBus? = .shared) -> PostsChangedListener {
    { (did: String, onChange: @escaping @Sendable (JSONValue) -> Void) -> (@Sendable () -> Void) in
      let stop = try? onPostingEvent(postsChangedEvent, did: did, target: target) { detail in onChange(detail) }
      return stop ?? {}
    }
  }
}

// MARK: - Gates

/// An XRPCAgent as gates.js uses one: `agent.app.bsky.actor.getPreferences`
/// and `agent.com.atproto.repo.getRecord / putRecord / deleteRecord`, with
/// the SDK's parameters and bodies. (A wrapper, not a conformance: the
/// template service's putRecord and deleteRecord already answer a body.)
public struct XRPCGatesAgent: GatesAgent {
  public let agent: XRPCAgent

  public init(_ agent: XRPCAgent) { self.agent = agent }

  public func getPreferences() async throws -> JSONValue {
    try await agent.query("app.bsky.actor.getPreferences").data
  }

  public func getRecord(repo: String, collection: String, rkey: String) async throws -> JSONValue {
    let params: XRPCParams = ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)]
    return try await agent.query("com.atproto.repo.getRecord", params).data
  }

  public func putRecord(repo: String, collection: String, rkey: String, record: JSONValue) async throws {
    let input: JSONValue = ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey), "record": record]
    _ = try await agent.procedure("com.atproto.repo.putRecord", input: .json(input))
  }

  public func deleteRecord(repo: String, collection: String, rkey: String) async throws {
    let input: JSONValue = ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)]
    _ = try await agent.procedure("com.atproto.repo.deleteRecord", input: .json(input))
  }
}

extension XRPCAgent {
  /// This agent as gates.js's (`readDefaultGates`, `updatePostGates`).
  public var gatesAgent: XRPCGatesAgent { XRPCGatesAgent(self) }
}

extension XRPCError: XRPCErrorDescribing {
  /// `err.error`: the lexicon's error name (`RecordNotFound`).
  public var xrpcError: String? { error }
}
