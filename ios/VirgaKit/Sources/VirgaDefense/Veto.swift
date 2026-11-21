// Ports src/defense/veto.js
//
// The veto: who no automated path may ever add to a list. The scan reads it
// to put people in PROTECTED; Virga's server reads it again at the moment of
// every write, because a plan's bands date from when it was made and anyone
// can be followed since. There the rule is: read everything fresh, and if
// anything can't be read, write nothing (docs/DEFENSE-THREATS.md, rule 1).
//
// Who is protected: the owner's own account, and the account that holds the
// list; anyone the owner kept by hand; anyone the owner follows, asked of the
// public AppView, with no session; anyone on a curation list the owner made.
//
// Plain reads of the public AppView through atproto.js's fetchWithTimeout
// over an injected transport. The web's AbortSignal is task cancellation:
// a cancelled read throws CancellationError, never VetoUnreadable.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// The veto couldn't be read, so nothing may be written.
public struct VetoUnreadable: Error, LocalizedError, CausedError, JSErrorConvertible, CustomStringConvertible, Sendable {
  public var message: String
  public var cause: (any Error)?
  /// Always "veto-unreadable".
  public var code: String { "veto-unreadable" }
  public var name: String { "VetoUnreadable" }

  public init(_ message: String, cause: (any Error)? = nil) {
    self.message = message
    self.cause = cause
  }

  public var errorDescription: String? { message }
  public var description: String { message }
  public var jsFields: JSErrorFields { JSErrorFields(name: name, message: message, code: .string(code)) }
}

public enum Veto {
  /// REL_BATCH: `getRelationships` takes at most 30 `others` per call.
  static let relBatch = 30

  static let curateList = "app.bsky.graph.defs#curatelist"
  static let notFoundActor = "app.bsky.graph.defs#notFoundActor"

  /// CURATION_CONCURRENCY: curation lists read at once.
  static let curationConcurrency = 4

  /// How far a read of the owner's curation lists goes before it gives up.
  public struct CurationLimits: Codable, Hashable, Sendable {
    public var lists: Int
    public var membersPerList: Int

    public init(lists: Int = 20, membersPerList: Int = 5000) {
      self.lists = lists
      self.membersPerList = membersPerList
    }
  }

  /// CURATION_LIMITS.
  public static let curationLimits = CurationLimits()

  /// The owner's reads of who they follow: `follows(ownerDid, dids)`.
  public typealias Follows = @Sendable (_ ownerDid: String, _ dids: [String]) async throws -> ReasonMap

  /// A read of the owner's curation lists (curationMembers' answer), which a
  /// caller can share across batches.
  public typealias Curation = @Sendable () async throws -> ReasonMap

  /// `getJson(url, { fetchImpl, signal })`: the parsed body of an ok answer.
  static func getJson(_ url: String, transport: any HTTPTransport) async throws -> JSONValue {
    let res = try await Atproto.fetchWithTimeout(HTTPRequest(url: url, headers: ["Accept": "application/json"]), transport: transport)
    if !res.ok {
      throw DefenseFetchError("HTTP \(res.status) from \(try WebURL(url).pathname)", status: res.status)
    }
    return try res.json()
  }

  /// What `body` came to: its value or its error.
  static func outcome<T: Sendable>(_ body: () async throws -> T) async -> Result<T, any Error> {
    do { return .success(try await body()) } catch { return .failure(error) }
  }

  /// The error a read stopped by the caller rethrows: the caller's own stop.
  static func stopped(_ error: any Error) -> any Error {
    error is CancellationError ? error : CancellationError()
  }

  /// `followedNow(ownerDid, dids, { fetchImpl, appview, signal })`: of
  /// `dids`, who may not be added because of how they stand with the owner,
  /// from the public AppView read now: someone the owner follows, and
  /// someone the AppView says it can't find (deleted or taken down: nobody
  /// to block, and no way to see whether they are followed). Every DID
  /// asked about must be answered; a batch with any left out, or an answer
  /// without a list, throws VetoUnreadable.
  public static func followedNow(
    _ ownerDid: String,
    _ dids: [String],
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport
  ) async throws -> ReasonMap {
    let out = Locked(ReasonMap())
    do {
      _ = try await Limit.mapLimit(Limit.chunks(dids.jsUnique(), relBatch), Limit.appviewConcurrency) { batch, _ in
        let q = batch.map { "others=\(JSURI.encodeURIComponent($0))" }.joined(separator: "&")
        let body = try await getJson(
          "\(appview)/xrpc/app.bsky.graph.getRelationships?actor=\(JSURI.encodeURIComponent(ownerDid))&\(q)",
          transport: transport)
        guard let relationships = body["relationships"]?.arrayValue else {
          throw DefenseFetchError("getRelationships answered with no list")
        }
        var answered = Set<JSKey>()
        for r in relationships {
          let gone = r["notFound"].truthy != nil || (r["$type"]?.stringValue).jsEquals(notFoundActor)
          if gone {
            // `r.actor || r.did`: only a string can be one of the batch.
            if let did = (r["actor"].truthy ?? r["did"].truthy)?.stringValue {
              answered.insert(JSKey(did))
              if batch.jsIncludes(did) { out.withLock { $0.set(did, "Bluesky can’t find this account right now") } }
            }
            continue
          }
          guard let did = r["did"].truthy?.stringValue else { continue }
          answered.insert(JSKey(did))
          if r["following"].truthy != nil { out.withLock { $0.set(did, "you follow them") } }
        }
        let missing = batch.filter { !answered.contains(JSKey($0)) }
        if !missing.isEmpty {
          throw DefenseFetchError("getRelationships left out \(missing.count) of \(batch.count)")
        }
      }
    } catch {
      if Task.isCancelled { throw stopped(error) }
      throw VetoUnreadable("Couldn’t check who you follow, so nothing was written.", cause: error)
    }
    return out.wrappedValue
  }

  /// `curationMembers(ownerDid, { fetchImpl, appview, signal, limits })`:
  /// everyone on a curation list the owner made, did → the list's name, from
  /// the public AppView. The lists are read side by side and their members
  /// merged in the lists' own order, so someone on two is named by the
  /// first. Throws VetoUnreadable when it can't be read, or when there is
  /// more than `limits` allows, rather than leaving anyone out.
  public static func curationMembers(
    _ ownerDid: String,
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport,
    limits: CurationLimits = curationLimits
  ) async throws -> ReasonMap {
    var out = ReasonMap()
    do {
      var lists: [(uri: JSONValue, name: JSONValue?)] = []
      var cursor: JSONValue?
      repeat {
        var q: [(String, String)] = [("actor", ownerDid), ("limit", "100")]
        if let c = cursor.truthy { q.append(("cursor", c.jsString)) }
        let body = try await getJson("\(appview)/xrpc/app.bsky.graph.getLists?\(JSURI.searchParams(q))", transport: transport)
        guard let found = body["lists"]?.arrayValue else { throw DefenseFetchError("getLists answered with no list") }
        for l in found {
          if (l["purpose"]?.stringValue).jsEquals(curateList), let uri = l["uri"].truthy {
            lists.append((uri, l["name"]))
          }
        }
        cursor = body["cursor"]
      } while cursor.truthy != nil && lists.count <= limits.lists
      if lists.count > limits.lists { throw DefenseFetchError("more than \(limits.lists) curation lists") }

      let uris = lists.map(\.uri)
      let members = try await Limit.mapLimit(uris, curationConcurrency) { uri, _ in
        var dids: [JSONValue] = []
        var next: JSONValue?
        repeat {
          var q: [(String, String)] = [("list", uri.jsString), ("limit", "100")]
          if let c = next.truthy { q.append(("cursor", c.jsString)) }
          let body = try await getJson("\(appview)/xrpc/app.bsky.graph.getList?\(JSURI.searchParams(q))", transport: transport)
          guard let items = body["items"]?.arrayValue else { throw DefenseFetchError("getList answered with no items") }
          for item in items {
            if let did = item["subject"]?["did"].truthy { dids.append(did) }
          }
          if dids.count > limits.membersPerList {
            throw DefenseFetchError("a curation list with more than \(limits.membersPerList) members")
          }
          next = body["cursor"]
        } while next.truthy != nil
        return dids
      }
      for (i, list) in lists.enumerated() {
        let name = list.name.truthy?.jsString ?? "a curation list"
        // A member that isn't a string is nobody a DID can match.
        for did in members[i].compactMap(\.stringValue) where !out.has(did) { out.set(did, name) }
      }
    } catch {
      if Task.isCancelled { throw stopped(error) }
      throw VetoUnreadable("Couldn’t read the curation lists you made, so nothing was written.", cause: error)
    }
    return out
  }

  /// `vetoed({ ownerDid, holderDid, dids, kept, curation, follows, signal,
  /// ...read })`: of `dids`, everyone who may not be added, with why.
  /// `kept` is did → reason for the people kept by hand (the owner's rows of
  /// defense_protected). `curation` reads curationMembers' answer (so a
  /// caller can share it across batches); nil reads it. `follows` defaults
  /// to followedNow. Throws VetoUnreadable when there is no owner, or the
  /// follows or the curation lists can't be read (a `curation` or `follows`
  /// of the caller's that throws is rethrown as it is). Both reads run side
  /// by side, and when both fail, the one that failed first is thrown, as
  /// the web's Promise.all rejects.
  public static func vetoed(
    ownerDid: String?,
    holderDid: String? = nil,
    dids: [String?],
    kept: ReasonMap = ReasonMap(),
    curation: Curation? = nil,
    follows: Follows? = nil,
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport,
    limits: CurationLimits = curationLimits
  ) async throws -> ReasonMap {
    guard let ownerDid, !ownerDid.isEmpty else { throw VetoUnreadable("A veto needs the owner.") }
    let wanted = dids.compactMap { $0 }.filter { !$0.isEmpty }.jsUnique()
    var out = ReasonMap()
    var others: [String] = []
    for did in wanted {
      if did.jsEquals(ownerDid) {
        out.set(did, "your own account")
      } else if let holderDid, !holderDid.isEmpty, did.jsEquals(holderDid) {
        out.set(did, "the account that holds the list")
      } else if kept.has(did) {
        let reason = kept[did] ?? ""
        out.set(did, reason.isEmpty ? "kept by hand" : reason)
      } else {
        others.append(did)
      }
    }
    if others.isEmpty { return out }

    let readFollows: Follows =
      follows ?? { owner, dids in try await followedNow(owner, dids, appview: appview, transport: transport) }
    let readCuration: Curation =
      curation ?? { try await curationMembers(ownerDid, appview: appview, transport: transport, limits: limits) }
    // `Promise.all([follows(...), curation...])`: side by side, and the
    // first to fail is the failure. The other read is left to finish (the
    // web leaves it running too), so what was asked of the AppView is the
    // same either way.
    let asked = others
    var followed = ReasonMap()
    var members = ReasonMap()
    var failure: (any Error)?
    await withTaskGroup(of: (Bool, Result<ReasonMap, any Error>).self) { group in
      group.addTask { (true, await outcome { try await readFollows(ownerDid, asked) }) }
      group.addTask { (false, await outcome { try await readCuration() }) }
      for await (isFollows, result) in group {
        switch result {
        case .success(let map):
          if isFollows { followed = map } else { members = map }
        case .failure(let error):
          if failure == nil { failure = error }
        }
      }
    }
    if let failure { throw failure }
    for did in others {
      if followed.has(did) {
        let reason = followed[did] ?? ""
        out.set(did, reason.isEmpty ? "you follow them" : reason)
      } else if let list = members[did] {
        out.set(did, "on your list “\(list)”")
      }
    }
    return out
  }
}
