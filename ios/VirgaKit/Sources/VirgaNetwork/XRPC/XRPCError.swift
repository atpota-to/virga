// XRPC's errors, as @atproto/xrpc (0.7) gives them to the web app: every
// signed-in call the web makes goes through @atproto/api's Agent, whose
// failures are XRPCError { status, error, message, headers }, and the web
// reads `err.status`, `err.error` (the lexicon's error name, such as
// RecordNotFound) and `err.message`. A port that catches an XRPC error sees
// the same three.

import Foundation
import VirgaCore

/// @atproto/xrpc's ResponseType: an HTTP status, or 1 (no response) and 2
/// (a response that failed the lexicon).
public enum XRPCResponseType: Int, Sendable, CaseIterable {
  case unknown = 1
  case invalidResponse = 2
  case success = 200
  case invalidRequest = 400
  case authenticationRequired = 401
  case forbidden = 403
  case xrpcNotSupported = 404
  case notAcceptable = 406
  case payloadTooLarge = 413
  case unsupportedMediaType = 415
  case rateLimitExceeded = 429
  case internalServerError = 500
  case methodNotImplemented = 501
  case upstreamFailure = 502
  case notEnoughResources = 503
  case upstreamTimeout = 504

  /// `ResponseType[code]`: the enum's name.
  public var name: String {
    switch self {
    case .unknown: return "Unknown"
    case .invalidResponse: return "InvalidResponse"
    case .success: return "Success"
    case .invalidRequest: return "InvalidRequest"
    case .authenticationRequired: return "AuthenticationRequired"
    case .forbidden: return "Forbidden"
    case .xrpcNotSupported: return "XRPCNotSupported"
    case .notAcceptable: return "NotAcceptable"
    case .payloadTooLarge: return "PayloadTooLarge"
    case .unsupportedMediaType: return "UnsupportedMediaType"
    case .rateLimitExceeded: return "RateLimitExceeded"
    case .internalServerError: return "InternalServerError"
    case .methodNotImplemented: return "MethodNotImplemented"
    case .upstreamFailure: return "UpstreamFailure"
    case .notEnoughResources: return "NotEnoughResources"
    case .upstreamTimeout: return "UpstreamTimeout"
    }
  }

  /// `ResponseTypeStrings[code]`: the words.
  public var words: String {
    switch self {
    case .unknown: return "Unknown"
    case .invalidResponse: return "Invalid Response"
    case .success: return "Success"
    case .invalidRequest: return "Invalid Request"
    case .authenticationRequired: return "Authentication Required"
    case .forbidden: return "Forbidden"
    case .xrpcNotSupported: return "XRPC Not Supported"
    case .notAcceptable: return "Not Acceptable"
    case .payloadTooLarge: return "Payload Too Large"
    case .unsupportedMediaType: return "Unsupported Media Type"
    case .rateLimitExceeded: return "Rate Limit Exceeded"
    case .internalServerError: return "Internal Server Error"
    case .methodNotImplemented: return "Method Not Implemented"
    case .upstreamFailure: return "Upstream Failure"
    case .notEnoughResources: return "Not Enough Resources"
    case .upstreamTimeout: return "Upstream Timeout"
    }
  }

  /// `httpResponseCodeToEnum(status)`.
  public static func from(httpStatus status: Int) -> XRPCResponseType {
    if let known = XRPCResponseType(rawValue: status) { return known }
    switch status {
    case 100..<200: return .xrpcNotSupported
    case 200..<300: return .success
    case 300..<400: return .xrpcNotSupported
    case 400..<500: return .invalidRequest
    default: return .internalServerError
    }
  }
}

/// An XRPC call that failed: @atproto/xrpc's XRPCError.
public struct XRPCError: Error, Sendable, Hashable, LocalizedError, CustomStringConvertible {
  /// The ResponseType's code: the HTTP status for a known status, the
  /// nearest known one for another (`httpResponseCodeToEnum`), 1 for no
  /// response.
  public var status: Int
  /// The lexicon's error name (`RecordNotFound`), or the ResponseType's name
  /// when the server gave none.
  public var error: String
  public var message: String
  /// The response's headers (lower-cased names), when there was a response.
  public var headers: [String: String]?

  /// `new XRPCError(statusCode, error, message, headers)`.
  public init(statusCode: Int, error: String? = nil, message: String? = nil, headers: [String: String]? = nil) {
    let type = XRPCResponseType.from(httpStatus: statusCode)
    let name = error ?? XRPCResponseType.from(httpStatus: statusCode).name
    self.status = type.rawValue
    self.error = name
    // `super(message || error || httpResponseCodeToString(statusCode))`
    if let message, !message.isEmpty {
      self.message = message
    } else if !name.isEmpty {
      self.message = name
    } else {
      self.message = type.words
    }
    self.headers = headers
  }

  /// `XRPCError.from(cause)`: an XRPCError as it is; anything else (a
  /// network failure, a fetch handler's TypeError) as status 1, "Unknown",
  /// with the cause's message.
  public static func from(_ cause: any Error) -> XRPCError {
    if let xrpc = cause as? XRPCError { return xrpc }
    return XRPCError(statusCode: XRPCResponseType.unknown.rawValue, message: jsMessage(cause))
  }

  public var errorDescription: String? { message }
  public var description: String { "XRPCError(\(status) \(error)): \(message)" }

  /// The error as the web reads its three fields, for a fixture.
  public var json: JSONValue {
    ["status": .number(Double(status)), "error": .string(error), "message": .string(message)]
  }
}
