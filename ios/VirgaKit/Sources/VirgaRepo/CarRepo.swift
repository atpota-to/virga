// Ports src/lib/carRepo.js
//
// Whole-repo ingestion for the dashboard: com.atproto.sync.getRepo. A repo
// CAR is the PDS's own export: every record in every collection in one
// download, as content-addressed blocks (a signed commit, the MST nodes that
// map `collection/rkey` paths to record CIDs, and the DAG-CBOR records).
// This is what makes the Atmosphere tab exact and all-time, and the outbound
// engagement archive complete.
//
// A CAR doesn't carry engagement counts, other people's records or
// notifications; those keep their own sweeps (analyticsSync).
//
// Incremental syncs use `since=<rev>`: the PDS sends only blocks written
// after that revision. A diff CAR's MST nodes name unchanged records whose
// blocks are absent, so the walk treats a missing block as "already have
// it" and skips: the same code reads full and diff CARs. Deletions never
// appear in a diff; a full re-pull is the deletion story.
//
// The download goes through `RepoCarTransport` (VirgaArchive adapts
// VirgaNetwork's HTTP transport to it); everything else here is pure.

import Foundation
import VirgaCore

// MARK: - Shapes

/// One record found in a repo CAR.
public struct RepoCarEntry: Codable, Hashable, Sendable {
  /// `at://<did>/<collection>/<rkey>`.
  public var uri: String
  public var collection: String
  public var rkey: String
  /// The record, in the data model's JSON form (links as `{ $link }`, bytes
  /// as `{ $bytes }`).
  public var record: JSONValue

  public init(uri: String, collection: String, rkey: String, record: JSONValue) {
    self.uri = uri
    self.collection = collection
    self.rkey = rkey
    self.record = record
  }
}

/// What `readRepoCar` found: the repo's DID and revision and its records.
public struct RepoCarContents: Codable, Hashable, Sendable {
  /// The commit's `did`, as decoded: a string in any real repo, nil for an
  /// empty diff. (Kept as the decoded value, as the web keeps it, so a
  /// malformed commit reads the same on both.)
  public var did: JSONValue?
  /// The commit's `rev`, likewise.
  public var rev: JSONValue?
  public var entries: [RepoCarEntry]
  /// True for a diff with nothing in it (did and rev are then nil).
  public var empty: Bool?

  public init(did: JSONValue?, rev: JSONValue?, entries: [RepoCarEntry], empty: Bool? = nil) {
    self.did = did
    self.rev = rev
    self.entries = entries
    self.empty = empty
  }

  /// The DID, when it is a string.
  public var didString: String? { did?.stringValue }
  /// The revision, when it is a string.
  public var revString: String? { rev?.stringValue }
}

/// Where `readRepoCar` is, reported every `CarRepo.yieldEvery` steps.
public struct RepoCarReadProgress: Codable, Hashable, Sendable {
  public enum Stage: String, Codable, Hashable, Sendable {
    /// Indexing blocks: `done` is bytes indexed (about), `total` the CAR's size.
    case index
    /// Walking the MST: `done` is record paths found; no total.
    case walk
    /// Decoding records: `done` of `total` paths.
    case decode
  }

  public var stage: Stage
  public var done: Int
  public var total: Int?

  public init(stage: Stage, done: Int, total: Int? = nil) {
    self.stage = stage
    self.done = done
    self.total = total
  }
}

/// How much of a repo CAR has downloaded.
public struct RepoCarDownloadProgress: Codable, Hashable, Sendable {
  public var bytes: Int
  /// The Content-Length, when the PDS sent one (usually it doesn't).
  public var total: Double?

  public init(bytes: Int, total: Double?) {
    self.bytes = bytes
    self.total = total
  }
}

/// One repo entry as an atmosphere row: the record, its collection, and
/// when it was made (epoch milliseconds).
public struct AtmosphereRow: Codable, Hashable, Sendable {
  public var uri: String
  public var collection: String
  public var at: Double

  public init(uri: String, collection: String, at: Double) {
    self.uri = uri
    self.collection = collection
    self.at = at
  }
}

// MARK: - The download's transport

/// An HTTP response to a getRepo request.
public struct RepoCarResponse: Sendable {
  /// The body: whole, or in chunks as it arrives (what lets the download
  /// report real progress).
  public enum Body: Sendable {
    case data(Data)
    case stream(AsyncThrowingStream<Data, Error>)
  }

  public var status: Int
  /// Response headers (names in any case).
  public var headers: [String: String]
  public var body: Body

  public init(status: Int, headers: [String: String] = [:], body: Body) {
    self.status = status
    self.headers = headers
    self.body = body
  }

  /// A header's value, by case-insensitive name.
  public func header(_ name: String) -> String? {
    let lower = name.lowercased()
    return headers.first { $0.key.lowercased() == lower }?.value
  }
}

/// What `fetchRepoCar` needs from HTTP: one GET.
public protocol RepoCarTransport: Sendable {
  func get(_ url: String) async throws -> RepoCarResponse
}

/// A transport from a closure, for adapting another HTTP client to
/// `fetchRepoCar` (VirgaArchive adapts VirgaNetwork's transport this way).
public struct RepoCarTransportClosure: RepoCarTransport {
  public let body: @Sendable (_ url: String) async throws -> RepoCarResponse

  public init(_ body: @escaping @Sendable (_ url: String) async throws -> RepoCarResponse) {
    self.body = body
  }

  public func get(_ url: String) async throws -> RepoCarResponse {
    try await body(url)
  }
}

// MARK: - The module

public enum CarRepo {
  /// How often the parse loops yield (YIELD_EVERY).
  public static let yieldEvery = 4000

  // MARK: Download

  /// The getRepo URL for a PDS (base URL, no trailing slash), a DID and an
  /// optional revision to diff from.
  public static func getRepoURL(_ pds: String, _ did: String, since: String? = nil) -> String {
    var params: [(String, String)] = [("did", did)]
    if let since, !since.isEmpty { params.append(("since", since)) }
    return "\(pds)/xrpc/com.atproto.sync.getRepo?\(formURLEncoded(params))"
  }

  /// Downloads a repo CAR from the PDS: the whole repo, or only the blocks
  /// since a revision. Streamed, so progress is reported in real bytes; the
  /// result is one buffer, because the MST walk needs random access.
  /// Throws "HTTP <status> from getRepo" (" (since diff)" for a diff) for a
  /// failed response, with the status on the error. Cancelling the task
  /// stops the download.
  public static func fetchRepoCar(
    _ pds: String,
    _ did: String,
    since: String? = nil,
    transport: some RepoCarTransport,
    onProgress: (@Sendable (RepoCarDownloadProgress) -> Void)? = nil
  ) async throws -> [UInt8] {
    let response = try await transport.get(getRepoURL(pds, did, since: since))
    guard (200...299).contains(response.status) else {
      let diff = (since?.isEmpty == false) ? " (since diff)" : ""
      throw RepoError(.error, "HTTP \(response.status) from getRepo\(diff)", status: response.status)
    }
    // `Number(header) || null`: missing, empty, zero or unreadable is none.
    let lengthHeader = JS.stringToNumber(response.header("content-length") ?? "")
    let total: Double? = (lengthHeader.isNaN || lengthHeader == 0) ? nil : lengthHeader
    switch response.body {
    case .data(let data):
      let buffer = [UInt8](data)
      onProgress?(RepoCarDownloadProgress(bytes: buffer.count, total: total ?? Double(buffer.count)))
      return buffer
    case .stream(let chunks):
      var buffer: [UInt8] = []
      for try await chunk in chunks {
        try Task.checkCancellation()
        buffer.append(contentsOf: chunk)
        onProgress?(RepoCarDownloadProgress(bytes: buffer.count, total: total))
      }
      // A stream ends quietly when its task is cancelled: a cut-short
      // download must not pass for a whole one.
      try Task.checkCancellation()
      return buffer
    }
  }

  /// `URLSearchParams` serialization: UTF-8, spaces as '+', and everything
  /// but `*-._` and ASCII letters and digits percent-encoded.
  static func formURLEncoded(_ params: [(String, String)]) -> String {
    func encode(_ text: String) -> String {
      var out = ""
      for byte in text.utf8 {
        switch byte {
        case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"),
          UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "*"), UInt8(ascii: "-"), UInt8(ascii: "."),
          UInt8(ascii: "_"):
          out.unicodeScalars.append(UnicodeScalar(byte))
        case UInt8(ascii: " "):
          out += "+"
        default:
          out += String(format: "%%%02X", byte)
        }
      }
      return out
    }
    return params.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&")
  }

  // MARK: Parse

  /// Parses a repo CAR into records: indexes the blocks (checking each
  /// against its CID), decodes the commit the root names, walks the MST
  /// recovering the prefix-compressed `collection/rkey` paths, and decodes
  /// every record block that is present.
  ///
  /// Yields every `yieldEvery` steps, as the web does so a 150k-block parse
  /// doesn't freeze the tab, and reports where it is through `onProgress`
  /// at each yield. An empty diff (a header and no blocks) comes back with
  /// `empty: true` and nil did and rev. Cancelling the task stops the parse
  /// at the next yield (the web's parse can't be stopped; its caller drops
  /// the result instead).
  public static func readRepoCar(
    _ bytes: [UInt8],
    onProgress: (@Sendable (RepoCarReadProgress) -> Void)? = nil
  ) async throws -> RepoCarContents {
    var ops = 0
    var stage: RepoCarReadProgress.Stage = .index
    var indexed = 0
    var paths: [(key: [UInt16], link: JSONValue?)] = []
    var decoded = 0

    func progress() -> RepoCarReadProgress {
      switch stage {
      case .index: return RepoCarReadProgress(stage: .index, done: Swift.min(indexed, bytes.count), total: bytes.count)
      case .walk: return RepoCarReadProgress(stage: .walk, done: paths.count)
      case .decode: return RepoCarReadProgress(stage: .decode, done: decoded, total: paths.count)
      }
    }

    let reader = try CarReader.fromUint8Array(bytes)
    var blocks: [String: Range<Int>] = [:]
    // Each block costs its bytes plus its CID and length prefix in the file,
    // ~40 bytes with SHA-256 CIDs, so the sum tracks the file closely.
    var iterator = reader.makeIterator()
    while let entry = try iterator.next() {
      blocks[entry.cid.string] = entry.bytesRange
      indexed += entry.bytesRange.count + 40
      ops += 1
      if ops % yieldEvery == 0 {
        onProgress?(progress())
        await Task.yield()
        try Task.checkCancellation()
      }
    }

    guard let root = reader.roots.first else { throw RepoError.plain("CAR has no root") }
    // A diff asked for since the repo's current rev comes back as a header
    // and no blocks at all: no changes, not a broken CAR.
    if blocks.isEmpty { return RepoCarContents(did: nil, rev: nil, entries: [], empty: true) }
    guard let commitRange = blocks[root.string] else { throw RepoError.plain("CAR root block missing") }
    let commit = try DagCbor.decode(bytes[commitRange]).jsonValue
    let did = JS.optionalGet(commit, "did")
    let rev = JS.optionalGet(commit, "rev")
    let data = JS.optionalGet(commit, "data")
    guard JS.truthy(did), JS.truthy(rev), JS.truthy(data) else {
      throw RepoError.plain("CAR root is not a repo commit")
    }

    // The walk, as the web's recursive `walk(link)` visits: a node, its
    // left subtree, then each entry and the subtree after it. Kept on an
    // explicit stack so no repo can exhaust the call stack.
    stage = .walk
    struct Frame {
      var node: JSONValue
      var entries: [JSONValue]?
      var index = 0
      var prevKey: [UInt16] = []
    }
    var stack: [Frame] = []
    var hasCall = true
    var callArgument: JSONValue? = data
    while true {
      if hasCall {
        hasCall = false
        let link = callArgument
        // `if (!link) return;` and a missing block is a subtree already held.
        if JS.truthy(link), let nodeRange = blocks[try linkKey(link)] {
          ops += 1
          if ops % yieldEvery == 0 {
            onProgress?(progress())
            await Task.yield()
            try Task.checkCancellation()
        try Task.checkCancellation()
          }
          let node = try DagCbor.decode(bytes[nodeRange]).jsonValue
          let left = try JS.get(node, "l")
          stack.append(Frame(node: node))
          hasCall = true
          callArgument = left
          continue
        }
      }
      guard !stack.isEmpty else { break }
      let top = stack.count - 1
      if stack[top].entries == nil {
        // `node.e || []`
        let list = try JS.get(stack[top].node, "e")
        if let list, list.isTruthy {
          stack[top].entries = try JS.iterate(list)
        } else {
          stack[top].entries = []
        }
      }
      let entries = stack[top].entries!
      guard stack[top].index < entries.count else {
        stack.removeLast()
        continue
      }
      let e = entries[stack[top].index]
      stack[top].index += 1
      // `prevKey.slice(0, e.p) + td.decode(keyBytes(e.k))`
      var key = try sliceKey(stack[top].prevKey, end: JS.get(e, "p"))
      key += UTF8Text.whatwgDecode(try keyBytes(JS.get(e, "k")))
      stack[top].prevKey = key
      paths.append((key: key, link: try JS.get(e, "v")))
      hasCall = true
      callArgument = try JS.get(e, "t")
    }

    var entries: [RepoCarEntry] = []
    stage = .decode
    var didText: String? = nil
    for (key, link) in paths {
      decoded += 1
      // A missing record block is a record already held (a diff CAR).
      guard let recordRange = blocks[try linkKey(link)] else { continue }
      ops += 1
      if ops % yieldEvery == 0 {
        onProgress?(progress())
        await Task.yield()
        try Task.checkCancellation()
      }
      guard let slash = key.firstIndex(of: UInt16(UInt8(ascii: "/"))), slash > 0 else { continue }
      if didText == nil { didText = try JS.toString(did) }
      let uri = String(jsUnits: Array("at://\(didText!)/".utf16) + key)
      entries.append(
        RepoCarEntry(
          uri: uri,
          collection: String(jsUnits: key[..<slash]),
          rkey: String(jsUnits: key[(slash + 1)...]),
          record: try DagCbor.decode(bytes[recordRange]).jsonValue
        ))
    }
    return RepoCarContents(did: did, rev: rev, entries: entries)
  }

  public static func readRepoCar(
    _ data: Data,
    onProgress: (@Sendable (RepoCarReadProgress) -> Void)? = nil
  ) async throws -> RepoCarContents {
    try await readRepoCar([UInt8](data), onProgress: onProgress)
  }

  /// `linkKey`: a link's CID string (`link.$link`), or the value as a string.
  static func linkKey(_ link: JSONValue?) throws -> String {
    if JS.truthy(link), case .string(let text)? = JS.optionalGet(link, "$link") { return text }
    return try JS.toString(link)
  }

  /// `prevKey.slice(0, end)`, in UTF-16 code units; an undefined end is the
  /// whole key.
  static func sliceKey(_ key: [UInt16], end: JSONValue?) throws -> [UInt16] {
    guard let end else { return key }
    let length = Double(key.count)
    let relative = JS.toIntegerOrInfinity(try JS.toNumber(end))
    let final = relative < 0 ? Swift.max(length + relative, 0) : Swift.min(relative, length)
    return Array(key[0..<Int(final)])
  }

  /// `keyBytes(k)`: an MST key's bytes. Decoded bytes are `{ $bytes }` here
  /// (the web's wrapper object), which decodes back to the same bytes; any
  /// other value fails as `cbor.fromBytes` fails on it.
  static func keyBytes(_ k: JSONValue?) throws -> [UInt8] {
    let encoded = try JS.get(k, "$bytes")
    guard case .string(let text)? = encoded else {
      // `$bytes.charCodeAt($bytes.length - 1)` on something not a string.
      _ = try JS.get(encoded, "charCodeAt")
      if let encoded { _ = try JS.toNumber(JS.length(encoded)) }
      throw RepoError.type("$bytes.charCodeAt is not a function")
    }
    return try DagCbor.fromBytesString(text)
  }

  // MARK: Atmosphere rows

  /// One repo entry as an atmosphere row, or nil when the record can't be
  /// dated. The rkey's TID wins (minted at creation, immune to a backdated
  /// createdAt), then the record's own timestamps, most intentional first:
  /// createdAt, connectedAt (are.na mirror connections carry nothing else),
  /// publishedAt, updatedAt. Dates without a zone are read in `timeZone`.
  /// Throws only where the web does: for a timestamp that is an object
  /// with its own `toString` member, which has no string form.
  public static func atmosphereRowFromEntry(_ entry: RepoCarEntry?, timeZone: TimeZone) throws -> AtmosphereRow? {
    guard let entry, !entry.uri.isEmpty, !entry.collection.isEmpty else { return nil }
    guard let at = try dateOf(rkey: .string(entry.rkey), record: entry.record, timeZone: timeZone) else {
      return nil
    }
    return AtmosphereRow(uri: entry.uri, collection: entry.collection, at: at)
  }

  /// `atmosphereRowFromEntry` for an entry of any shape, in JSON: the row as
  /// the web builds it (`uri` and `collection` passed through as they are),
  /// or null.
  public static func atmosphereRowFromEntry(json entry: JSONValue?, timeZone: TimeZone) throws -> JSONValue {
    let uri = JS.optionalGet(entry, "uri")
    guard JS.truthy(uri), let collection = JS.optionalGet(entry, "collection"), collection.isTruthy else {
      return .null
    }
    let at = try dateOf(
      rkey: JS.optionalGet(entry, "rkey"), record: JS.optionalGet(entry, "record"), timeZone: timeZone)
    guard let at else { return .null }
    return .object(["uri": uri!, "collection": collection, "at": .number(at)])
  }

  static func dateOf(rkey: JSONValue?, record: JSONValue?, timeZone: TimeZone) throws -> Double? {
    let value: JSONValue = JS.truthy(record) ? record! : .object([:])
    var chosen: JSONValue = .string("")
    if let tid = try tidToTimestamp(rkey) {
      chosen = .string(tid)
    } else {
      for key in ["createdAt", "connectedAt", "publishedAt", "updatedAt"] {
        if let candidate = JS.optionalGet(value, key), candidate.isTruthy {
          chosen = candidate
          break
        }
      }
    }
    let at = JSDate.parse(try JS.toString(chosen), timeZone: timeZone)
    return at.isFinite ? at : nil
  }

  static let tidAlphabet = Array("234567abcdefghijklmnopqrstuvwxyz".unicodeScalars)

  /// src/lib/atproto.js's `tidToTimestamp`: the ISO time a TID rkey was
  /// minted at, or nil when the key isn't a TID (13 characters of the TID
  /// alphabet, after a time). VirgaNetwork ports atproto.js; this target
  /// can't import it, so the function is repeated here, held to the web by
  /// the atmosphereRowFromEntry fixtures.
  static func tidToTimestamp(_ rkey: JSONValue?) throws -> String? {
    let text = JS.truthy(rkey) ? try JS.toString(rkey) : ""
    guard text.utf16.count == 13 else { return nil }
    var first: UInt64 = 0
    var rest: UInt64 = 0
    for (index, char) in text.unicodeScalars.enumerated() {
      guard let digit = tidAlphabet.firstIndex(of: char) else { return nil }
      if index == 0 { first = UInt64(digit) } else { rest = rest * 32 + UInt64(digit) }
    }
    // A TID is 65 bits here (the web reads it as a BigInt): drop the clock
    // id, then microseconds to milliseconds.
    let micros = (first << 50) + (rest >> 10)
    let ms = Double(micros / 1000)
    guard ms > 0 else { return nil }
    return JSDate.toISOString(ms)
  }
}
