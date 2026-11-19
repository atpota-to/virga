// Ports src/posting/lib/blobs.js
//
// Uploading a blob to the write account's PDS, and the blob shape records
// carry. The upload goes through the account's XRPCAgent (whose
// BackendFetchHandler sends the bytes through Virga's server, which needs
// an explicit media type, so every caller passes one). An upload's deadline
// grows with its size: a fixed one fails a big image on a slow uplink every
// time.
//
// The web's `toJsonShape` turns the SDK's CID and BlobRef instances into
// their JSON form; here a blob is always JSON already, so it reads the value
// as it is.

import Foundation
import VirgaCore

/// Why an upload stopped: timed out (`timedOut`), cancelled (`canceled`,
/// an AbortError), or refused before it was sent.
public struct BlobUploadError: Error, Sendable, Hashable, LocalizedError {
  public var name: String
  public var message: String
  public var timedOut: Bool
  public var canceled: Bool

  public static let needsType = BlobUploadError(name: "Error", message: "A blob upload needs its media type.", timedOut: false, canceled: false)
  public static let cancelled = BlobUploadError(name: "AbortError", message: "The upload was cancelled.", timedOut: false, canceled: true)
  public static let timeout = BlobUploadError(name: "Error", message: "The upload timed out.", timedOut: true, canceled: false)
  public static let notReturned = BlobUploadError(
    name: "Error", message: "The PDS did not return the uploaded blob.", timedOut: false, canceled: false)

  public var errorDescription: String? { message }
}

public enum Blobs {
  public static let blobUploadBaseMs: Double = 30_000
  /// Per upload; publish runs four at once, so 16 KiB/s each assumes about
  /// half a megabit up in all, and a 1.9 MiB image gets about 2.5 minutes.
  public static let blobUploadMinBytesPerSecond: Double = 16 * 1024

  /// `blobUploadTimeoutMs(byteCount)`: how long an upload of that many bytes
  /// may take before it is given up.
  public static func blobUploadTimeoutMs(_ byteCount: Double?) -> Double {
    let bytes = (byteCount.map { $0.isFinite && $0 > 0 } ?? false) ? byteCount! : 0
    return blobUploadBaseMs + ((bytes / blobUploadMinBytesPerSecond) * 1000).rounded(.up)
  }

  /// `blobCid(blob)`: a blob's CID from the JSON form (`ref.$link`) or the
  /// legacy `{ cid }`, as it is; nil for anything else.
  public static func blobCid(_ blob: JSONValue?) -> JSONValue? {
    guard let blob else { return nil }
    switch blob {
    case .object, .array: break
    default: return nil
    }
    if let link = blob["ref"]?["$link"], link.isTruthy { return link }
    if case .string(let cid)? = blob["cid"] { return .string(cid) }
    return nil
  }

  /// `isBlob(blob)`: whether a record can carry it.
  public static func isBlob(_ blob: JSONValue?) -> Bool {
    guard let cid = blobCid(blob), cid.isTruthy else { return false }
    return blob?["mimeType"]?.stringValue != nil
  }

  /// `uploadBlob(target, data, { encoding, timeoutMs })`: uploads the bytes
  /// as a blob of the agent's account and returns it in its JSON form.
  /// `timeoutMs` defaults to blobUploadTimeoutMs of the byte count. Throws
  /// BlobUploadError (or the agent's XRPCError).
  public static func uploadBlob(
    agent: XRPCAgent,
    data: Data,
    encoding: String?,
    timeoutMs: Double? = nil
  ) async throws -> BlobRef {
    guard let type = encoding, !type.isEmpty, type != "application/octet-stream" else { throw BlobUploadError.needsType }
    if Task.isCancelled { throw BlobUploadError.cancelled }
    let deadline = timeoutMs ?? blobUploadTimeoutMs(Double(data.count))
    let response: XRPCResponse
    do {
      response = try await withDeadline(ms: deadline) {
        try await agent.procedure(
          "com.atproto.repo.uploadBlob", input: .bytes(data),
          options: XRPCAgent.CallOptions(encoding: type, hasSignal: true))
      }
    } catch HTTPTransportError.timedOut {
      throw BlobUploadError.timeout
    } catch is CancellationError {
      throw BlobUploadError.cancelled
    }
    let blob = response.data["blob"]
    guard let cid = blobCid(blob) else { throw BlobUploadError.notReturned }
    let mimeType = blob?["mimeType"].truthy.map { $0.stringValue ?? $0.jsString } ?? type
    let size: Int
    if case .number(let n)? = blob?["size"], n.isFinite {
      size = Int(n)
    } else {
      size = data.count
    }
    return BlobRef(cid: cid.stringValue ?? cid.jsString, mimeType: mimeType, size: size)
  }
}
