// Ports src/tools/interactionModel.js
//
// What the Interaction lookup shows: everything the archive holds between
// the account and one other account, with the two directions kept apart.
//
//   "in"   them to you: the inbound store, which is the account's
//          notifications (likes, reposts, replies, quotes and mentions)
//   "out"  you to them: the outbound store (the likes and reposts in the
//          repo) and the replies and quotes in the post archive
//
// Pure functions of the archive, cached per sync like the report models.
// What the archive doesn't hold stays nil instead of becoming a zero: a
// month before the notifications begin has no inbound count, a follow whose
// record key isn't a timestamp has no date, and the mentions you made have
// no count until the post rows keep who each post mentions.
//
// An event row may carry `subject`, the at:// URI of the post it was about.
// Everything that needs it (which of your posts someone engaged with, a link
// from a like to the post) reads it when it's there and reports that it
// isn't when it's not.
//
// The types are InteractionModel+Types.swift. Nothing here reads the
// network: the lookup page resolves a typed handle itself (VirgaUI).

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

public enum InteractionModel {
  /// Where the tool lives. The chosen account is `?who=<did>` on it.
  public static let lookupPath = "/tools/interaction-lookup"

  /// Every kind of event, in the order the page lists them.
  public static let lookupKinds = ["like", "repost", "reply", "quote", "mention"]

  /// The kinds every archive can count from you to them. A mention joins
  /// them only when the post rows keep who each post mentions.
  public static let outboundKinds = ["like", "repost", "reply", "quote"]

  public static let kindLabel: [String: String] = [
    "like": "Likes", "repost": "Reposts", "reply": "Replies", "quote": "Quotes", "mention": "Mentions",
  ]

  /// Each kind as a count's noun, one and many: "1 reply", "2 replies".
  public static let kindNoun: [String: (one: String, many: String)] = [
    "like": ("like", "likes"), "repost": ("repost", "reposts"), "reply": ("reply", "replies"),
    "quote": ("quote", "quotes"), "mention": ("mention", "mentions"),
  ]

  /// The direction filter. "all" is the absence of a filter, as with kinds.
  public static let directions = [
    InteractionDirection(key: "all", label: "Both ways"),
    InteractionDirection(key: "in", label: "Them to you"),
    InteractionDirection(key: "out", label: "You to them"),
  ]

  static let postCollection = "app.bsky.feed.post"

  /// Whether the post archive says who posts mention: true once any row does.
  public static func keepsMentions(_ archive: ReportArchive, formats: ReportFormats = .active) -> Bool {
    ReportModels.cached(archive, "keepsMentions", nil, [], formats: formats) {
      archive.posts.contains { $0.mentions != nil }
    }
  }

  /// "2 likes, 1 reply": what a count of interactions is made of, from
  /// `{ kind: count }` pairs in the object's order (a row's byKind). Kinds
  /// with none are left out. In the page's order of kinds, or the largest
  /// first with `byCount`. A kind this doesn't name keeps its own word, with
  /// an s for more than one.
  public static func kindsLine(
    entries: [(key: String, value: Double)]?, byCount: Bool = false, locale: String? = nil
  ) -> String {
    let byKind = objectOrder(entries ?? [])
    let kinds = byKind.filter { $0.value > 0 }
    let order = { (k: String) in Double(lookupKinds.firstIndex { $0.jsEquals(k) } ?? lookupKinds.count) }
    let sorted = JSSort.sort(kinds) { a, b in
      JSMath.or(byCount ? b.value - a.value : 0, order(a.key) - order(b.key))
    }
    return sorted.map { k in
      let noun = kindNoun.jsValue(k.key) ?? (k.key, "\(k.key)s")
      return "\(fmtInt(k.value, locale: locale)) \(k.value == 1 ? noun.one : noun.many)"
    }.joined(separator: ", ")
  }

  /// `kindsLine` of a count per kind (a TopActor's byKind). The page's kinds
  /// come in the page's order; any others after them by name.
  public static func kindsLine(_ byKind: [String: Int]?, byCount: Bool = false, locale: String? = nil) -> String {
    let entries = (byKind ?? [:]).sorted { JSMath.less($0.key, $1.key) }.map { (key: $0.key, value: Double($0.value)) }
    return kindsLine(entries: entries, byCount: byCount, locale: locale)
  }

  /// An object's keys in the order `Object.keys` gives them: integer-like
  /// keys ascending first, then the rest as they were set (each once, the
  /// last value kept).
  static func objectOrder(_ entries: [(key: String, value: Double)]) -> [(key: String, value: Double)] {
    var order: [JSKey] = []
    var values: [JSKey: Double] = [:]
    for (key, value) in entries {
      let k = JSKey(key)
      if values[k] == nil { order.append(k) }
      values[k] = value
    }
    func index(_ key: String) -> UInt32? {
      guard let n = UInt32(key), n < UInt32.max, String(n) == key else { return nil }
      return n
    }
    let integers = order.compactMap { k in index(k.value).map { (k, $0) } }.sorted { $0.1 < $1.1 }.map(\.0)
    let rest = order.filter { index($0.value) == nil }
    return (integers + rest).map { (key: $0.value, value: values[$0]!) }
  }

  /// `Math.round(Number(n) || 0).toLocaleString(locale)`.
  static func fmtInt(_ n: Double, locale: String?) -> String {
    let number = n.isNaN || n == 0 ? 0 : n
    return AppLocale.formatNumber(number.jsRounded, locale: locale)
  }

  // MARK: - Naming an account

  /// `^did:(plc|web):[A-Za-z0-9._:%-]+$`.
  public static func isDid(_ text: String?) -> Bool {
    DID.isAtprotoDid(text ?? "")
  }

  /// Whether `text` starts with `prefix`, ASCII letters in any case (a
  /// regex's `/i` over an ASCII pattern).
  static func hasPrefixIgnoringCase(_ units: [UInt16], _ prefix: String) -> Bool {
    let p = Array(prefix.utf16)
    guard units.count >= p.count else { return false }
    for (a, b) in zip(units, p) {
      let lower = (0x41...0x5A).contains(a) ? a + 0x20 : a
      if lower != b { return false }
    }
    return true
  }

  /// What someone typed, without the wrapping a paste brings: a profile
  /// link, `at://`, an `@`.
  static func bareActor(_ text: String?) -> String {
    var s = (text ?? "").jsTrimmed()
    // /^https?:\/\/[^/]+\/profile\/([^/?#]+)/i
    let units = Array(s.utf16)
    var i = 0
    if hasPrefixIgnoringCase(units, "http") {
      i = 4
      if i < units.count, units[i] == 0x73 || units[i] == 0x53 { i += 1 }
      if hasPrefixIgnoringCase(Array(units[i...]), "://") {
        i += 3
        let hostStart = i
        while i < units.count, units[i] != 0x2F { i += 1 }
        if i > hostStart, hasPrefixIgnoringCase(Array(units[i...]), "/profile/") {
          i += 9
          let start = i
          while i < units.count, units[i] != 0x2F, units[i] != 0x3F, units[i] != 0x23 { i += 1 }
          if i > start {
            let captured = String(jsUnits: units[start..<i])
            s = (try? JSURI.decodeURIComponent(captured)) ?? captured
          }
        }
      }
    }
    var out = Array(s.utf16)
    if hasPrefixIgnoringCase(out, "at://") { out.removeFirst(5) }
    if out.first == 0x40 { out.removeFirst() }
    return String(jsUnits: out[...])
  }

  /// `^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$`
  static func isHandle(_ text: String) -> Bool {
    let labels = Array(text.utf16).split(separator: 0x2E, omittingEmptySubsequences: false)
    guard labels.count >= 2 else { return false }
    func isAlnum(_ u: UInt16) -> Bool { (0x61...0x7A).contains(u) || (0x30...0x39).contains(u) }
    for (index, label) in labels.enumerated() {
      guard (1...63).contains(label.count), let first = label.first, let last = label.last else { return false }
      if index == labels.count - 1 {
        guard (0x61...0x7A).contains(first) else { return false }
      } else {
        guard isAlnum(first) else { return false }
      }
      guard isAlnum(last), label.allSatisfy({ isAlnum($0) || $0 == 0x2D }) else { return false }
    }
    return true
  }

  /// A handle or a DID typed (or pasted) in full, or nil for anything else:
  /// half a name is a search, not an account to look up.
  public static func parseActorInput(_ text: String?) -> ActorInput? {
    let s = bareActor(text)
    if s.isEmpty { return nil }
    if isDid(s) { return ActorInput(kind: .did, value: s) }
    let handle = s.jsLowercased()
    if handle.utf16.count <= 253 && isHandle(handle) { return ActorInput(kind: .handle, value: handle) }
    return nil
  }

  /// The address of one account's history (or of the tool with nobody
  /// chosen, for nil), keeping whatever else the query string holds. The
  /// DID's colons are left as they are: they're allowed in a query, and the
  /// address is one people read and paste.
  public static func lookupHref(_ who: String?, _ search: String = "") -> String {
    let params = JSURI.parseSearchParams(search).filter { !$0.0.jsEquals("who") }
    let rest = JSURI.searchParams(params)
    var mine = ""
    if let who, !who.isEmpty {
      mine = "who=" + JSURI.encodeURIComponent(who).replacingOccurrences(of: "%3A", with: ":")
    }
    let query = [rest, mine].filter { !$0.isEmpty }.joined(separator: "&")
    return "\(lookupPath)\(query.isEmpty ? "" : "?\(query)")"
  }

  // MARK: - Everyone the archive knows

  /// `typeof ev?.at === 'number' ? ev.at : Date.parse(ev?.at)`, or nil.
  static func dated(_ at: JSONValue?, _ formats: ReportFormats) -> Double? {
    let ms: Double
    if case .number(let n)? = at { ms = n } else { ms = ReportModels.parse(at, formats) }
    return ms.isFinite ? ms : nil
  }

  static func dated(_ post: PostRow, _ formats: ReportFormats) -> Double? {
    dated(post.at.map(JSONValue.string), formats)
  }

  /// How many events the archive holds with each account, each way. The
  /// account's own DID is left out: replying to yourself is threading.
  public static func interactionIndex(_ archive: ReportArchive, formats: ReportFormats = .active) -> InteractionIndex {
    ReportModels.cached(archive, "interactionIndex", nil, [], formats: formats) {
      var order: [JSKey] = []
      var byDid: [JSKey: InteractionCount] = [:]
      func count(_ did: String?, _ inbound: Bool) {
        guard let did, !did.isEmpty, !did.jsEquals(archive.did) else { return }
        let key = JSKey(did)
        if byDid[key] == nil {
          byDid[key] = InteractionCount(did: did, in: 0, out: 0, total: 0)
          order.append(key)
        }
        if inbound { byDid[key]!.in += 1 } else { byDid[key]!.out += 1 }
        byDid[key]!.total += 1
      }
      for ev in archive.inbound where dated(ev.at, formats) != nil { count(ev.did, true) }
      for ev in archive.outbound where dated(ev.at, formats) != nil { count(ev.did, false) }
      for p in archive.posts {
        if dated(p, formats) == nil { continue }
        if let replyTo = p.replyTo, !replyTo.isEmpty { count(replyTo, false) }
        if let quoteOf = p.quoteOf, !quoteOf.isEmpty { count(quoteOf, false) }
        if let mentions = p.mentions {
          var seen = Set<JSKey>()
          for did in mentions where seen.insert(JSKey(did)).inserted { count(did, false) }
        }
      }
      let rows = order.map { byDid[$0]! }
      let ranked = JSSort.sort(rows) { a, b in JSMath.or(Double(b.total - a.total), JSMath.less(a.did, b.did) ? -1 : 1) }
      return InteractionIndex(order: order.map(\.value), byDid: byDid, ranked: ranked)
    }
  }

  /// Everyone the search can suggest: the accounts behind the archive's
  /// events, its followers and its follows, each with the name the archive
  /// has for them (`cardOf(did)`, a profile card or nil) and how much there
  /// is between you. Not cached: cards arrive between syncs.
  public static func peopleDirectory(
    _ archive: ReportArchive, cardOf: (String) -> ActorCard? = { _ in nil }, formats: ReportFormats = .active
  ) -> [DirectoryPerson] {
    let index = interactionIndex(archive, formats: formats)
    let sets = ReportModels.relationSets(archive, formats: formats)
    var seen = Set<JSKey>()
    var dids: [String] = []
    for did in index.order + sets.followers + sets.following where seen.insert(JSKey(did)).inserted { dids.append(did) }
    return dids.filter { !$0.jsEquals(archive.did) }.map { did in
      let card = cardOf(did)
      let counts = index.byDid[JSKey(did)]
      return DirectoryPerson(
        did: did, handle: card?.handle ?? "", displayName: card?.displayName ?? "", avatar: card?.avatar ?? "",
        in: counts?.in ?? 0, out: counts?.out ?? 0, total: counts?.total ?? 0, followsYou: sets.isFollower(did),
        youFollow: sets.isFollowed(did))
    }
  }

  /// `text.split(/\s+/)`.
  static func words(_ text: String) -> [[UInt16]] {
    var out: [[UInt16]] = [[]]
    var inSpace = false
    for scalar in text.unicodeScalars {
      if JSWhitespace.contains(scalar) {
        if !inSpace { out.append([]) }
        inSpace = true
      } else {
        inSpace = false
        out[out.count - 1].append(contentsOf: Array(String(scalar).utf16))
      }
    }
    return out
  }

  static func starts(_ text: [UInt16], _ prefix: [UInt16]) -> Bool {
    text.count >= prefix.count && Array(text[0..<prefix.count]) == prefix
  }

  static func contains(_ text: [UInt16], _ part: [UInt16]) -> Bool {
    if part.isEmpty { return true }
    guard text.count >= part.count else { return false }
    for start in 0...(text.count - part.count) where Array(text[start..<(start + part.count)]) == part { return true }
    return false
  }

  /// How well `person` answers the query `q` (lower is better), or nil.
  static func matchScore(_ person: DirectoryPerson, _ q: String) -> Int? {
    let query = Array(q.utf16)
    let did = Array(person.did.utf16)
    if starts(query, Array("did:".utf16)) { return did == query ? 0 : starts(did, query) ? 1 : nil }
    let handle = Array(person.handle.jsLowercased().utf16)
    let name = Array(person.displayName.jsLowercased().utf16)
    if handle == query || name == query { return 0 }
    if starts(handle, query) || starts(name, query) { return 1 }
    let nameWords = words(person.displayName.jsLowercased())
    let labels = handle.split(separator: 0x2E, omittingEmptySubsequences: false).map(Array.init)
    if nameWords.contains(where: { starts($0, query) }) || labels.contains(where: { starts($0, query) }) { return 2 }
    if contains(handle, query) || contains(name, query) { return 3 }
    return nil
  }

  /// The people in `directory` whose handle, name or DID matches what was
  /// typed: the closest match first, then whoever there is most history
  /// with. Someone the archive knows only by DID can be found only by DID.
  public static func matchPeople(_ directory: [DirectoryPerson]?, _ query: String?, limit: Int = 8) -> [DirectoryPerson] {
    let typed = bareActor(query)
    let q = starts(Array(typed.utf16), Array("did:".utf16)) ? typed : typed.jsLowercased()
    if q.isEmpty { return [] }
    var hits: [(person: DirectoryPerson, score: Int)] = []
    for person in directory ?? [] {
      if let score = matchScore(person, q) { hits.append((person, score)) }
    }
    let label = { (p: DirectoryPerson) in p.handle.isEmpty ? p.did : p.handle }
    let sorted = JSSort.sort(hits) { a, b in
      JSMath.or(Double(a.score - b.score), Double(b.person.total - a.person.total), JSMath.less(label(a.person), label(b.person)) ? -1 : 1)
    }
    return sorted.prefix(Swift.max(0, limit)).map(\.person)
  }

  // MARK: - One account

  static func postsByUri(_ archive: ReportArchive, formats: ReportFormats) -> [JSKey: PostRow] {
    ReportModels.cached(archive, "postsByUri", nil, [], formats: formats) {
      var out: [JSKey: PostRow] = [:]
      for p in archive.posts { out[JSKey(p.uri)] = p }
      return out
    }
  }

  /// The bsky.app address of a post, from the DID that wrote it and its record key.
  static func postUrl(_ did: String?, _ rkey: String?) -> String? {
    guard let did, !did.isEmpty, let rkey, !rkey.isEmpty else { return nil }
    return "https://bsky.app/profile/\(did)/post/\(JSURI.encodeURIComponent(rkey))"
  }

  /// The same, from an at:// URI, or nil when the URI doesn't name a post.
  static func postUrlOf(_ uri: String?) -> String? {
    // /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/?#]+)/
    guard let uri, let parts = AtUri.parsePrefix(uri) else { return nil }
    guard parts.authority.utf16.count > 4, parts.authority.utf16.starts(with: "did:".utf16),
      parts.collection.jsEquals(postCollection)
    else {
      return nil
    }
    return postUrl(parts.authority, parts.rkey)
  }

  static func iso(_ ms: Double) -> String {
    JSDate.toISOString(ms) ?? ""
  }

  /// Every event between the account and `who`, newest first.
  static func eventsWith(_ archive: ReportArchive, _ who: String, formats: ReportFormats) -> [InteractionEvent] {
    let mine = archive.did
    let posts = postsByUri(archive, formats: formats)
    var events: [InteractionEvent] = []

    for ev in archive.inbound {
      guard ev.did.jsEquals(who), !ev.uri.isEmpty, let atMs = dated(ev.at, formats) else { continue }
      let subject = ev.subject.flatMap { $0.isEmpty ? nil : $0 }
      // A reply, a quote and a mention are posts of theirs, by what a
      // notification of that kind is. A like or a repost is a record of its
      // own; the post is the one it points at.
      let theirPost = ev.kind == "reply" || ev.kind == "quote" || ev.kind == "mention"
      let yourPost = !theirPost && Analytics.didFromAtUri(subject).jsEquals(mine) ? subject : nil
      let url = theirPost ? postUrl(who, AtUri.rkey(of: ev.uri)) : postUrlOf(yourPost)
      events.append(
        InteractionEvent(
          key: "in|\(ev.uri)", dir: "in", kind: ev.kind, at: iso(atMs), atMs: atMs, uri: ev.uri, subject: subject,
          url: url, urlOwner: url == nil ? nil : theirPost ? "them" : "you",
          text: url != nil && yourPost != nil ? (posts[JSKey(yourPost!)]?.text ?? "") : ""))
    }

    for ev in archive.outbound {
      guard ev.did.jsEquals(who), !ev.uri.isEmpty, let atMs = dated(ev.at, formats) else { continue }
      let subject = ev.subject.flatMap { $0.isEmpty ? nil : $0 }
      let url = postUrlOf(subject)
      events.append(
        InteractionEvent(
          key: "out|\(ev.uri)", dir: "out", kind: ev.kind, at: iso(atMs), atMs: atMs, uri: ev.uri, subject: subject,
          url: url, urlOwner: url == nil ? nil : "them", text: ""))
    }

    // Replies, quotes and mentions are already in the post archive. A post
    // that does more than one of these to the same person is that many events.
    for p in archive.posts where !p.uri.isEmpty {
      var kinds: [String] = []
      if p.replyTo.jsEquals(who) { kinds.append("reply") }
      if p.quoteOf.jsEquals(who) { kinds.append("quote") }
      if let mentions = p.mentions, mentions.jsIncludes(who) { kinds.append("mention") }
      if kinds.isEmpty { continue }
      guard let atMs = dated(p, formats) else { continue }
      for kind in kinds {
        let rkey = p.rkey.flatMap { $0.isEmpty ? nil : $0 } ?? AtUri.rkey(of: p.uri)
        events.append(
          InteractionEvent(
            key: "out|\(p.uri)#\(kind)", dir: "out", kind: kind, at: iso(atMs), atMs: atMs, uri: p.uri, subject: nil,
            url: postUrl(mine, rkey), urlOwner: "you", text: p.text ?? ""))
      }
    }

    return JSSort.sort(events) { a, b in JSMath.or(b.atMs - a.atMs, JSMath.less(a.key, b.key) ? -1 : 1) }
  }

  /// A count for each of `kinds` and their total; every other kind is nil:
  /// not counted, which is not none.
  static func totalsOf(_ events: [InteractionEvent], _ kinds: [String]) -> KindTotals {
    // Only the counted kinds have a count; the rest stay out (nil).
    var counts: [String: Int] = [:]
    for k in lookupKinds where kinds.contains(k) { counts[k] = 0 }
    var total = 0
    for ev in events {
      guard let n = counts[ev.kind] else { continue }
      counts[ev.kind] = n + 1
      total += 1
    }
    return KindTotals(
      like: counts["like"], repost: counts["repost"], reply: counts["reply"], quote: counts["quote"],
      mention: counts["mention"], total: total)
  }

  static func validDate(_ value: String?, _ formats: ReportFormats) -> String? {
    guard let value, !value.isEmpty, JSDate.parse(value, timeZone: formats.timeZone).isFinite else { return nil }
    return value
  }

  /// Who follows whom, from the follower and follow stores, as of the last
  /// sync. `known` is whether that store has been read at all. `since` is
  /// nil when the follow is there but can't be dated.
  static func relationshipOf(_ archive: ReportArchive, _ who: String, formats: ReportFormats) -> InteractionRelationship {
    let sets = ReportModels.relationSets(archive, formats: formats)
    let follower = sets.followerCard(who)
    // A repo can hold two follow records for one account; the older one is
    // when the following began.
    let followedAt = JSSort.sort(
      archive.following.filter { $0.did.jsEquals(who) }.compactMap { validDate($0.followedAt, formats) }
    ) { JSDate.parse($0, timeZone: formats.timeZone) - JSDate.parse($1, timeZone: formats.timeZone) }

    // The unfollow log is the only record of someone who used to follow: its
    // newest entry for them says which way they last went.
    let last = archive.meta.followerLog?.entries.first { $0.did.jsEquals(who) }
    var left: InteractionRelationship.Left?
    if follower == nil, let last, last.kind == "lost" {
      left = InteractionRelationship.Left(
        noticedAt: last.at.flatMap { $0 == 0 || $0.isNaN ? nil : $0 },
        since: last.since.flatMap { $0 == 0 || $0.isNaN ? nil : $0 }, followedAt: validDate(last.followedAt, formats))
    }

    let paths = archive.blocks.filter { $0.did.jsEquals(who) }
    let block = paths.isEmpty ? nil : Analytics.blockReach(paths, timeZone: formats.timeZone).people.first

    return InteractionRelationship(
      theyFollow: .init(
        known: archive.meta.followers != nil, is: follower != nil, since: validDate(follower?.followedAt, formats),
        left: left),
      youFollow: .init(known: archive.meta.following != nil, is: sets.isFollowed(who), since: followedAt.first),
      theyBlock: block.map { .init(since: $0.blockedAt, direct: $0.direct, list: $0.list) })
  }

  /// Both directions by month, from the first event either way to now,
  /// every month in between present. A month that ended before the
  /// notifications begin has no inbound value.
  static func timelineOf(_ events: [InteractionEvent], _ nowMs: Double, _ inboundSinceMs: Double?, formats: ReportFormats)
    -> InteractionTimeline?
  {
    if events.isEmpty { return nil }
    var t0 = Double.infinity
    var t1 = nowMs
    for ev in events {
      if ev.atMs < t0 { t0 = ev.atMs }
      if ev.atMs > t1 { t1 = ev.atMs }
    }
    let zone = formats.timeZone
    func series(_ dir: String) -> [SeriesPoint] {
      Analytics.bucketSeries(
        events.filter { $0.dir == dir }, unit: .month, t0: t0, t1: t1, timeZone: zone, weekStart: formats.weekStart,
        pickTime: { .number($0.atMs) })
    }
    let covered = { (t: Double) in
      inboundSinceMs.map { Analytics.nextBucketMs(t, .month, timeZone: zone, weekStart: formats.weekStart) > $0 } ?? false
    }
    let inbound = series("in").map { TrendPoint(t: $0.t, v: covered($0.t) ? $0.v : nil) }
    let firstCovered = inbound.first { $0.v != nil }
    var fromMs: Double?
    if let firstCovered, let start = inbound.first, firstCovered.t > start.t { fromMs = firstCovered.t }
    return InteractionTimeline(
      unit: .month, inbound: inbound, outbound: series("out"), inboundFromMs: fromMs, inboundCovered: firstCovered != nil)
  }

  /// Which of your posts they engaged with, most first. Only an event with
  /// a `subject` can say; `known` is whether any of theirs does, and
  /// `counted` of `of` how many do (a mention has no post of yours to point
  /// at, so it isn't in `of`).
  static func engagedPostsOf(_ archive: ReportArchive, _ incoming: [InteractionEvent], formats: ReportFormats) -> EngagedPosts {
    let posts = postsByUri(archive, formats: formats)
    var order: [JSKey] = []
    var byUri: [JSKey: EngagedPost] = [:]
    var counted = 0
    var of = 0
    for ev in incoming where ev.kind != "mention" {
      of += 1
      guard let subject = ev.subject else { continue }
      counted += 1
      guard Analytics.didFromAtUri(subject).jsEquals(archive.did), let url = postUrlOf(subject) else { continue }
      let key = JSKey(subject)
      if byUri[key] == nil {
        byUri[key] = EngagedPost(uri: subject, url: url, post: posts[key], total: 0, byKind: [], latestMs: 0)
        order.append(key)
      }
      byUri[key]!.total += 1
      if let at = byUri[key]!.byKind.firstIndex(where: { $0.kind.jsEquals(ev.kind) }) {
        byUri[key]!.byKind[at].count += 1
      } else {
        byUri[key]!.byKind.append(KindCount(kind: ev.kind, count: 1))
      }
      if ev.atMs > byUri[key]!.latestMs { byUri[key]!.latestMs = ev.atMs }
    }
    let rows = JSSort.sort(order.map { byUri[$0]! }) { a, b in
      JSMath.or(Double(b.total - a.total), b.latestMs - a.latestMs, JSMath.less(a.uri, b.uri) ? -1 : 1)
    }
    return EngagedPosts(known: counted > 0, counted: counted, of: of, rows: rows)
  }

  /// How far back each side of the archive can speak.
  static func coverageOf(_ archive: ReportArchive, formats: ReportFormats) -> InteractionCoverage {
    let outMs = archive.meta.outbound?.coverageMs
    return InteractionCoverage(
      inboundSinceMs: Analytics.oldestEventMs(archive.inbound, timeZone: formats.timeZone),
      inboundTruncated: archive.meta.inbound?["truncated"]?.isTruthy ?? false,
      outboundSinceMs: outMs.flatMap { $0 > 0 ? $0 : nil },
      postsComplete: archive.meta.posts?["complete"]?.isTruthy ?? false)
  }

  /// Everything between the account and `who` (a DID). An account the
  /// archive has never met comes back the same shape, empty. Looking
  /// yourself up is `isSelf`: your replies to yourself are threads, not a
  /// history with someone. The timeline runs to the archive's now (or
  /// `nowMs` when the archive has none).
  public static func interactionModel(
    _ archive: ReportArchive, _ who: String, nowMs: Double? = nil, formats: ReportFormats = .active
  ) -> Interaction {
    ReportModels.cached(archive, "interaction", nil, [("who", .string(who))], formats: formats) {
      let isSelf = who.jsEquals(archive.did)
      let events = isSelf ? [] : eventsWith(archive, who, formats: formats)
      let incoming = events.filter { $0.dir == "in" }
      let outgoing = events.filter { $0.dir == "out" }
      let coverage = coverageOf(archive, formats: formats)
      let yourPosts =
        isSelf
        ? []
        : JSSort.sort(archive.posts.filter { $0.replyTo.jsEquals(who) || $0.quoteOf.jsEquals(who) }) { a, b in
          (dated(b, formats) ?? 0) - (dated(a, formats) ?? 0)
        }
      let now = archive.nowMs ?? nowMs ?? Date().timeIntervalSince1970 * 1000
      return Interaction(
        did: who,
        isSelf: isSelf,
        relationship: relationshipOf(archive, who, formats: formats),
        totals: .init(
          in: totalsOf(incoming, lookupKinds),
          out: totalsOf(outgoing, keepsMentions(archive, formats: formats) ? lookupKinds : outboundKinds)),
        // Newest first, so the first of each is at the end.
        first: .init(in: incoming.last, out: outgoing.last),
        latest: .init(in: incoming.first, out: outgoing.first),
        timeline: timelineOf(events, now, coverage.inboundSinceMs, formats: formats),
        coverage: coverage,
        engagedPosts: engagedPostsOf(archive, incoming, formats: formats),
        yourPosts: yourPosts,
        events: events)
    }
  }

  /// The events one direction and one kind leave: "all" is no filter.
  public static func filterEvents(_ events: [InteractionEvent]?, direction: String = "all", kind: String = "all") -> [InteractionEvent] {
    (events ?? []).filter { ev in
      (direction == "all" || ev.dir.jsEquals(direction)) && (kind == "all" || ev.kind.jsEquals(kind))
    }
  }

  static let phrases: [String: [String: String]] = [
    "in": [
      "like": "They liked one of your posts",
      "repost": "They reposted one of your posts",
      "reply": "They replied to you",
      "quote": "They quoted you",
      "mention": "They mentioned you",
    ],
    "out": [
      "like": "You liked one of their posts",
      "repost": "You reposted one of their posts",
      "reply": "You replied to them",
      "quote": "You quoted them",
      "mention": "You mentioned them",
    ],
  ]

  /// What an event was, in a sentence that says who did it.
  public static func eventPhrase(dir: String?, kind: String?) -> String {
    guard let dir, let kind else { return "" }
    return phrases.jsValue(dir)?.jsValue(kind) ?? ""
  }

  public static func eventPhrase(_ ev: InteractionEvent?) -> String {
    eventPhrase(dir: ev?.dir, kind: ev?.kind)
  }

  // MARK: - Export

  /// The events as rows for a CSV, the header first. `post_url` is the post
  /// an event can open, `post_by` whose it is, and `text` your own words
  /// where the post is yours. The account is named by its DID and handle
  /// only: a display name is free text from someone else, which a
  /// spreadsheet may take for a formula.
  public static func eventsCsvRows(_ events: [InteractionEvent]?, did: String?, handle: String? = "") -> [[String]] {
    let header = ["at", "direction", "kind", "their_did", "their_handle", "post_url", "post_by", "text", "record_uri"]
    return [header]
      + (events ?? []).map { ev in
        [
          ev.at, ev.dir == "in" ? "them to you" : "you to them", ev.kind, did ?? "", handle ?? "", ev.url ?? "",
          ev.urlOwner ?? "", newlines(ev.text), ev.uri,
        ]
      }
  }

  /// `.replace(/\r\n?/g, '\n')`.
  static func newlines(_ text: String) -> String {
    var out: [UInt16] = []
    let units = Array(text.utf16)
    var i = 0
    while i < units.count {
      if units[i] == 0x0D {
        out.append(0x0A)
        if i + 1 < units.count, units[i + 1] == 0x0A { i += 1 }
      } else {
        out.append(units[i])
      }
      i += 1
    }
    return String(jsUnits: out[...])
  }
}
