// Ports src/posting/library/model.js
//
// Suggestions for a reply ("For this reply"), local search, dedupe, and the
// order the slash menu offers templates in.

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

extension Library {
  // swift-format-ignore
  static let stopwords: Set<JSKey> = Set([
    "about", "above", "after", "again", "against", "almost", "along", "already", "also", "although", "always",
    "among", "another", "anyone", "anything", "anyway", "around", "away", "back", "because", "been", "before",
    "behind", "being", "below", "between", "both", "came", "cannot", "come", "could", "does",
    "doing", "done", "down", "during", "each", "either", "else", "enough", "even", "ever", "every", "everyone",
    "everything", "from", "further", "gets", "getting", "give", "goes", "going", "gonna", "good", "great", "have",
    "having", "hello", "here", "hers", "herself", "himself", "into", "itself", "just", "keep", "know", "last",
    "less", "like", "little", "look", "made", "make", "many", "maybe", "might", "more", "most", "much", "must",
    "myself", "need", "never", "next", "nothing", "okay", "once", "only", "onto", "other", "others", "ought",
    "ours", "ourselves", "over", "people", "please", "post", "pretty", "quite", "rather", "really", "reply",
    "right", "said", "same", "says", "seem", "seems", "shall", "should", "since", "some", "someone", "something",
    "still", "such", "sure", "take", "than", "thank", "thanks", "that", "their", "theirs", "them", "themselves",
    "then", "there", "these", "they", "thing", "things", "think", "this", "those", "though", "thought", "through",
    "time", "today", "together", "told", "too", "took", "under", "until", "upon", "used", "using", "very", "want",
    "wants", "well", "went", "were", "what", "whatever", "when", "where", "whether", "which", "while", "whom",
    "whose", "will", "with", "within", "without", "wonder", "would", "yeah", "your", "yours", "yourself",
    "yourselves", "http", "https",
    // Contractions typed without their apostrophe, and laughter.
    "aint", "arent", "cant", "couldnt", "didnt", "doesnt", "dont", "gotta", "hadnt", "hasnt", "havent", "isnt",
    "kinda", "lets", "shouldnt", "sorta", "theyll", "theyre", "theyve", "wanna", "wasnt", "werent", "wont",
    "wouldnt", "yall", "youll", "youre", "youve",
    "haha", "lmao",
    // Where the conversation happens, which nearly every post could mention.
    "bluesky", "bsky", "skeet", "atproto",
  ].map(JSKey.init))

  // Letters and numbers, with apostrophes only inside a word (so "moths'"
  // reads as "moths"): /[\p{L}\p{N}](?:[\p{L}\p{N}'’]*[\p{L}\p{N}])?/gu.
  static let wordPattern = JSRegex(#"[\p{L}\p{N}](?:[\p{L}\p{N}'’]*[\p{L}\p{N}])?"#)
  static let letterPattern = JSRegex(#"\p{L}"#)
  // /https?:\/\/\S+/gi and /@[\w.-]+/g.
  static let linkPattern = JSRegex("[hH][tT][tT][pP][sS]?://[^\(JSRegex.space)]+")
  static let handlePattern = JSRegex(#"@[A-Za-z0-9_.\-]+"#)

  static func letterCount(_ word: String) -> Int { letterPattern.matches(in: word).count }

  // Lower case, without a possessive or a plain plural, so "moths" and
  // "moth's" meet "moth". Any other apostrophe makes a contraction ("don't",
  // "you're"), never a topic. Words under four letters and stopwords give nil.
  static func stem(_ word: String) -> String? {
    var units = word.jsLowercased().utf16.map { $0 == 0x2019 ? 0x27 : $0 }
    if units.count >= 2, units[units.count - 2] == 0x27, units[units.count - 1] == 0x73 { units.removeLast(2) }
    if units.contains(0x27) { return nil }
    let whole = String(jsUnits: units)
    if stopwords.contains(JSKey(whole)) { return nil }
    let w = units.count > 4 && units.last == 0x73 && units[units.count - 2] != 0x73
      ? String(jsUnits: units.dropLast()) : whole
    if letterCount(w) < 4 { return nil }
    if stopwords.contains(JSKey(w)) { return nil }
    return w
  }

  /// `text.replace(regex, ' ')` for a global regex.
  static func blankOut(_ text: String, _ regex: JSRegex) -> String {
    let units = Array(text.utf16)
    var out: [UInt16] = []
    var cursor = 0
    for match in regex.matches(in: text) {
      out.append(contentsOf: units[cursor..<match.range.lowerBound])
      out.append(0x20)
      cursor = match.range.upperBound
    }
    out.append(contentsOf: units[cursor...])
    return String(jsUnits: out)
  }

  /// The meaningful words of `text`, in first-appearance order.
  static func meaningfulWords(_ text: String) -> [String] {
    // Links and handles share hosts and TLDs, which aren't topics.
    let cleaned = blankOut(blankOut(text, linkPattern), handlePattern)
    let units = Array(cleaned.utf16)
    var out: [String] = []
    for match in wordPattern.matches(in: cleaned) {
      guard let raw = match.group(0, in: units), let w = stem(raw) else { continue }
      if !out.contains(where: { $0.jsEquals(w) }) { out.append(w) }
    }
    return out
  }

  static func overlapNeeded(_ kind: String) -> Int? {
    switch kind {
    case "post": return 2
    case "feed", "list": return 1
    default: return nil
    }
  }

  // A post also qualifies on one shared word this long ("stamina").
  static let longWordLetters = 6
  // Among at least commonMinCandidates posts, feeds and lists, a word more
  // than commonShare of them have says little about any one of them, so it
  // doesn't count as shared.
  static let commonShare = 0.2
  static let commonMinCandidates = 5

  // The names a plain object answers for any key, which make OVERLAP_NEEDED
  // (`{ post: 2, feed: 1, list: 1 }`) truthy: an item of such a kind is a
  // candidate, though it never shares enough.
  static let objectPrototypeKeys: Set<String> = [
    "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "__lookupGetter__",
    "__lookupSetter__", "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "__proto__",
    "toLocaleString",
  ]

  static func sharesEnough(_ kind: String, _ shared: [String]) -> Bool {
    if let needed = overlapNeeded(kind), shared.count >= needed { return true }
    return kind == "post" && shared.contains { letterCount($0) >= longWordLetters }
  }

  /// Best matches for the post being replied to, at most `limit`: templates
  /// whose keywords its text mentions (most hits first), then posts, feeds
  /// and lists that share distinctive words with it (most shared first). A
  /// word is distinctive unless more than a fifth of the posts, feeds and
  /// lists have it (when there are five or more); feeds and lists need one,
  /// posts two, or one of six letters or more. Templates not offered on
  /// replies are skipped. Each comes back with its `reason`.
  public static func suggestItems(
    templates: [LibraryItem] = [], posts: [LibraryItem] = [], feeds: [LibraryItem] = [],
    lists: [LibraryItem] = [], parentText: String?, parentUri: String? = nil, limit: Int = 5
  ) -> [LibraryItem] {
    let text = parentText ?? ""
    if text.jsTrimmed().isEmpty || limit <= 0 { return [] }
    let others = posts + feeds + lists

    var byHits: [(item: LibraryItem, score: Int, reason: String)] = []
    for item in templates {
      guard let template = item.source, template.isTruthy,
        PostTemplates.templateOffered(template, replying: true)
      else { continue }
      let hits = PostTemplates.keywordMatches(template, text)
      if hits.isEmpty { continue }
      byHits.append((item, hits.count, "Their post mentions \(hits.prefix(3).map(quoted).joined(separator: ", "))"))
    }
    byHits = PostingJS.stableSorted(byHits) { -Double($0.score) }

    var candidates: [(item: LibraryItem, words: [String])] = []
    var candidateIds = Set<JSKey>()
    for item in others {
      guard overlapNeeded(item.kind) != nil || objectPrototypeKeys.contains(item.kind),
        !candidateIds.contains(JSKey(item.id))
      else { continue }
      if let parentUri, !parentUri.isEmpty, isString(item.source?["uri"], parentUri) { continue }
      candidateIds.insert(JSKey(item.id))
      // A reply's excerpt quotes its parent, whose words aren't the reply's own.
      let ownText = item.kind == "post" ? item.source?["record"]?["text"]?.stringValue : nil
      candidates.append((item, meaningfulWords(ownText ?? "\(item.title) \(item.excerpt)")))
    }

    var common = Set<JSKey>()
    if candidates.count >= commonMinCandidates {
      var counts: [JSKey: Int] = [:]
      for (_, words) in candidates {
        for w in words { counts[JSKey(w), default: 0] += 1 }
      }
      for (w, n) in counts where Double(n) / Double(candidates.count) > commonShare { common.insert(w) }
    }

    let parentWords = Set(meaningfulWords(text).map(JSKey.init))
    var byOverlap: [(item: LibraryItem, score: Int, reason: String)] = []
    for (item, words) in candidates {
      let shared = words.filter { parentWords.contains(JSKey($0)) && !common.contains(JSKey($0)) }
      if !sharesEnough(item.kind, shared) { continue }
      byOverlap.append((item, shared.count, "Shares \(joinAnd(shared.prefix(3).map(quoted))) with their post"))
    }
    byOverlap = PostingJS.stableSorted(byOverlap) { -Double($0.score) }

    var seen = Set<JSKey>()
    var out: [LibraryItem] = []
    for (item, _, reason) in byHits + byOverlap {
      if !seen.insert(JSKey(item.id)).inserted { continue }
      var picked = item
      picked.reason = reason
      out.append(picked)
      if out.count >= limit { break }
    }
    return out
  }

  /// suggestItems as the web takes its lists: items, or bare templates,
  /// post views, feed views and list views, made into items first (with
  /// `context`, `selfDid` and `clock`). A falsy entry is skipped.
  @_disfavoredOverload
  public static func suggestItems(
    templates: [JSONValue] = [], posts: [JSONValue] = [], feeds: [JSONValue] = [], lists: [JSONValue] = [],
    parentText: String?, parentUri: String? = nil, limit: Int = 5, context: TemplateContext? = nil,
    selfDid: String? = nil, clock: LibraryClock = LibraryClock()
  ) -> [LibraryItem] {
    func asItems(_ list: [JSONValue], _ make: (JSONValue) -> LibraryItem) -> [LibraryItem] {
      list.filter(\.isTruthy).map { $0["kind"]?.isTruthy == true ? LibraryItem(json: $0) : make($0) }
    }
    return suggestItems(
      templates: asItems(templates) { itemFromTemplate($0, context) },
      posts: asItems(posts) { itemFromPost($0, shelf: "posts", selfDid: selfDid, clock: clock) },
      feeds: asItems(feeds) { itemFromFeed($0, group: "yours") },
      lists: asItems(lists) { itemFromList($0) },
      parentText: parentText, parentUri: parentUri, limit: limit)
  }

  // MARK: - Search

  /// Items matching `query`. A query starting with "/" looks at template
  /// shortcuts only, best first (matchShortcut); anything else is a
  /// case-insensitive substring of an item's title, excerpt, label,
  /// shortcut or alt text, in the items' order. A blank query matches
  /// nothing. Duplicates by id are dropped.
  public static func searchItems(_ items: [LibraryItem]?, _ query: String?, replying: Bool = false) -> [LibraryItem] {
    let q = (query ?? "").jsTrimmed()
    if q.isEmpty { return [] }
    let list = dedupeById(items ?? [])
    if q.utf16.first == 0x2F {
      let templates = list.filter { $0.kind == "template" && $0.source?.isTruthy == true }
      let sources = templates.map { $0.source! }
      let matched = PostTemplates.matchShortcut(
        sources, String(jsUnits: Array(q.utf16.dropFirst())), replying: replying, limit: templates.count)
      // `new Map(templates.map((i) => [i.source.rkey, i]))`: the last item
      // with an rkey wins it.
      return matched.compactMap { t in
        let rkey = t["rkey"]
        return templates.last { TemplateJS.sameValueZero($0.source?["rkey"], rkey) }
      }
    }
    let needle = q.jsLowercased()
    return list.filter { i in
      [i.title, i.excerpt, i.label, i.shortcut, i.media?.alt ?? ""].contains { field in
        field.jsLowercased().jsIndexOf(needle) >= 0
      }
    }
  }

  /// `items` without those whose id is in `seenIds`, and without repeats
  /// among themselves.
  public static func dedupeById(_ items: [LibraryItem]?, _ seenIds: [String] = []) -> [LibraryItem] {
    dedupeById(items, Set(seenIds.map(JSKey.init)))
  }

  public static func dedupeById(_ items: [LibraryItem]?, _ seenIds: Set<JSKey>) -> [LibraryItem] {
    var seen = seenIds
    var out: [LibraryItem] = []
    for item in items ?? [] where seen.insert(JSKey(item.id)).inserted {
      out.append(item)
    }
    return out
  }

  // MARK: - The slash menu's order

  /// Templates in the order the slash menu offers them: those offered here
  /// first, then by keyword hits in the post being replied to, then by use,
  /// then by name. matchShortcut keeps this order among equal matches, so a
  /// bare "/" and ties follow it too. `usage` is readTemplateUsage's.
  public static func rankTemplatesForSlash<T: TemplateFields>(
    _ templates: [T]?, parentText: String = "", usage: TemplateUsageCounts? = nil, replying: Bool = false
  ) -> [T] {
    rank(templates, parentText: parentText, replying: replying) { rkey in
      usage?.entries.first { $0.rkey.jsEquals(rkey) }.map { finiteOrZero($0.use.count) } ?? 0
    }
  }

  /// rankTemplatesForSlash with `usage` as the web's object
  /// (`{ [rkey]: { count } }`), read with Object.hasOwn and `Number(count) || 0`.
  @_disfavoredOverload
  public static func rankTemplatesForSlash<T: TemplateFields>(
    _ templates: [T]?, parentText: String = "", usage: JSONValue?, replying: Bool = false
  ) -> [T] {
    let counts = usage?.objectValue ?? [:]
    return rank(templates, parentText: parentText, replying: replying) { rkey in
      guard let entry = counts.jsValue(rkey) else { return 0 }
      let n = entry["count"].map(\.jsNumber) ?? .nan
      return n.isNaN ? 0 : n
    }
  }

  static func finiteOrZero(_ n: Double) -> Double { n.isNaN ? 0 : n }

  struct RankRow<U> {
    var t: U
    var offered: Double
    var hits: Double
    var uses: Double
    var name: String
    var rkey: String
  }

  static func rank<T: TemplateFields>(
    _ templates: [T]?, parentText: String, replying: Bool, uses: (String) -> Double
  ) -> [T] {
    let rows: [RankRow<T>] = (templates ?? []).filter { $0.templateIsPresent }.map { t in
      let rkey = TemplateJS.text(t.templateField("rkey"))
      return RankRow(
        t: t, offered: PostTemplates.templateOffered(t, replying: replying) ? 1 : 0,
        hits: parentText.isEmpty ? 0 : Double(PostTemplates.keywordMatches(t, parentText).count),
        uses: rkey.map(uses) ?? 0, name: TemplateJS.str(t.templateField("name")),
        rkey: TemplateJS.str(t.templateField("rkey")))
    }
    return JSSort.sort(rows) { (a: RankRow<T>, b: RankRow<T>) -> Double in
      or(
        b.offered - a.offered,
        or(
          b.hits - a.hits,
          or(
            b.uses - a.uses,
            or(
              Double(JSCollation.localeCompare(a.name, b.name, sensitivity: .base)),
              Double(JSCollation.localeCompare(a.rkey, b.rkey))))))
    }.map(\.t)
  }
}

extension TemplateJS {
  /// SameValueZero, as a Map compares keys: strings by code unit, NaN
  /// equal to NaN, undefined only to undefined. (A key that is an object
  /// is the same object in the web's Map; from JSON it compares by value.)
  static func sameValueZero(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    switch (a, b) {
    case (.number(let x)?, .number(let y)?): return x == y || (x.isNaN && y.isNaN)
    case (.array?, .array?), (.object?, .object?): return a == b
    default: return strictEquals(a, b)
    }
  }
}
