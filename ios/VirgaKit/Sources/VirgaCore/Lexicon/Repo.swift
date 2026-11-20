// What a PDS answers about repos and records (com.atproto.repo.*,
// com.atproto.identity.resolveHandle), and the writes applyWrites takes.
// Records travel as JSON (`value`); decode the ones you know with their
// record type (`RepoRecord.decode(PostRecord.self)`).

import Foundation

/// com.atproto.repo.listRecords#record: a record, its AT-URI and CID.
public struct RepoRecord: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String
  public var value: JSONValue

  public init(uri: String, cid: String, value: JSONValue) {
    self.uri = uri
    self.cid = cid
    self.value = value
  }
}

/// com.atproto.repo.listRecords.
public struct ListRecordsOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var records: [RepoRecord]

  public init(cursor: String? = nil, records: [RepoRecord]) {
    self.cursor = cursor
    self.records = records
  }
}

/// com.atproto.repo.getRecord.
public struct GetRecordOutput: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String?
  public var value: JSONValue

  public init(uri: String, cid: String? = nil, value: JSONValue) {
    self.uri = uri
    self.cid = cid
    self.value = value
  }
}

/// com.atproto.repo.defs#commitMeta.
public struct CommitMeta: Codable, Hashable, Sendable {
  public var cid: String
  public var rev: String

  public init(cid: String, rev: String) {
    self.cid = cid
    self.rev = rev
  }
}

/// com.atproto.repo.createRecord's and putRecord's.
public struct WriteRecordOutput: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String
  public var commit: CommitMeta?
  public var validationStatus: String?

  public init(
    uri: String,
    cid: String,
    commit: CommitMeta? = nil,
    validationStatus: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.commit = commit
    self.validationStatus = validationStatus
  }
}

/// com.atproto.repo.deleteRecord's.
public struct DeleteRecordOutput: Codable, Hashable, Sendable {
  public var commit: CommitMeta?

  public init(commit: CommitMeta? = nil) {
    self.commit = commit
  }
}

/// com.atproto.repo.applyWrites#create.
public struct ApplyWritesCreate: LexiconTypedObject, Hashable, Sendable {
  public static let type = "com.atproto.repo.applyWrites#create"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var collection: String
  public var rkey: String?
  public var value: JSONValue
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    collection: String,
    rkey: String? = nil,
    value: JSONValue,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.collection = collection
    self.rkey = rkey
    self.value = value
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    collection = try r.required("collection")
    rkey = r.optional("rkey")
    value = try r.required("value")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(collection, "collection")
    try w.put(rkey, "rkey")
    try w.put(value, "value")
  }
}

/// com.atproto.repo.applyWrites#update.
public struct ApplyWritesUpdate: LexiconTypedObject, Hashable, Sendable {
  public static let type = "com.atproto.repo.applyWrites#update"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var collection: String
  public var rkey: String
  public var value: JSONValue
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    collection: String,
    rkey: String,
    value: JSONValue,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.collection = collection
    self.rkey = rkey
    self.value = value
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    collection = try r.required("collection")
    rkey = try r.required("rkey")
    value = try r.required("value")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(collection, "collection")
    try w.put(rkey, "rkey")
    try w.put(value, "value")
  }
}

/// com.atproto.repo.applyWrites#delete.
public struct ApplyWritesDelete: LexiconTypedObject, Hashable, Sendable {
  public static let type = "com.atproto.repo.applyWrites#delete"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var collection: String
  public var rkey: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    collection: String,
    rkey: String,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.collection = collection
    self.rkey = rkey
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    collection = try r.required("collection")
    rkey = try r.required("rkey")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(collection, "collection")
    try w.put(rkey, "rkey")
  }
}

/// com.atproto.repo.applyWrites#createResult.
public struct ApplyWritesCreateResult: LexiconTypedObject, Hashable, Sendable {
  public static let type = "com.atproto.repo.applyWrites#createResult"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var cid: String
  public var validationStatus: String?

  public init(
    uri: String,
    cid: String,
    validationStatus: String? = nil,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.validationStatus = validationStatus
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, cid, validationStatus
  }
}

/// com.atproto.repo.applyWrites#updateResult.
public struct ApplyWritesUpdateResult: LexiconTypedObject, Hashable, Sendable {
  public static let type = "com.atproto.repo.applyWrites#updateResult"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var cid: String
  public var validationStatus: String?

  public init(
    uri: String,
    cid: String,
    validationStatus: String? = nil,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.validationStatus = validationStatus
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, cid, validationStatus
  }
}

/// com.atproto.repo.applyWrites#deleteResult.
public struct ApplyWritesDeleteResult: LexiconTypedObject, Hashable, Sendable {
  public static let type = "com.atproto.repo.applyWrites#deleteResult"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?

  public init(lexiconType: String? = nil) {
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
  }
}

/// com.atproto.repo.applyWrites's.
public struct ApplyWritesOutput: Codable, Hashable, Sendable {
  public var commit: CommitMeta?
  public var results: [ApplyWritesResult]?

  public init(commit: CommitMeta? = nil, results: [ApplyWritesResult]? = nil) {
    self.commit = commit
    self.results = results
  }
}

/// com.atproto.repo.describeRepo.
public struct DescribeRepoOutput: Codable, Hashable, Sendable {
  public var handle: String
  public var did: String
  public var didDoc: JSONValue
  public var collections: [String]
  public var handleIsCorrect: Bool

  public init(
    handle: String,
    did: String,
    didDoc: JSONValue,
    collections: [String],
    handleIsCorrect: Bool
  ) {
    self.handle = handle
    self.did = did
    self.didDoc = didDoc
    self.collections = collections
    self.handleIsCorrect = handleIsCorrect
  }
}

/// com.atproto.identity.resolveHandle.
public struct ResolveHandleOutput: Codable, Hashable, Sendable {
  public var did: String

  public init(did: String) {
    self.did = did
  }
}

/// com.atproto.repo.uploadBlob.
public struct UploadBlobOutput: Codable, Hashable, Sendable {
  public var blob: BlobRef

  public init(blob: BlobRef) {
    self.blob = blob
  }
}

/// com.atproto.server.getServiceAuth.
public struct ServiceAuthOutput: Codable, Hashable, Sendable {
  public var token: String

  public init(token: String) {
    self.token = token
  }
}

/// app.bsky.video.defs#jobStatus. `state` is 'JOB_STATE_COMPLETED',
/// 'JOB_STATE_FAILED' or one in progress; `blob` is set once complete.
public struct VideoJobStatus: Codable, Hashable, Sendable {
  public var jobId: String
  public var did: String
  public var state: String
  public var progress: Int?
  public var blob: BlobRef?
  public var error: String?
  public var message: String?

  public init(
    jobId: String,
    did: String,
    state: String,
    progress: Int? = nil,
    blob: BlobRef? = nil,
    error: String? = nil,
    message: String? = nil
  ) {
    self.jobId = jobId
    self.did = did
    self.state = state
    self.progress = progress
    self.blob = blob
    self.error = error
    self.message = message
  }
}

/// app.bsky.video.getJobStatus's and uploadVideo's.
public struct VideoJobStatusOutput: Codable, Hashable, Sendable {
  public var jobStatus: VideoJobStatus

  public init(jobStatus: VideoJobStatus) {
    self.jobStatus = jobStatus
  }
}

/// app.bsky.video.getUploadLimits.
public struct VideoUploadLimits: Codable, Hashable, Sendable {
  public var canUpload: Bool
  public var remainingDailyVideos: Int?
  public var remainingDailyBytes: Int?
  public var message: String?
  public var error: String?

  public init(
    canUpload: Bool,
    remainingDailyVideos: Int? = nil,
    remainingDailyBytes: Int? = nil,
    message: String? = nil,
    error: String? = nil
  ) {
    self.canUpload = canUpload
    self.remainingDailyVideos = remainingDailyVideos
    self.remainingDailyBytes = remainingDailyBytes
    self.message = message
    self.error = error
  }
}

/// com.atproto.repo.applyWrites's input.
public struct ApplyWritesInput: Codable, Hashable, Sendable {
  public var repo: String
  public var validate: Bool?
  public var writes: [ApplyWritesOperation]
  public var swapCommit: String?

  public init(
    repo: String,
    validate: Bool? = nil,
    writes: [ApplyWritesOperation],
    swapCommit: String? = nil
  ) {
    self.repo = repo
    self.validate = validate
    self.writes = writes
    self.swapCommit = swapCommit
  }
}
