// Ports src/defense/scan.js
//
// A scan of one post: who engaged with it, and how close each of them is to
// you. The pieces are harvest.js (who did what, from Constellation) and
// score.js (how close, from the AppView, checked by a canary); this puts
// them in order for the page, says how far along it is, and words what went
// wrong. Nothing here writes anything: a scan is read-only and free, and
// what it finds is kept in memory (ScanStore) until it is replaced.
//
// The canary comes from the archive: canaryCandidates ranks the accounts
// you follow, the ones who follow you back and talk to you most first.
//
// Every read is injected, with the web's defaults: the handle through the
// public AppView (VirgaNetwork's PublicAppView.resolveHandle), the harvest
// (Harvest.harvestPost), the public relationships (Score.publicRelationships)
// and the curation lists (Veto.curationMembers, read best effort), all over
// `transport`. `getProfiles` is the owner's signed-in read
// (`signedInProfiles(agent)`). The web's AbortSignal is task cancellation:
// a cancelled scan throws ScanError "The scan was stopped." (code aborted).

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// What went wrong with a scan, as a code the page can word and a sentence
/// it can show (`message`, which is also the LocalizedError text).
public struct ScanError: Error, LocalizedError, CausedError, JSErrorConvertible, CustomStringConvertible, Sendable {
  public enum Code: String, Codable, Hashable, Sendable {
    /// Not a link to a post.
    case link
    /// A handle nobody has.
    case author
    /// The scan was stopped.
    case aborted
    /// The session wasn't given the permission a scan needs.
    case permission
    /// The AppView isn't saying who you know in common.
    case vouches
    /// A read failed.
    case read
    /// The harvest, or anything else, failed.
    case harvest
  }

  public var message: String
  public var code: Code
  public var cause: (any Error)?
  public var name: String { "ScanError" }

  public init(_ message: String, code: Code, cause: (any Error)? = nil) {
    self.message = message
    self.code = code
    self.cause = cause
  }

  public var errorDescription: String? { message }
  public var description: String { message }
  public var jsFields: JSErrorFields { JSErrorFields(name: name, message: message, code: .string(code.rawValue)) }
}

/// A stage a scan goes through, with its words (scan.js STAGES).
public struct ScanStage: Codable, Hashable, Sendable {
  public var key: String
  public var label: String

  public init(key: String, label: String) {
    self.key = key
    self.label = label
  }
}

/// The post a pasted link names: `{ did, rkey }` or `{ handle, rkey }`.
public struct PostInput: Codable, Hashable, Sendable {
  public var did: String?
  public var handle: String?
  public var rkey: String

  public init(did: String? = nil, handle: String? = nil, rkey: String) {
    self.did = did
    self.handle = handle
    self.rkey = rkey
  }
}

/// What canaryCandidates reads of the archive: who you follow (and since
/// when), who follows you, and who engaged with you (one entry each time).
/// Decoding is lenient: a missing list is empty, and an entry without a
/// string `did` has none.
public struct CanaryArchive: Codable, Hashable, Sendable {
  public struct Follow: Codable, Hashable, Sendable {
    public var did: String?
    public var followedAt: String?

    public init(did: String?, followedAt: String? = nil) {
      self.did = did
      self.followedAt = followedAt
    }
  }

  public struct Account: Codable, Hashable, Sendable {
    public var did: String?

    public init(did: String?) {
      self.did = did
    }
  }

  public var following: [Follow]
  public var followers: [Account]
  public var inbound: [Account]

  public init(following: [Follow] = [], followers: [Account] = [], inbound: [Account] = []) {
    self.following = following
    self.followers = followers
    self.inbound = inbound
  }

  public init(from decoder: Decoder) throws {
    let value = try JSONValue(from: decoder)
    func list(_ key: String) -> [JSONValue] { value[key]?.arrayValue ?? [] }
    following = list("following").map { Follow(did: $0["did"]?.stringValue, followedAt: $0["followedAt"]?.stringValue) }
    followers = list("followers").map { Account(did: $0["did"]?.stringValue) }
    inbound = list("inbound").map { Account(did: $0["did"]?.stringValue) }
  }
}

public enum Scan {
  static let post = "app.bsky.feed.post"

  /// CANARY_CANDIDATES: how many of your follows are offered to
  /// `findCanary`. It reads at most a few batches of them.
  public static let canaryCandidates = Score.profileBatch * 6

  /// SECOND_LOOK_MS: the pause before looking for a canary a second time.
  static let secondLookMs: Double = 1500

  /// CANARY_REQUIRED_AT: how many follows it takes for "none of them is
  /// followed by any other" to be past believing. With this many and no
  /// canary after two looks, the scan stops instead of calling friends of
  /// friends strangers.
  public static let canaryRequiredAt = 20

  /// STAGES: the stages a scan goes through, in order, with their words.
  public static let stages: [ScanStage] = [
    ScanStage(key: "post", label: "Finding the post"),
    ScanStage(key: "harvest", label: "Reading who engaged"),
    ScanStage(key: "canary", label: "Checking the AppView counts"),
    ScanStage(key: "score", label: "Sorting by who you know"),
  ]

  static let notALink = "That isn’t a link to a post. Paste a bsky.app link to a post, or its at:// address."
  static let noVouches =
    "Bluesky isn’t saying who you know in common with anyone right now, so nobody was sorted: they would all have looked like strangers. Try again in a few minutes."

  /// A handle's DID, or nil when nobody has it.
  public typealias ResolveHandle = @Sendable (_ handle: String) async throws -> String?

  /// A harvest of a post, reporting its progress (harvestPost's shape).
  public typealias HarvestRead = @Sendable (_ uri: String, _ onProgress: @escaping HarvestProgressHandler) async throws -> Harvest

  /// The owner's curation lists' members as did → reason.
  public typealias ReadCurated = @Sendable (_ ownerDid: String) async throws -> ReasonMap

  /// `readPostInput(input)`: the post a pasted link names (a bsky.app link,
  /// an aturi.to link or an at:// URI), or nil for anything else.
  public static func readPostInput(_ input: String?) -> PostInput? {
    let text = input?.jsTrimmed() ?? ""
    if text.isEmpty { return nil }
    guard let link = PostLink.parsePostLink(text), !link.rkey.isEmpty else { return nil }
    if let did = link.did, !did.isEmpty { return PostInput(did: did, rkey: link.rkey) }
    return PostInput(handle: link.handle, rkey: link.rkey)
  }

  /// The web's default resolveHandle: the public AppView's.
  static func publicResolveHandle(transport: any HTTPTransport) -> ResolveHandle {
    { handle in await PublicAppView.resolveHandle(handle, transport: transport) }
  }

  /// `resolvePost(input, { resolveHandle, signal })`: the post's URI and its
  /// author, resolving a handle if the link has one. Throws ScanError with
  /// code link (not a post link) or author (a handle nobody has), whatever
  /// `resolveHandle` throws, and CancellationError once stopped.
  public static func resolvePost(_ input: String?, resolveHandle: ResolveHandle) async throws -> ScanPost {
    guard let ref = readPostInput(input) else { throw ScanError(notALink, code: .link) }
    let found: String?
    if let did = ref.did {
      found = did
    } else {
      found = try await resolveHandle(ref.handle ?? "")
    }
    try Task.checkCancellation()
    guard let did = found, !did.isEmpty else {
      throw ScanError("Couldn’t find @\(ref.handle ?? "undefined"). Check the link and try again.", code: .author)
    }
    return ScanPost(uri: "at://\(did)/\(post)/\(ref.rkey)", authorDid: did)
  }

  /// `canaryCandidates(archive, { ownerDid, limit })`: accounts you follow,
  /// best canary first: those who follow you back, the ones who engage
  /// with you most leading, then the rest, the most recently followed
  /// first. Each once, never the owner, at most `limit`. A `followedAt`
  /// without an offset is read in `timeZone` (nil: AppLocale's active zone,
  /// the web's local time).
  public static func canaryCandidates(
    _ archive: CanaryArchive = CanaryArchive(),
    ownerDid: String? = nil,
    limit: Int = Scan.canaryCandidates,
    timeZone: TimeZone? = nil
  ) -> [String] {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let followsMe = Set(archive.followers.compactMap(\.did).map(JSKey.init))
    var talk: [JSKey: Int] = [:]
    for e in archive.inbound {
      if let did = e.did, !did.isEmpty { talk[JSKey(did), default: 0] += 1 }
    }
    var seen = Set<JSKey>()
    var follows: [(did: String, at: Double)] = []
    for f in archive.following {
      guard let did = f.did, !did.isEmpty, !Optional(did).jsEquals(ownerDid), !seen.contains(JSKey(did)) else { continue }
      seen.insert(JSKey(did))
      let at = JSDate.parse(f.followedAt ?? "", timeZone: zone)
      follows.append((did, at.isNaN ? 0 : at))
    }
    func rank(_ did: String) -> Double { followsMe.contains(JSKey(did)) ? 0 : 1 }
    func talked(_ did: String) -> Double { Double(talk[JSKey(did)] ?? 0) }
    let sorted = follows.jsSorted { a, b in
      let byRank = rank(a.did) - rank(b.did)
      if byRank != 0 { return byRank }
      let byTalk = talked(b.did) - talked(a.did)
      if byTalk != 0 { return byTalk }
      let byTime = b.at - a.at
      if byTime != 0 { return byTime }
      return Array(a.did.utf16).lexicographicallyPrecedes(Array(b.did.utf16)) ? -1 : 1
    }
    return sorted.jsSlice(0, limit).map(\.did)
  }

  /// `signedInProfiles(agent)`: the signed-in `getProfiles`, asked of
  /// Bluesky's AppView as the owner (the owner's own session is the point:
  /// `knownFollowers` counts THEIR follows). The profiles the AppView gave,
  /// or none when it gave no list.
  public static func signedInProfiles(_ agent: XRPCAgent) -> GetProfiles {
    let appview = agent.withProxy("bsky_appview", "did:web:api.bsky.app")
    return { dids in
      let res = try await appview.query(
        "app.bsky.actor.getProfiles", ["actors": .strings(dids)], options: XRPCAgent.CallOptions(hasSignal: true))
      return res.data["profiles"]?.arrayValue ?? []
    }
  }

  /// `readCurationLists(ownerDid, { signal })`: the owner's curation lists'
  /// members as did → `on your list “<name>”`, or none when they can't be
  /// read (the veto at the write reads them again and fails closed, so a
  /// scan that can't is only less exact). A stop is rethrown.
  public static func readCurationLists(
    _ ownerDid: String,
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport
  ) async throws -> ReasonMap {
    do {
      let members = try await Veto.curationMembers(ownerDid, appview: appview, transport: transport)
      return ReasonMap(members.entries.map { ($0.did, "on your list “\($0.reason)”") })
    } catch {
      try Task.checkCancellation()
      return ReasonMap()
    }
  }

  /// `scanErrorFrom(err, signal)`: a failure from any stage, as a ScanError
  /// the page can word. `aborted` is the web's `signal.aborted`; a
  /// CancellationError (or an AbortError) is a stop as well.
  public static func scanErrorFrom(_ error: any Error, aborted: Bool = false) -> ScanError {
    if aborted || error is CancellationError || JSErrorFields(error)?.name == "AbortError" {
      return ScanError("The scan was stopped.", code: .aborted, cause: error)
    }
    if let own = error as? ScanError { return own }
    if Scopes.isMissingScopeError(error) || Scopes.isMissingScopeError((error as? any CausedError)?.cause) {
      return ScanError(
        "This session wasn’t given the permission a scan needs. Turn Defense on to ask for it.", code: .permission,
        cause: error)
    }
    if let score = error as? ScoreError {
      return ScanError(score.message, code: score.code == .vouches ? .vouches : .read, cause: error)
    }
    let message = JSErrorFields(error)?.message ?? ""
    return ScanError(message.isEmpty ? "The scan stopped. Try again in a minute." : message, code: .harvest, cause: error)
  }

  /// An instant as `new Date(ms).toISOString()` writes it.
  static func isoString(_ date: Date) -> String {
    JSDate.toISOString((date.timeIntervalSince1970 * 1000).rounded()) ?? ""
  }

  /// `runScan({ input, ownerDid, getProfiles, candidates, onStage, signal,
  /// resolveHandle, harvest, getRelationships, readCurated, kept,
  /// retryDelaysMs, now })`: scan a post.
  ///
  /// Resolves to the summary score.js gives, with the post, the canary, and
  /// when it started and finished; throws a ScanError, whatever went wrong
  /// (a stop included). Each stage is reported through `onStage` and
  /// awaited, so the reports land in order. `candidates` is
  /// `canaryCandidates(archive)`; `kept` is who the owner kept by hand
  /// (did → reason). The reads default to the web's, over `transport`:
  /// the public resolveHandle, harvestPost, publicRelationships and the
  /// owner's curation lists, read best effort. `now` stamps the scan and is
  /// the scorer's clock; `timeZone` is the zone a profile's `createdAt`
  /// without an offset is read in (nil: AppLocale's active zone).
  public static func runScan(
    input: String?,
    ownerDid: String,
    getProfiles: @escaping GetProfiles,
    candidates: [String] = [],
    onStage: ScanStageHandler? = nil,
    resolveHandle: ResolveHandle? = nil,
    harvest: HarvestRead? = nil,
    getRelationships: GetRelationships? = nil,
    readCurated: ReadCurated? = nil,
    kept: ReasonMap? = nil,
    retryDelaysMs: [Double]? = nil,
    transport: any HTTPTransport = HTTP.transport,
    now: @escaping @Sendable () -> Date = { Date() },
    timeZone: TimeZone? = nil
  ) async throws(ScanError) -> ScanResult {
    let startedAt = isoString(now())
    let say: @Sendable (String, Int?, Int?) async -> Void = { stage, done, total in
      await onStage?(ScanStageReport(stage: stage, done: done, total: total))
    }
    let resolve = resolveHandle ?? publicResolveHandle(transport: transport)
    let read: HarvestRead =
      harvest ?? { uri, onProgress in
        try await Harvest.harvestPost(uri, onProgress: onProgress, transport: transport, now: now)
      }
    let relationships = getRelationships ?? Score.publicRelationships(transport: transport)
    let curatedRead: ReadCurated = readCurated ?? { owner in try await readCurationLists(owner, transport: transport) }
    let delays = retryDelaysMs ?? Score.retryDelaysMs
    do {
      await say("post", nil, nil)
      let post = try await resolvePost(input, resolveHandle: resolve)

      await say("harvest", 0, 0)
      let harvested = try await read(post.uri) { p in await say("harvest", p.done, p.total) }
      // You, and whoever wrote the post, are in its thread too; neither is
      // one of the people who engaged with it.
      let people = Score.withoutSelves(harvested, [ownerDid, post.authorDid])

      await say("canary", nil, nil)
      // Who the owner keeps: on a curation list of theirs, or by hand.
      let curated = try await curatedRead(ownerDid)
      let protectedSet = curated.merging(kept ?? ReasonMap())
      var canary = try await Score.findCanary(
        ownerDid: ownerDid, candidates: candidates, getProfiles: getProfiles, retryDelaysMs: delays)
      if canary == nil && !candidates.isEmpty {
        // From here a lookup that failed open looks just like follows
        // nobody else you follow follows. Once more after a pause, before
        // taking it for the second and scoring without vouches.
        await Limit.pause(retryDelaysMs?.first ?? secondLookMs)
        canary = try await Score.findCanary(
          ownerDid: ownerDid, candidates: candidates, getProfiles: getProfiles, retryDelaysMs: delays)
      }
      if canary == nil && candidates.count >= canaryRequiredAt {
        throw ScanError(noVouches, code: .vouches)
      }
      let found = canary
      let others = found.map { c in candidates.filter { !$0.jsEquals(c) } } ?? candidates
      let scorer = try Score.createScorer(
        ownerDid: ownerDid,
        getProfiles: getProfiles,
        getRelationships: relationships,
        canary: found,
        // Asked once, if the canary stops answering (it may have been
        // unfollowed since the archive's last sync): the next best, without it.
        refindCanary: {
          try await Score.findCanary(ownerDid: ownerDid, candidates: others, getProfiles: getProfiles, retryDelaysMs: delays)
        },
        protectedSet: protectedSet.dictionary,
        selves: [ownerDid, post.authorDid],
        retryDelaysMs: delays,
        now: now,
        timeZone: timeZone)

      let dids = people.participants.map(\.did)
      await say("score", 0, dids.count)
      let scored = try await scorer.score(dids) { p in await say("score", p.done, p.total) }
      let summary = Score.summarise(people, scored.scores, vouchCheck: scored.vouchCheck)
      return ScanResult(summary: summary, post: post, canary: found, startedAt: startedAt, finishedAt: isoString(now()))
    } catch {
      throw scanErrorFrom(error, aborted: Task.isCancelled)
    }
  }
}
