// Ports src/legal/termsService.js
//
// The two calls to Virga's server about the Terms of Service and Privacy
// Policy (server/terms/handlers): ask whether an account has agreed, and
// record that it has. The version sent is the one this app shows; the server
// refuses any other. APISurface names this service for `terms/*`.

import Foundation
import VirgaCore
import VirgaNetwork

/// `fetchTermsStatus`'s answer: `{ accepted, acceptedAt, version }`, each as
/// the server sent it (`acceptedAt || null`, `version ?? null`).
public struct TermsStatusAnswer: Sendable, Hashable {
  public var accepted: Bool
  public var acceptedAt: JSONValue
  public var version: JSONValue

  public init(accepted: Bool, acceptedAt: JSONValue = .null, version: JSONValue = .null) {
    self.accepted = accepted
    self.acceptedAt = acceptedAt
    self.version = version
  }

  public var json: JSONValue { ["accepted": .bool(accepted), "acceptedAt": acceptedAt, "version": version] }
}

public enum TermsService {
  /// `TERMS_API`.
  public enum TermsAPI {
    public static let status = "/api/terms/status"
    public static let accept = "/api/terms/accept"
  }

  static let reportTimeoutMs: Double = 15_000

  /// `fetchTermsStatus(requester)`: whether the account behind `requester`
  /// (a long session's, from `backendFor(did)`) has agreed. Throws the
  /// requester's error when the server can't say.
  public static func fetchTermsStatus(_ requester: VirgaBackend) async throws -> TermsStatusAnswer {
    let body = try await requester.request(TermsAPI.status, timeoutMs: 15_000)
    return TermsStatusAnswer(
      accepted: body["accepted"] == .bool(true),
      acceptedAt: body["acceptedAt"].truthy ?? .null,
      version: body["version"].nonNull ?? .null)
  }

  /// `recordAcceptance(requester, { version })`: records that the account
  /// agrees, and answers the time on the server's row. Throws on any
  /// refusal, and on any answer that isn't the server saying it has the
  /// row: a host that serves a page for a path it doesn't know answers 200
  /// too, and that is not a record.
  public static func recordAcceptance(_ requester: VirgaBackend, version: Int = LegalVersion.termsVersion) async throws -> String {
    let body = try await requester.request(
      TermsAPI.accept, method: "POST", body: ["version": .number(Double(version))], timeoutMs: 20_000)
    guard body["success"] == .bool(true), case .string(let identity)? = body["identity"], identity == "session",
      case .string(let acceptedAt)? = body["acceptedAt"]
    else {
      throw BackendClient.requestError(200, body)
    }
    return acceptedAt
  }

  /// `reportAcceptance({ did, version, backendUrl })`: reports an agreement
  /// made on a browser session, with the DID in the body (there is no
  /// session to send). Answers the server's `identity || null`; throws an
  /// error with `code` and `status` when it didn't land.
  public static func reportAcceptance(
    did: String?,
    version: Int = LegalVersion.termsVersion,
    backendUrl: String?,
    transport: any HTTPTransport = HTTP.transport,
    origin: String? = nil
  ) async throws -> JSONValue {
    let unreachable = BackendError(message: "Couldn’t reach Virga’s server.", status: 0, code: "NETWORK_ERROR")
    let response: HTTPResponse
    do {
      let url = try BackendClient.backendAddress(backendUrl, TermsAPI.accept, origin: origin).href
      // JSON.stringify({ version, did }): an undefined did is left out.
      let text = did.map { "{\"version\":\(version),\"did\":\(JSONStringify.quote($0))}" } ?? "{\"version\":\(version)}"
      response = try await transport.send(
        HTTPRequest(
          method: "POST", url: url, headers: ["Content-Type": "application/json"], text: text, timeoutMs: reportTimeoutMs))
    } catch {
      if error is CancellationError { throw error }
      throw unreachable
    }
    // A deployment with no server answers /api/* with a page, not JSON.
    let body = response.jsonOrNull()
    guard response.ok, body?["success"] == .bool(true) else { throw BackendClient.requestError(response.status, body) }
    return body?["identity"].truthy ?? .null
  }
}
