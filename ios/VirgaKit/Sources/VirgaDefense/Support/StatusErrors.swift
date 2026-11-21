// The HTTP status of the errors the Defense reads meet, as score.js reads
// `err.status` to decide whether a failed read is worth asking again
// (Score.retryable), and the plain errors harvest.js, score.js and veto.js
// throw themselves. Not a port of a web module: the errors those modules
// make and read.
//
// HTTPStatusError is this target's protocol, so these conformances are this
// target's own: VirgaNetwork's errors keep the status they carry (an
// XRPCError's 1 for no response included, as the SDK's is).

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

extension XRPCError: HTTPStatusError {
  public var httpStatus: Int? { status }
}

extension BackendError: HTTPStatusError {
  public var httpStatus: Int? { status }
}

extension PublicXrpcError: HTTPStatusError {
  public var httpStatus: Int? { status }
}

extension AtprotoHTTPError: HTTPStatusError {
  public var httpStatus: Int? { status }
}

extension JSError: HTTPStatusError {
  public var httpStatus: Int? { jsFields.status }
}

/// What the Defense modules throw for a read that failed:
/// `Object.assign(new Error(message), { status })`, the status set only for
/// an answer that wasn't ok ("HTTP 502 from getRelationships"), none for an
/// answer of the wrong shape ("getRelationships answered with no list").
public struct DefenseFetchError: Error, LocalizedError, HTTPStatusError, JSErrorConvertible, Hashable, Sendable,
  CustomStringConvertible
{
  public var message: String
  public var status: Int?

  public init(_ message: String, status: Int? = nil) {
    self.message = message
    self.status = status
  }

  public var httpStatus: Int? { status }
  public var errorDescription: String? { message }
  public var description: String { message }
  public var jsFields: JSErrorFields { JSErrorFields(message: message, status: status) }
}

/// An error that carries the one it was made from (`err.cause`), which
/// scan.js reads to see a missing permission behind a failed score.
public protocol CausedError: Error {
  var cause: (any Error)? { get }
}

extension ScoreError: CausedError {}
