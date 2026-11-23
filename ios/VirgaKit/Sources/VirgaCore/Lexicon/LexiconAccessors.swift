// Reading the JSON a view carries as the record it is.

import Foundation

extension LexiconRecord {
  /// The record read from JSON (a repo record's `value`), or nil when it
  /// isn't one of these.
  public init?(json: JSONValue) {
    guard let value = try? json.decode(Self.self) else { return nil }
    self = value
  }

  /// The record as JSON, `$type` and all.
  public func json() throws -> JSONValue {
    try JSONValue(encoding: self)
  }
}

extension PostView {
  /// The post record, or nil when `record` isn't one.
  public var postRecord: PostRecord? { PostRecord(json: record) }
}

extension ViewRecord {
  /// The quoted post's record, or nil when `value` isn't a post.
  public var postRecord: PostRecord? { PostRecord(json: value) }
}

extension RepoRecord {
  /// The record as `T`, or nil when it isn't one.
  public func decode<T: LexiconRecord>(_ type: T.Type) -> T? { T(json: value) }

  /// The record's key: the last segment of its URI.
  public var rkey: String? { AtUri.rkey(of: uri) }
}

extension NotificationView {
  /// The post record behind a reply, mention or quote, when it is one.
  public var postRecord: PostRecord? { PostRecord(json: record) }
}
