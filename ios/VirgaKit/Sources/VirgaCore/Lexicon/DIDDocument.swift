// A DID document, as the PLC directory (or a did:web host's
// /.well-known/did.json) serves it: the handles it claims (`alsoKnownAs`),
// its keys and its services, the PDS among them. Kept whole: anything not
// modelled is in `extra`. What the web reads off it (the PDS endpoint, the
// handle) is ported with the code that reads it (src/lib/atproto.js,
// src/signin/identity.js); these are the shapes.

import Foundation

public struct DIDDocument: Codable, Hashable, Sendable {
  /// `@context`: a string or a list of them.
  public var context: JSONValue?
  public var id: String
  /// `at://<handle>` for each handle the DID claims.
  public var alsoKnownAs: [String]?
  public var verificationMethod: [VerificationMethod]?
  public var service: [DIDService]?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    context: JSONValue? = nil, id: String, alsoKnownAs: [String]? = nil,
    verificationMethod: [VerificationMethod]? = nil, service: [DIDService]? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.context = context
    self.id = id
    self.alsoKnownAs = alsoKnownAs
    self.verificationMethod = verificationMethod
    self.service = service
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    context = r.optional("@context")
    id = try r.required("id")
    alsoKnownAs = r.optional("alsoKnownAs")
    verificationMethod = r.optional("verificationMethod")
    service = r.optional("service")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, extra: extra)
    try w.put(context, "@context")
    try w.put(id, "id")
    try w.put(alsoKnownAs, "alsoKnownAs")
    try w.put(verificationMethod, "verificationMethod")
    try w.put(service, "service")
  }
}

/// A key the DID controls (`#atproto` is the repo's signing key).
public struct VerificationMethod: Codable, Hashable, Sendable {
  public var id: String
  public var type: String
  public var controller: String
  public var publicKeyMultibase: String?
  public var extra: [String: JSONValue]

  public init(id: String, type: String, controller: String, publicKeyMultibase: String? = nil, extra: [String: JSONValue] = [:]) {
    self.id = id
    self.type = type
    self.controller = controller
    self.publicKeyMultibase = publicKeyMultibase
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    id = try r.required("id")
    type = try r.required("type")
    controller = try r.required("controller")
    publicKeyMultibase = r.optional("publicKeyMultibase")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, extra: extra)
    try w.put(id, "id")
    try w.put(type, "type")
    try w.put(controller, "controller")
    try w.put(publicKeyMultibase, "publicKeyMultibase")
  }
}

/// A service the DID names (`#atproto_pds`, of type AtprotoPersonalDataServer).
public struct DIDService: Codable, Hashable, Sendable {
  public var id: String
  public var type: String
  /// A URL as a string for every atproto service; the DID spec allows a
  /// map or a list too, so it is kept as JSON (`endpoint` reads the string).
  public var serviceEndpoint: JSONValue
  public var extra: [String: JSONValue]

  public init(id: String, type: String, serviceEndpoint: JSONValue, extra: [String: JSONValue] = [:]) {
    self.id = id
    self.type = type
    self.serviceEndpoint = serviceEndpoint
    self.extra = extra
  }

  /// The endpoint when it is a string.
  public var endpoint: String? { serviceEndpoint.stringValue }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    id = try r.required("id")
    type = try r.required("type")
    serviceEndpoint = try r.required("serviceEndpoint")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, extra: extra)
    try w.put(id, "id")
    try w.put(type, "type")
    try w.put(serviceEndpoint, "serviceEndpoint")
  }
}
