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

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

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
