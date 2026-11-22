// Ports src/reports/models.js
//
// What posts are made of (the Content report), the lists the account is on
// and the follower log.

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

extension ReportModels {
  /// What a post is, by what it carries. A quote that also has pictures is its pictures.
  public static let contentFormats: [ContentDef] = [
    ContentDef(key: "text", label: "Text only"),
    ContentDef(key: "image", label: "Images"),
    ContentDef(key: "video", label: "Video"),
    ContentDef(key: "link", label: "Link card"),
    ContentDef(key: "gif", label: "GIF"),
    ContentDef(key: "quote", label: "Quote post"),
  ]

  /// Length bands, in the characters Bluesky counts (a post holds 300).
  public static let lengthBands: [ContentDef] = [
    ContentDef(key: "short", label: "Up to 80", max: 80),
    ContentDef(key: "medium", label: "81 to 160", max: 160),
    ContentDef(key: "long", label: "161 to 240", max: 240),
    ContentDef(key: "full", label: "241 to 300", max: .infinity),
  ]

  public static let threadPlaces: [ContentDef] = [
    ContentDef(key: "single", label: "On its own"),
    ContentDef(key: "opener", label: "Starts a thread"),
    ContentDef(key: "later", label: "Later in a thread"),
  ]

  /// The fewest posts a group needs before its typical post is shown.
  public static let contentMinPosts = bestTimeMinPosts

  /// `post.media || (post.quoteOf ? 'quote' : 'text')`.
  public static func formatOf(_ post: PostRow) -> String {
    if let media = post.media, !media.isEmpty { return media }
    return (post.quoteOf ?? "").isEmpty ? "text" : "quote"
  }

  /// Whether the archive's post rows hold what the Content report reads.
  public static func contentReady(_ archive: ReportArchive) -> Bool {
    archive.meta.posts?["shape"] == .number(Double(Analytics.postRowVersion))
  }

  struct Tally {
    var posts = 0
    var total = 0
    var settled: [Double] = []

    mutating func add(_ post: PostRow, settled isSettled: Bool) {
      let e = Analytics.engagementOf(post, "all")
      posts += 1
      total += e
      if isSettled { settled.append(Double(e)) }
    }

    func closed(_ all: Int) -> ContentTally {
      ContentTally(
        posts: posts, total: total, share: all != 0 ? Double(posts) / Double(all) : 0,
        // The typical post, as Best time to post reads it: the median, and
        // only once there are enough posts for a middle to mean something.
        typical: settled.count >= contentMinPosts ? median(settled) : nil)
    }
  }

  /// A Map of tallies, by code units, in the order first met.
  struct Tallies {
    var order: [JSKey] = []
    var names: [JSKey: String] = [:]
    var tallies: [JSKey: Tally] = [:]

    mutating func add(_ key: String, name: String, _ post: PostRow, settled: Bool) {
      let k = JSKey(key)
      if tallies[k] == nil {
        order.append(k)
        names[k] = name
        tallies[k] = Tally()
      }
      tallies[k]!.add(post, settled: settled)
    }
  }

  /// What the account's posts are made of, and what each kind typically
  /// earns: by format, by length, by tag, by linked site, by place in a
  /// thread, plus how much of its media is described. Over the owner's own
  /// voice (top-level posts and their own threads), like the engagement
  /// rate: a reply inside someone else's conversation earns on a different
  /// scale.
  ///
  /// Counts are every post in the window. What a group "typically earns" is
  /// the median over its posts older than two days, since the newest are
  /// still collecting, and is nil for a group with fewer than
  /// `contentMinPosts`.
  ///
  /// A row that doesn't hold what a post is made of is left out and counted
  /// in `unread`: it was archived before rows kept that, and its record has
  /// left the repo since (a deleted post), so there is nothing to read it
  /// from.
  public static func contentModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, formats: ReportFormats = .active
  ) -> ContentReport {
    let nowMs = Periods.periodEnd(period, nowMs)
    return cached(archive, "content", period, [], formats: formats) {
      let t0 = Periods.periodStart(period, nowMs) ?? -.infinity
      let settledBefore = nowMs - 2 * dayMs
      let dated = datedPosts(archive, formats: formats)
      let inWindow = dated.filter { at($0) >= t0 && at($0) <= nowMs && Analytics.isOwnVoicePost($0, archive.did) }
      let own = inWindow.filter { $0.len != nil }
      // The first post of a thread carries no reply; the posts after it name it.
      var openers = Set<JSKey>()
      for p in dated {
        if p.threadOf.jsEquals(archive.did) && p.replyTo.jsEquals(archive.did),
          let key = p.threadKey, !key.isEmpty
        {
          openers.insert(JSKey(key))
        }
      }

      var all = Tally()
      var formatTallies = Dictionary(uniqueKeysWithValues: contentFormats.map { ($0.key, Tally()) })
      var lengthTallies = Dictionary(uniqueKeysWithValues: lengthBands.map { ($0.key, Tally()) })
      var placeTallies = Dictionary(uniqueKeysWithValues: threadPlaces.map { ($0.key, Tally()) })
      var tags = Tallies()
      var links = Tallies()
      var langOrder: [JSKey] = []
      var langs: [JSKey: Int] = [:]
      var alt = AltCoverage(posts: 0, described: 0, items: 0, itemsDescribed: 0, pct: nil)
      var withTags = 0
      var withLinks = 0

      for p in own {
        let settled = at(p) <= settledBefore
        all.add(p, settled: settled)
        let format = formatOf(p)
        let formatKey = contentFormats.contains { $0.key.jsEquals(format) } ? format : "text"
        formatTallies[formatKey]!.add(p, settled: settled)
        let len = Double(p.len ?? 0)
        lengthTallies[lengthBands.first { len <= $0.max! }!.key]!.add(p, settled: settled)
        let place: String
        if !(p.replyTo ?? "").isEmpty {
          place = "later"
        } else if let rkey = p.rkey, openers.contains(JSKey(rkey)) {
          place = "opener"
        } else {
          place = "single"
        }
        placeTallies[place]!.add(p, settled: settled)

        if !(p.tags ?? []).isEmpty { withTags += 1 }
        for tag in p.tags ?? [] { tags.add(tag.jsLowercased(), name: tag, p, settled: settled) }
        if !(p.links ?? []).isEmpty { withLinks += 1 }
        for host in p.links ?? [] { links.add(host, name: host, p, settled: settled) }
        for lang in p.langs ?? [] {
          let key = JSKey(lang)
          if langs[key] == nil { langOrder.append(key) }
          langs[key, default: 0] += 1
        }
        if p.media == "image" || p.media == "video" {
          alt.posts += 1
          alt.items += p.mediaCount ?? 0
          alt.itemsDescribed += p.altCount ?? 0
          if let count = p.mediaCount, count != 0, let described = p.altCount, described >= count { alt.described += 1 }
        }
      }

      func ranked(_ tallies: Tallies) -> [ContentUse] {
        let uses = tallies.order.map { ContentUse(name: tallies.names[$0]!, tally: tallies.tallies[$0]!.closed(all.posts)) }
        return JSSort.sort(uses) { a, b in
          // The name only breaks a tie (collation is the slow part).
          let term = JSMath.or(Double(b.posts - a.posts), (b.typical ?? -1) - (a.typical ?? -1))
          return term != 0 && !term.isNaN ? term : Double(JSCollation.localeCompare(a.name, b.name))
        }
      }
      func grouped(_ defs: [ContentDef], _ tallies: [String: Tally]) -> [ContentGroup] {
        defs.map { d in
          let t = tallies[d.key]!.closed(all.posts)
          return ContentGroup(key: d.key, label: d.label, posts: t.posts, total: t.total, share: t.share, typical: t.typical)
        }
      }
      let langCounts = JSSort.sort(langOrder.map { LangCount(lang: $0.value, posts: langs[$0]!) }) { a, b in
        a.posts != b.posts ? Double(b.posts - a.posts) : Double(JSCollation.localeCompare(a.lang, b.lang))
      }
      alt.pct = alt.items != 0 ? (Double(alt.itemsDescribed) / Double(alt.items)) * 100 : nil

      return ContentReport(
        ready: contentReady(archive),
        unread: inWindow.count - own.count,
        posts: all.posts,
        typical: all.settled.isEmpty ? nil : median(all.settled),
        formats: grouped(contentFormats, formatTallies),
        lengths: grouped(lengthBands, lengthTallies),
        places: grouped(threadPlaces, placeTallies),
        tags: ranked(tags),
        links: ranked(links),
        langs: langCounts,
        withTags: withTags,
        withLinks: withLinks,
        alt: alt)
    }
  }

  /// The group that typically earns the most among those with a typical
  /// value, and the one to hold it against (`against`, by key; the overall
  /// typical post when that group has none). Nil when there is nothing to
  /// compare.
  public static func contentStandout(_ groups: [ContentGroup], _ overall: Double?, _ against: String? = nil) -> ContentStandout? {
    let known = groups.filter { $0.typical != nil }
    if known.count < 2 { return nil }
    var best = known[0]
    for g in known.dropFirst() where g.typical! > best.typical! { best = g }
    let base = known.first { g in against.map { g.key.jsEquals($0) } == true && !g.key.jsEquals(best.key) }
    let baseline = base != nil ? base!.typical : overall
    guard let baseline, let top = best.typical, !(top <= baseline) else { return nil }
    return ContentStandout(best: best, base: base, baseline: baseline)
  }

  // MARK: - Lists and the follower log

  /// The lists the account is on, moderation lists first, then by size.
  public static func listsModel(_ archive: ReportArchive, formats: ReportFormats = .active) -> [ListInfo] {
    cached(archive, "lists", nil, [], formats: formats) {
      let lists = archive.meta.lists?.lists ?? []
      let order = ["moderation": 0.0, "curation": 1, "reference": 2]
      let rank = { (list: ListInfo) in order.jsValue(list.purpose) ?? 3 }
      return JSSort.sort(lists) { a, b in
        let term = JSMath.or(rank(a) - rank(b), Double((b.subscribers ?? 0) - (a.subscribers ?? 0)))
        return term != 0 && !term.isNaN ? term : Double(JSCollation.localeCompare(a.name, b.name))
      }
    }
  }

  /// The unfollow tracker's view of the follower log.
  public static func followerLogModel(_ archive: ReportArchive, formats: ReportFormats = .active) -> FollowerLogReport {
    cached(archive, "followerLog", nil, [], formats: formats) {
      let log = archive.meta.followerLog
      let entries = log?.entries ?? []
      let lastAt = log?.lastSyncAt.flatMap { $0 == 0 || $0.isNaN ? nil : $0 }
      let latest = entries.filter { $0.at == lastAt }
      return FollowerLogReport(
        tracking: log != nil,
        since: log?.firstSyncAt.flatMap { $0 == 0 || $0.isNaN ? nil : $0 },
        lastSyncAt: lastAt,
        lost: entries.filter { $0.kind == "lost" },
        gained: entries.filter { $0.kind == "gained" },
        latestLost: latest.filter { $0.kind == "lost" },
        latestGained: latest.filter { $0.kind == "gained" })
    }
  }
}
