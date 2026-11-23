// The fields the web reads off an Error object.
//
// The session code words and sorts errors by what the web sets on them:
// `err.code` (the server's, or the client's own such as NETWORK_ERROR),
// `err.status`, `err.name` (AbortError, TypeError), `err.message`,
// `err.error` (an XRPC error's lexicon name) and `err.params` (a sign-in
// return's `error`). In Swift those live on different error types:
// BackendError, BackendClient.ReturnError, XRPCError, the transport's
// errors, CancellationError and this module's own. `JSErrorFields(error)`
// reads them all one way, so a port of `error?.code === 'X'` reads
// `JSErrorFields(error)?.codeString == "X"`.

import Foundation
import VirgaCore
import VirgaNetwork

/// What `err.name`, `err.message`, `err.code`, `err.status`, `err.error` and
/// `err.params` read on the web.
public struct JSErrorFields: Sendable, Hashable {
  public var name: String
  public var message: String
  /// `err.code`, as it was set (normally a string).
  public var code: JSONValue?
  public var status: Int?
  /// `err.error`: an XRPC error's name (ScopeMissingError, AuthenticationRequired).
  public var error: String?
  /// `err.params`: a sign-in return's query (`error`, `error_description`).
  public var params: [String: String]?

  public init(
    name: String = "Error",
    message: String = "",
    code: JSONValue? = nil,
    status: Int? = nil,
    error: String? = nil,
    params: [String: String]? = nil
  ) {
    self.name = name
    self.message = message
    self.code = code
    self.status = status
    self.error = error
    self.params = params
  }

  /// `typeof err.code === 'string' ? err.code : null`.
  public var codeString: String? { code?.stringValue }

  /// The fields of any error, or nil for none (the web's `err?.x` on null).
  public init?(_ error: (any Error)?) {
    guard let error else { return nil }
    switch error {
    case let known as any JSErrorConvertible:
      self = known.jsFields
    case let backend as BackendError:
      self.init(name: backend.name, message: backend.message, code: backend.code, status: backend.status)
    case let returned as BackendClient.ReturnError:
      self.init(message: returned.message, code: .string(returned.code), params: returned.params)
    case let xrpc as XRPCError:
      self.init(name: "XRPCError", message: xrpc.message, status: xrpc.status, error: xrpc.error)
    case is CancellationError:
      self.init(name: "AbortError", message: "This operation was aborted")
    case let transport as HTTPTransportError:
      switch transport {
      case .timedOut: self.init(name: "TimeoutError", message: jsMessage(transport))
      default: self.init(name: "TypeError", message: jsMessage(transport))
      }
    case is WebURLError:
      self.init(name: "TypeError", message: jsMessage(error))
    case is JSONSyntaxError:
      self.init(name: "SyntaxError", message: jsMessage(error))
    case let http as AtprotoHTTPError:
      self.init(message: http.message, status: http.status)
    case let appView as PublicXrpcError:
      self.init(message: appView.message, status: appView.status, error: appView.error?.stringValue)
    default:
      self.init(message: jsMessage(error))
    }
  }

  /// The fields as a fixture records an error.
  public var json: JSONValue {
    var out: JSONValue = ["name": .string(name), "message": .string(message)]
    if let code { out["code"] = code }
    if let status { out["status"] = .number(Double(status)) }
    if let error { out["error"] = .string(error) }
    if let params { out["params"] = .object(params.mapValues(JSONValue.string)) }
    return out
  }
}

/// An error that says what the web would read off it.
public protocol JSErrorConvertible: Error {
  var jsFields: JSErrorFields { get }
}

/// A plain JavaScript Error with fields set on it:
/// `Object.assign(new Error(message), { code, status })`.
public struct JSError: Error, JSErrorConvertible, LocalizedError, Sendable, Hashable, CustomStringConvertible {
  public var jsFields: JSErrorFields

  public init(_ fields: JSErrorFields) {
    jsFields = fields
  }

  public init(
    name: String = "Error",
    message: String,
    code: JSONValue? = nil,
    status: Int? = nil,
    error: String? = nil,
    params: [String: String]? = nil
  ) {
    jsFields = JSErrorFields(name: name, message: message, code: code, status: status, error: error, params: params)
  }

  /// An error as a fixture writes one: `{ name, message, code, status, error, params }`.
  public init(json: JSONValue) {
    var params: [String: String]?
    if let object = json["params"]?.objectValue {
      params = object.compactMapValues(\.stringValue)
    }
    self.init(
      name: json["name"]?.stringValue ?? "Error",
      message: json["message"]?.stringValue ?? "",
      code: json["code"].nonNull,
      status: json["status"]?.doubleValue.map { Int($0) },
      error: json["error"]?.stringValue,
      params: params)
  }

  public var errorDescription: String? { jsFields.message }
  public var description: String { "\(jsFields.name): \(jsFields.message)" }
}
