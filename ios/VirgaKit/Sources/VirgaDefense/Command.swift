// Ports src/defense/command.js
//
// What an owner types to Virga's moderator in a DM, parsed rather than
// interpreted (docs/DEFENSE.md, phase 4). No model is involved anywhere here.
//
// A DM is untrusted text: it comes from whoever is on the other end of the
// conversation, and what they paste can carry anything. So the rule
// bluesky-mod is built on stands: a message either matches a verb here, with
// its target named in the owner's own words (a handle, a DID, a link they
// pasted, the post they shared), or it is not a command. "block them" names
// nobody, and is asked back, never guessed. Nothing a post says can choose a
// target, because no target is ever resolved against anything read.
//
// Every comparison is by UTF-16 code unit (Support/JSText.swift), as the
// web's are, so a look-alike character reads here exactly as it does there.

import Foundation
import VirgaCore

/// A message read as a command (`parseCommand`). Which fields are set
/// depends on the action, as on the web; a command whose target can't be
/// read has `needsTarget` set, and, where there is one, a `refusal` to say
/// back. A caller that only checks `needsTarget` acts on nobody.
public struct ParsedCommand: Codable, Hashable, Sendable {
  public enum Action: String, Codable, Hashable, Sendable {
    case plan, help, lists, status, link, history, undo, approve, cancel, review, keep, unkeep
    case newList = "new_list"
    case listAdd = "list_add"
    case listRemove = "list_remove"
  }

  public var action: Action
  /// plan: the engagement kind ("likers", …, "everyone").
  public var kind: String?
  /// plan: the post, as written (a link, an at:// URI or the shared post).
  public var target: String?
  /// new_list: its name, at most 64 code units.
  public var name: String?
  /// link: the linking code; undo, approve, cancel, review: the plan's short code.
  public var code: String?
  /// undo: the newest approval or add, named by no code.
  public var last: Bool?
  /// history, keep, unkeep, list_add, list_remove: the account (a handle or DID).
  public var actor: String?
  /// approve, cancel, review: the bands named, never PROTECTED.
  public var bands: [Band]?
  /// approve, cancel, review: the engagement kinds named, never "everyone".
  public var kinds: [String]?
  /// approve, cancel, review: the accounts named.
  public var actors: [String]?
  /// What to say back instead of acting.
  public var refusal: String?
  /// keep: the owner's words for why, at most 200 code units.
  public var reason: String?
  /// list_add, list_remove: the account is the shared post's author.
  public var fromPost: Bool?
  /// list_add, list_remove: other words came with the shared post; ask first.
  public var confirm: Bool?
  public var needsTarget: Bool
  /// The message as sent, trimmed, for the record.
  public var raw: String

  public init(
    action: Action,
    kind: String? = nil,
    target: String? = nil,
    name: String? = nil,
    code: String? = nil,
    last: Bool? = nil,
    actor: String? = nil,
    bands: [Band]? = nil,
    kinds: [String]? = nil,
    actors: [String]? = nil,
    refusal: String? = nil,
    reason: String? = nil,
    fromPost: Bool? = nil,
    confirm: Bool? = nil,
    needsTarget: Bool,
    raw: String
  ) {
    self.action = action
    self.kind = kind
    self.target = target
    self.name = name
    self.code = code
    self.last = last
    self.actor = actor
    self.bands = bands
    self.kinds = kinds
    self.actors = actors
    self.refusal = refusal
    self.reason = reason
    self.fromPost = fromPost
    self.confirm = confirm
    self.needsTarget = needsTarget
    self.raw = raw
  }
}

public enum Command {
  /// KINDS: the engagement kinds an approval or a plan can name, as
  /// harvest.js names them. `everyone` is nil: no filter, so engagement from
  /// a lexicon the harvest discovered is included too.
  public static let kinds: [String: [String]?] = [
    "likers": ["like"],
    "reposters": ["repost"],
    "repliers": ["reply", "threadReply"],
    "quoters": ["quote"],
    "everyone": nil,
  ]

  /// KINDS' names, in the web's order.
  public static let kindNames = ["likers", "reposters", "repliers", "quoters", "everyone"]

  /// The bands, for approvals; PROTECTED is never carried by one.
  static let bandNames = Band.allCases.map(\.rawValue)

  static let linkFeature = "app.bsky.richtext.facet#link"
  static let mentionFeature = "app.bsky.richtext.facet#mention"

  // MARK: Characters and shapes

  static func isASCIIAlnum(_ u: UInt16) -> Bool {
    (u >= 0x30 && u <= 0x39) || (u >= 0x41 && u <= 0x5A) || (u >= 0x61 && u <= 0x7A)
  }

  /// HANDLE, `/^@?([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)$/i`: the
  /// handle without its @, or nil.
  static func matchHandle(_ text: String) -> String? {
    var units = Array(text.utf16)
    if units.first == 0x40 { units.removeFirst() }
    let segments = units.split(separator: 0x2E, omittingEmptySubsequences: false)
    guard segments.count >= 2 else { return nil }
    for segment in segments {
      guard let first = segment.first, isASCIIAlnum(first),
        segment.allSatisfy({ isASCIIAlnum($0) || $0 == 0x2D })
      else { return nil }
    }
    return String(jsUnits: units)
  }

  /// DID, `/^did:[a-z]+:[a-zA-Z0-9._%-]+$/`: the identifier takes no colon.
  static func isTypedDid(_ text: String) -> Bool {
    let units = Array(text.utf16)
    let prefix = Array("did:".utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix else { return false }
    var i = prefix.count
    let methodStart = i
    while i < units.count, units[i] >= 0x61 && units[i] <= 0x7A { i += 1 }
    guard i > methodStart, i < units.count, units[i] == 0x3A else { return false }
    let identifier = units[(i + 1)...]
    return !identifier.isEmpty
      && identifier.allSatisfy { isASCIIAlnum($0) || $0 == 0x2E || $0 == 0x5F || $0 == 0x25 || $0 == 0x2D }
  }

  /// Every index where `needle` starts in `units`.
  static func occurrences(of needle: [UInt16], in units: [UInt16]) -> [Int] {
    guard units.count >= needle.count, !needle.isEmpty else { return [] }
    return (0...(units.count - needle.count)).filter { units[$0..<($0 + needle.count)].elementsEqual(needle) }
  }

  static let profileUnits = Array("/profile/".utf16)

  static func isJSWhitespace(_ u: UInt16) -> Bool {
    Unicode.Scalar(u).map(JSWhitespace.contains) ?? false
  }

  /// PROFILE, `/\/profile\/([^/?#\s]+)/`: the first actor a profile link names.
  static func matchProfile(_ text: String) -> String? {
    let units = Array(text.utf16)
    for start in occurrences(of: profileUnits, in: units) {
      var end = start + profileUnits.count
      while end < units.count, ![0x2F, 0x3F, 0x23].contains(units[end]), !isJSWhitespace(units[end]) { end += 1 }
      if end > start + profileUnits.count { return String(jsUnits: units[(start + profileUnits.count)..<end]) }
    }
    return nil
  }

  /// WEB_POST, `/\/profile\/([^/?#]+)\/post\/([^/?#]+)/`, tested.
  static func isWebPost(_ text: String) -> Bool {
    let units = Array(text.utf16)
    let post = Array("/post/".utf16)
    let stop: Set<UInt16> = [0x2F, 0x3F, 0x23]
    for start in occurrences(of: profileUnits, in: units) {
      var i = start + profileUnits.count
      let actorStart = i
      while i < units.count, !stop.contains(units[i]) { i += 1 }
      guard i > actorStart, units.count - i > post.count, units[i..<(i + post.count)].elementsEqual(post) else { continue }
      if !stop.contains(units[i + post.count]) { return true }
    }
    return false
  }

  /// AT_URI, `/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/?#]+)/`, tested.
  static func isAtUri(_ text: String) -> Bool {
    let units = Array(text.utf16)
    let prefix = Array("at://did:".utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix else { return false }
    var i = prefix.count
    let idStart = i
    while i < units.count, units[i] != 0x2F { i += 1 }
    guard i > idStart, i < units.count else { return false }
    i += 1
    let collectionStart = i
    while i < units.count, units[i] != 0x2F { i += 1 }
    guard i > collectionStart, i < units.count else { return false }
    i += 1
    return i < units.count && ![0x2F, 0x3F, 0x23].contains(units[i])
  }

  /// AT_POST, `/^at:\/\/[^/]+\/app\.bsky\.feed\.post\//`.
  static func isAtPost(_ text: String) -> Bool {
    let units = Array(text.utf16)
    let scheme = Array("at://".utf16)
    let collection = Array("/app.bsky.feed.post/".utf16)
    guard units.count > scheme.count, Array(units[0..<scheme.count]) == scheme else { return false }
    var i = scheme.count
    while i < units.count, units[i] != 0x2F { i += 1 }
    guard i > scheme.count else { return false }
    return units.count - i >= collection.count && units[i..<(i + collection.count)].elementsEqual(collection)
  }

  /// CODE, `/^[0-9a-f]{8}$/`: a plan's short code.
  static func isPlanCode(_ text: String) -> Bool {
    let units = Array(text.utf16)
    return units.count == 8 && units.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
  }

  /// LINK_CODE, `/^([A-HJ-NP-Z2-9]{4})-?([A-HJ-NP-Z2-9]{4})$/i`: the eight
  /// letters and digits, upper-cased, of a linking code as Settings shows it.
  static func matchLinkCode(_ text: String) -> String? {
    var units = Array(text.utf16)
    if units.count == 9 {
      guard units[4] == 0x2D else { return nil }
      units.remove(at: 4)
    }
    guard units.count == 8 else { return nil }
    let upper = units.map { $0 >= 0x61 && $0 <= 0x7A ? $0 - 0x20 : $0 }
    let valid = upper.allSatisfy { u in
      (u >= 0x32 && u <= 0x39) || (u >= 0x41 && u <= 0x5A && u != 0x49 && u != 0x4F)
    }
    return valid ? String(jsUnits: upper) : nil
  }

  /// `bare`: a token without the punctuation a sentence leaves on it.
  static func bare(_ token: String?) -> String {
    (token ?? "").droppingTrailing([")", ",", ".", "?", "!", ":", ";"])
  }

  /// SHORTENED, `/\/profile\/\S*(?:\.\.\.|…)/`: a link a client shortened for
  /// display ("bsky.app/profile/jo.e..."). What is left of the handle can
  /// look like one, so a shortened link is never read; the whole URL is in
  /// the message's facets.
  static func isShortened(_ text: String) -> Bool {
    let units = Array(text.utf16)
    let dots = Array("...".utf16)
    for start in occurrences(of: profileUnits, in: units) {
      var end = start + profileUnits.count
      while end < units.count, !isJSWhitespace(units[end]) { end += 1 }
      let run = Array(units[(start + profileUnits.count)..<end])
      if run.contains(0x2026) || !occurrences(of: dots, in: run).isEmpty { return true }
    }
    return false
  }

  /// TRUNCATED, `/(\.\.\.|…)|bsky\.app|\/profile\//`.
  static func isTruncated(_ text: String) -> Bool {
    text.jsIncludes("...") || text.jsIncludes("…") || text.jsIncludes("bsky.app") || text.jsIncludes("/profile/")
  }

  // MARK: Targets

  /// The short code a plan is named by in a DM: the first eight hex digits of its id.
  public static func shortCode(_ uuid: String?) -> String {
    String(jsUnits: (uuid ?? "").utf16.filter { $0 != 0x2D }).jsSlice(0, 8).jsLowercased()
  }

  /// The DID in `at://did:plc:xxx/collection/rkey`, or nil.
  public static func authorOf(_ uri: String?) -> String? {
    let units = Array((uri ?? "").utf16)
    let prefix = Array("at://did:".utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix else { return nil }
    var i = prefix.count
    while i < units.count, units[i] != 0x2F { i += 1 }
    guard i > prefix.count, i < units.count else { return nil }
    let did = String(jsUnits: units[5..<i])
    return DID.isValidDid(did) ? did : nil
  }

  /// Whether a string looks like a post link or an at:// URI. Cheap; resolves nothing.
  public static func looksLikeTarget(_ input: String?) -> Bool {
    let raw = (input ?? "").jsTrimmed()
    return isAtUri(raw) || isWebPost(raw)
  }

  static let openers: Set<Unicode.Scalar> = ["(", "<", "[", "\"", "'", "“", "‘"]
  static let closers: Set<Unicode.Scalar> = [")", ">", "]", "\"", "'", "”", "’", ",", ".", "!", "?", ";"]

  /// Every candidate target in a message, in order, deduplicated, its
  /// brackets and punctuation dropped.
  public static func extractTargets(_ text: String?) -> [String] {
    var found: [String] = []
    var seen = Set<[UInt16]>()
    for token in (text ?? "").jsSplitWhitespace() {
      let cleaned = token.droppingLeading(openers).droppingTrailing(closers)
      guard looksLikeTarget(cleaned), seen.insert(cleaned.jsKey).inserted else { continue }
      found.append(cleaned)
    }
    return found
  }

  /// The features of a message's facets whose `$type` is `type`, with
  /// `field` truthy: `field` as a string. (The web iterates `facets` and
  /// `features` as it finds them; anything but an array, which it would
  /// throw on or read as nothing, is nothing here.)
  static func facetValues(_ message: JSONValue?, type: String, field: String) -> [String] {
    var out: [String] = []
    for facet in message?["facets"]?.arrayValue ?? [] {
      for f in facet["features"]?.arrayValue ?? [] {
        guard let t = f["$type"]?.stringValue, t.jsEquals(type), let value = f[field], value.isTruthy else { continue }
        out.append(value.jsString)
      }
    }
    return out
  }

  /// The full URLs behind a message's links (a client truncates them in the text).
  public static func facetLinks(_ message: JSONValue?) -> [String] {
    facetValues(message, type: linkFeature, field: "uri")
  }

  /// The DIDs behind a message's @mentions, which survive truncation whole.
  public static func facetMentions(_ message: JSONValue?) -> [String] {
    facetValues(message, type: mentionFeature, field: "did")
  }

  /// A handle, DID or profile link, as written by the owner, not as
  /// inferred: the handle (lower-cased) or DID, or nil.
  public static func parseActor(_ token: String?) -> String? {
    // "@did:..." is how the moderator prints an account it has no handle for.
    var raw = (token ?? "").jsTrimmed()
    if raw.jsStartsWith("@did:") { raw = raw.jsSlice(1) }
    if raw.isEmpty { return nil }
    if isTypedDid(raw) { return raw }
    if let encoded = matchProfile(raw) {
      // A stray % in a pasted link reads as nobody; this runs on every word.
      guard let actor = try? JSURI.decodeURIComponent(encoded) else { return nil }
      if isTypedDid(actor) { return actor }
      return matchHandle(actor)?.jsLowercased()
    }
    return matchHandle(raw)?.jsLowercased()
  }

  static func typedActor(_ token: String?) -> String? {
    isShortened(token ?? "") ? nil : parseActor(bare(token))
  }

  /// The one account a message's facets name, or nil; two is ambiguous, and refused.
  static func oneFromFacets(_ links: [String], _ mentions: [String]) -> String? {
    let named = (mentions + links.compactMap(parseActor)).jsUnique()
    return named.count == 1 ? named[0] : nil
  }

  // MARK: Verbs

  private enum Verb {
    case plan, scan, approve, review, undo, history, help, status, lists, newList, link, cancel, unkeep, keep
    case listAdd, listRemove
  }

  /// The verbs, most specific first, each matched against the message with
  /// the web's `i` flag (Support/JSText.swift says how).
  private static let verbs: [(JSRegex, Verb)] = {
    let ws = JSRegex.ws
    let b = JSRegex.wordBoundary
    let tail = "(?:\(ws)|[?!.])*\\z"
    let table: [(String, Verb)] = [
      // Bulk first: "list add likers" is not adding an account called "likers".
      ("^(?:list\(ws)+)?add\(ws)+(?:the\(ws)+)?(likers|reposters|repliers|quoters|everyone)\(b)", .plan),
      ("^scan\(b)", .scan),
      ("^approve\(b)", .approve),
      ("^review\(b)", .review),
      ("^undo\(b)", .undo),
      ("^history\(b)", .history),
      // Touches nothing. Anchored to the whole message, so a real question
      // that starts with "help" isn't answered with a menu.
      ("^(?:help|commands|what can you do)\(tail)", .help),
      ("^(?:status|progress)\(tail)", .status),
      ("^(?:lists|my lists|show (?:me )?(?:my )?lists)\(tail)", .lists),
      ("^(?:new|make|create)\(ws)+(?:a\(ws)+)?list\(b)", .newList),
      ("^link\(b)", .link),
      ("^cancel\(b)", .cancel),
      ("^unkeep\(b)", .unkeep),
      ("^keep\(b)", .keep),
      ("^list\(ws)+add\(b)", .listAdd),
      ("^list\(ws)+remove\(b)", .listRemove),
      ("^block\(b)", .listAdd),
      ("^unblock\(b)", .listRemove),
    ]
    return table.map { (JSRegex($0.0, caseless: true), $0.1) }
  }()

  private static let newListName = JSRegex("^\(JSRegex.ws)*(?:called|named|for)\(JSRegex.ws)+", caseless: true)
  private static let keepBecause = JSRegex("^(?:because|as|—|-)\(JSRegex.ws)+", caseless: true)

  /// Ways of saying "the one you just did" that need no code.
  static let undoLast = ["last", "it", "that", "this", "them", "those"]

  /// Words an approval can carry that change nothing about who it adds.
  static let approveFiller = ["and", "the", "only", "ones", "accounts", "please", "&", "+"]

  /// Words that point at "the one in the shared post" without naming anyone else.
  static let pointer = [
    "them", "em", "they", "him", "her", "it", "this", "that", "these", "those", "the", "a", "an", "one", "guy", "gal",
    "dude", "person", "poster", "author", "op", "account", "user", "profile", "troll", "please", "now",
  ]

  /// Words that can sit beside a pasted post without making the message a question.
  static let scanFiller = ["post", "this", "that", "here", "scan", "one", "is", "the", "a", "an", "look", "at", "check", "please"]

  /// The verbs that write.
  static let writes: Set<ParsedCommand.Action> = [.plan, .approve, .undo, .listAdd, .listRemove, .keep, .unkeep, .newList]

  /// Whether a parsed command would change anything.
  public static func isWrite(_ cmd: ParsedCommand?) -> Bool {
    guard let cmd else { return false }
    return writes.contains(cmd.action)
  }

  /// The lower-case letters a word keeps: `t.toLowerCase().replace(/[^a-z]/g, '')`.
  static func letters(_ token: String) -> String {
    String(token.jsLowercased().unicodeScalars.filter { $0.value >= 0x61 && $0.value <= 0x7A }.map(Character.init))
  }

  /// Is this message a command, and if so what and against whom? Nil when
  /// it isn't one. `embedUri` is the post the message shared; `links` and
  /// `mentions` its facets' (`facetLinks`, `facetMentions`).
  public static func parseCommand(
    _ text: String?,
    embedUri: String? = nil,
    links: [String] = [],
    mentions: [String] = []
  ) -> ParsedCommand? {
    let raw = (text ?? "").jsTrimmed()
    if raw.isEmpty { return nil }
    guard let (regex, verb) = verbs.first(where: { $0.0.test(raw) }), let matched = regex.firstMatch(in: raw) else {
      return nil
    }
    let rest = raw.jsSlice(matched.range.upperBound).jsTrimmed()

    switch verb {
    case .plan, .scan:
      // A plan names a POST, from the owner's own message: a link they
      // pasted or the post they shared. Never from anything read.
      let kind = verb == .plan ? (matched.groups[0] ?? "").jsLowercased() : "everyone"
      let target = postTargetIn(raw, embedUri: embedUri, links: links)
      return ParsedCommand(action: .plan, kind: kind, target: target, needsTarget: target == nil, raw: raw)

    case .help:
      return ParsedCommand(action: .help, needsTarget: false, raw: raw)
    case .lists:
      return ParsedCommand(action: .lists, needsTarget: false, raw: raw)
    case .status:
      return ParsedCommand(action: .status, needsTarget: false, raw: raw)

    case .newList:
      let name = newListName.removingFirstMatch(in: rest).jsTrimmed().jsSlice(0, 64)
      return ParsedCommand(action: .newList, name: name, needsTarget: name.isEmpty, raw: raw)

    case .link:
      let first = rest.jsSplitWhitespace().first { !$0.isEmpty }
      let code = matchLinkCode(bare(first ?? ""))
      return ParsedCommand(action: .link, code: code, needsTarget: code == nil, raw: raw)

    case .history:
      // History names an account or nothing. A name it can't read is asked
      // back: the whole record under that name would read as theirs.
      let tokens = rest.jsSplitWhitespace().filter { !bare($0).isEmpty }
      if tokens.isEmpty { return ParsedCommand(action: .history, actor: nil, needsTarget: false, raw: raw) }
      let actor = (tokens.count == 1 ? typedActor(tokens[0]) : nil) ?? oneFromFacets(links, mentions)
      let refusal =
        isFalsy(actor)
        ? "I couldn’t read “\(rest.jsSlice(0, 40))” as an account. Send “history” with a full handle, a DID or a profile link, or “history” alone for everything."
        : nil
      return ParsedCommand(action: .history, actor: actor, refusal: refusal, needsTarget: isFalsy(actor), raw: raw)

    case .undo:
      // A bare undo means the newest approval or add. It is the one verb that
      // may default, because it only ever takes people off. A token meant as
      // a code is never defaulted: a typo would undo a batch nobody named.
      let token = bare(rest.jsSplitWhitespace().first { !$0.isEmpty }).jsLowercased()
      let code = isPlanCode(token) ? token : nil
      let last = code == nil && (token.isEmpty || undoLast.jsContains(token))
      return ParsedCommand(action: .undo, code: code, last: last, needsTarget: !last && code == nil, raw: raw)

    case .approve, .cancel, .review:
      var words = rest.jsSplitWhitespace(alsoComma: true)
        .map { (typed: $0, token: bare($0)) }
        .filter { !$0.token.isEmpty }
      let code = (words.isEmpty ? "" : words.removeFirst().token).jsLowercased()
      let valid = isPlanCode(code)
      let tokens = words.map(\.token)
      let bands = tokens.map { $0.jsUppercased() }.filter { bandNames.jsContains($0) }.jsUnique()
      let actors = words.compactMap { typedActor($0.typed) }
      let kinds = tokens.map { $0.jsLowercased() }
        .filter { !$0.jsEquals("everyone") && kindNames.jsContains($0) }
        .jsUnique()
      let action: ParsedCommand.Action = verb == .approve ? .approve : verb == .cancel ? .cancel : .review
      let refusal =
        verb == .approve && valid
        ? approvalRefusal(code, words: words, bands: bands, actors: actors, kinds: kinds) : nil
      return ParsedCommand(
        action: action,
        code: valid ? code : nil,
        // PROTECTED is never carried, whatever is typed.
        bands: bands.compactMap(Band.named).filter { $0 != .protected },
        kinds: kinds,
        actors: actors,
        refusal: refusal,
        needsTarget: !valid || refusal != nil,
        raw: raw)

    case .keep, .unkeep:
      // keep @x [why]: the account, then the owner's words for why.
      let tokens = rest.jsSplitWhitespace().filter { !$0.isEmpty }
      let typed = tokens.isEmpty ? nil : typedActor(tokens[0])
      let actor = typed ?? oneFromFacets(links, mentions)
      // The first word names the account (typed, or a link a client
      // shortened); whatever follows is why.
      let named = !isFalsy(typed) || (!tokens.isEmpty && (isTruncated(tokens[0]) || tokens[0].jsStartsWith("@")))
      let why = keepBecause.removingFirstMatch(in: tokens.jsSlice(named ? 1 : 0).joined(separator: " ")).jsTrimmed()
      let reason = verb == .keep && !why.isEmpty ? why.jsSlice(0, 200) : nil
      return ParsedCommand(
        action: verb == .keep ? .keep : .unkeep, actor: actor, reason: reason, needsTarget: isFalsy(actor), raw: raw)

    case .listAdd, .listRemove:
      // Exactly one account after the verb. Two is ambiguous, and the safe
      // reading of an ambiguous block is to refuse it.
      let tokens = rest.jsSplitWhitespace().filter { !$0.isEmpty }
      var actor = tokens.count == 1 ? typedActor(tokens[0]) : nil
      if isFalsy(actor) { actor = oneFromFacets(links, mentions) }
      // A shared post names its author, in the owner's own message. "block"
      // or "block this guy" acts on them; any other words come back asking.
      var fromPost = false
      var confirm = false
      if isFalsy(actor), let embedUri, !embedUri.isEmpty, let did = authorOf(embedUri) {
        actor = did
        fromPost = true
        confirm = tokens.map(letters).contains { !$0.isEmpty && !pointer.jsContains($0) }
      }
      return ParsedCommand(
        action: verb == .listAdd ? .listAdd : .listRemove, actor: actor, fromPost: fromPost, confirm: confirm,
        needsTarget: isFalsy(actor), raw: raw)
    }
  }

  /// JavaScript's falsy for a string that may be absent.
  static func isFalsy(_ value: String?) -> Bool {
    value?.isEmpty ?? true
  }

  /// Why an approval can't be read one way, said back, or nil. An approval
  /// names accounts or a group (bands and engagement kinds); a word with no
  /// place may be an exception ("UNKNOWN except @friend"), and dropping it
  /// would add the opposite of what was asked, so it is refused whole.
  static func approvalRefusal(
    _ code: String,
    words: [(typed: String, token: String)],
    bands: [String],
    actors: [String],
    kinds: [String]
  ) -> String? {
    if !bands.isEmpty && bands.allSatisfy({ $0.jsEquals("PROTECTED") }) {
      return "Protected accounts are never added, so I haven’t added anyone. Name another band, like “approve \(code) UNKNOWN”, or name the accounts."
    }
    let unplaced = words.first { word in
      let lower = word.token.jsLowercased()
      let placed =
        bandNames.jsContains(word.token.jsUppercased()) || kindNames.jsContains(lower)
        || !isFalsy(typedActor(word.typed)) || approveFiller.jsContains(lower)
      return !placed
    }
    if let unplaced {
      return "I couldn’t place “\(unplaced.token.jsSlice(0, 40))” in that approval, so I haven’t added anyone. An approval names bands (“approve \(code) UNKNOWN NOTABLE”), engagement (“approve \(code) UNKNOWN repliers”) or accounts (“approve \(code) @a.example.com”)."
    }
    if !actors.isEmpty && (!bands.isEmpty || !kinds.isEmpty) {
      return "That names accounts and a group at once, so I haven’t added anyone. Approve the accounts (“approve \(code) @a.example.com”) or the group (“approve \(code) UNKNOWN”), one at a time."
    }
    if actors.isEmpty && bands.isEmpty && kinds.isEmpty {
      return "Which of them? Name a band, like “approve \(code) UNKNOWN”. Protected accounts are never added."
    }
    return nil
  }

  /// A post's at:// URI, or a /post/ link (always a post).
  static func isPostTarget(_ t: String) -> Bool {
    !t.jsStartsWith("at://") || isAtPost(t)
  }

  /// The post a message names: the first in its text, a facet link, or the
  /// shared post. Never a list or a feed.
  static func postTargetIn(_ raw: String, embedUri: String?, links: [String]) -> String? {
    if let found = extractTargets(raw).first(where: isPostTarget) { return found }
    if let link = links.first(where: { extractTargets($0).contains(where: isPostTarget) }) { return link }
    if let embedUri, !embedUri.isEmpty, isPostTarget(embedUri) { return embedUri }
    return nil
  }

  /// A message that is only a post (pasted, shared, or with a word or two
  /// such as "this one"), read as "scan it": the post, or nil. Anything
  /// carrying its own words is a question, and not a scan.
  public static func parsePostScan(_ text: String?, embedUri: String? = nil, links: [String] = []) -> String? {
    let raw = (text ?? "").jsTrimmed()
    guard let target = postTargetIn(raw, embedUri: embedUri, links: links) else { return nil }
    let leftovers = raw.jsSplitWhitespace()
      .filter { !$0.isEmpty && extractTargets($0).isEmpty && !isTruncated($0) }
      .map(letters)
      .filter { !$0.isEmpty && !scanFiller.jsContains($0) }
    return leftovers.isEmpty ? target : nil
  }

  /// HELP: the commands the moderator answers, as its help says them.
  public static let help = [
    "Send a post (or “scan” and its link) to see who engaged with it, sorted by how close each is to you.",
    "“approve <code> UNKNOWN” adds the strangers from that scan to your list. Add NOTABLE, PERIPHERAL or CONNECTED to take more; protected accounts are never added.",
    "“add repliers <post>” scans only who replied (or likers, reposters, quoters, everyone).",
    "“review <code>” names the people near you in a scan. “cancel <code>” drops it.",
    "“block @handle” and “unblock @handle” add or remove one account. “keep @handle” keeps someone off every list.",
    "“undo” takes back the last thing added; “undo <code>” a whole approval. “history @handle” says why someone is on a list.",
    "“lists” names your lists; “status” says what is being written.",
  ].joined(separator: "\n")
}
