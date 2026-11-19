// Ports src/posting/lib/gates.js
//
// Who can reply and who can quote. The composer holds them as
//   { reply: null | [] | ReplyRule[], quotes: boolean }
// where `reply: null` is everyone (no threadgate record), `[]` is nobody (a
// threadgate with an empty allow list: a real record, never skipped), and a
// list is "these people"; `quotes: false` is a postgate with the disable rule.
// ReplyRule = { type: 'mention' } | { type: 'follower' } | { type: 'following' }
//           | { type: 'list', list: <at-uri> }
//
// The pure conversions work on JSONValue, as loosely as the web reads its
// input, with typed wrappers (`PostGates`, `ReplyRule`) for the composer. The
// reads and writes of a published post's gates go through `GatesAgent`, the
// slice of the write account's agent they use; VirgaNetwork's XRPC client
// conforms to it in wave 2.

import Foundation
import VirgaCore
import VirgaRepo

/// One "who can reply" rule.
public enum ReplyRule: Hashable, Sendable {
  case mention
  case follower
  case following
  case list(String)

  public var type: String {
    switch self {
    case .mention: return "mention"
    case .follower: return "follower"
    case .following: return "following"
    case .list: return "list"
    }
  }

  public var json: JSONValue {
    if case .list(let uri) = self { return ["type": "list", "list": .string(uri)] }
    return ["type": .string(type)]
  }

  /// A rule from its web shape, or nil for one this app doesn't know.
  public init?(json: JSONValue) {
    switch json["type"]?.stringValue {
    case "mention": self = .mention
    case "follower": self = .follower
    case "following": self = .following
    case "list":
      guard let list = json["list"]?.stringValue else { return nil }
      self = .list(list)
    default: return nil
    }
  }
}

extension ReplyRule: Codable {
  public init(from decoder: Decoder) throws {
    let json = try JSONValue(from: decoder)
    guard let rule = ReplyRule(json: json) else {
      throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown reply rule"))
    }
    self = rule
  }

  public func encode(to encoder: Encoder) throws {
    try json.encode(to: encoder)
  }
}

/// Who can reply (`nil` everyone, `[]` nobody) and whether quotes are allowed.
public struct PostGates: Hashable, Sendable {
  public var reply: [ReplyRule]?
  public var quotes: Bool

  public init(reply: [ReplyRule]? = nil, quotes: Bool = true) {
    self.reply = reply
    self.quotes = quotes
  }

  public var json: JSONValue {
    ["reply": reply.map { .array($0.map(\.json)) } ?? .null, "quotes": .bool(quotes)]
  }

  /// Gates from their web shape (rules this app doesn't know are dropped).
  public init(json: JSONValue) {
    reply = json["reply"]?.arrayValue.map { $0.compactMap(ReplyRule.init(json:)) }
    quotes = json["quotes"]?.boolValue ?? true
  }
}

extension PostGates: Codable {
  public init(from decoder: Decoder) throws {
    self.init(json: try JSONValue(from: decoder))
  }

  /// `reply` is written as null for everyone, as the web stores it.
  public func encode(to encoder: Encoder) throws {
    try json.encode(to: encoder)
  }
}

/// Gates as lexicon rules: `threadgateAllow` is nil (no threadgate), `[]`
/// (nobody) or the allow rules; `postgateEmbeddingRules` is nil (no
/// postgate) or `[disableRule]`.
public struct GateRules: Hashable, Sendable {
  public var threadgateAllow: [JSONValue]?
  public var postgateEmbeddingRules: [JSONValue]?

  public var json: JSONValue {
    [
      "threadgateAllow": threadgateAllow.map(JSONValue.array) ?? .null,
      "postgateEmbeddingRules": postgateEmbeddingRules.map(JSONValue.array) ?? .null,
    ]
  }
}

/// The slice of the write account's agent the gates read and write with.
/// Each returns the XRPC output body (the web's `res.data`).
public protocol GatesAgent: Sendable {
  /// `app.bsky.actor.getPreferences({})`.
  func getPreferences() async throws -> JSONValue
  /// `com.atproto.repo.getRecord({ repo, collection, rkey })`.
  func getRecord(repo: String, collection: String, rkey: String) async throws -> JSONValue
  /// `com.atproto.repo.putRecord({ repo, collection, rkey, record })`.
  func putRecord(repo: String, collection: String, rkey: String, record: JSONValue) async throws
  /// `com.atproto.repo.deleteRecord({ repo, collection, rkey })`.
  func deleteRecord(repo: String, collection: String, rkey: String) async throws
}

/// What an agent's error says, as the web reads `err.error` and `err.message`.
public protocol XRPCErrorDescribing {
  /// The XRPC error name (`RecordNotFound`), if any.
  var xrpcError: String? { get }
}

public struct GatesError: Error, LocalizedError, Hashable, Sendable {
  public let message: String
  public var errorDescription: String? { message }
}

public enum Gates {
  static let threadgate = "app.bsky.feed.threadgate"
  static let postgate = "app.bsky.feed.postgate"
  static let disableRule = "\(postgate)#disableRule"

  static let ruleTypes: [String: String] = [
    "mention": "\(threadgate)#mentionRule",
    "follower": "\(threadgate)#followerRule",
    "following": "\(threadgate)#followingRule",
    "list": "\(threadgate)#listRule",
  ]
  static let typeByLexicon = Dictionary(uniqueKeysWithValues: ruleTypes.map { ($1, $0) })

  /// A threadgate holds at most five allow rules.
  public static let maxReplyRules = 5

  /// Bluesky's default: anyone can reply and quote.
  public static let everyoneGates = PostGates(reply: nil, quotes: true)

  /// How long reading an account's default gates may take before giving up.
  public static let defaultGatesTimeoutMs: Double = 7000

  static func replyRulesToLexicon(_ reply: [JSONValue]) -> [JSONValue] {
    var out: [JSONValue] = []
    var seen = Set<String>()
    for rule in reply {
      guard let type = rule["type"]?.stringValue, let lexicon = ruleTypes[type] else { continue }
      if type == "list" {
        guard let list = rule["list"]?.stringValue, PostingJS.hasPrefix(list, "at://") else { continue }
        let key = "list:\(list)"
        if seen.contains(key) { continue }
        seen.insert(key)
        out.append(["$type": .string(lexicon), "list": .string(list)])
      } else {
        if seen.contains(type) { continue }
        seen.insert(type)
        out.append(["$type": .string(lexicon)])
      }
    }
    return out
  }

  /// Gates as lexicon rules, from the web's shape.
  public static func gatesToRules(_ gates: JSONValue?) -> GateRules {
    let reply = gates?["reply"]
    return GateRules(
      threadgateAllow: reply?.arrayValue.map(replyRulesToLexicon),
      postgateEmbeddingRules: gates?["quotes"] == .bool(false) ? [["$type": .string(disableRule)]] : nil)
  }

  public static func gatesToRules(_ gates: PostGates?) -> GateRules {
    gatesToRules(gates?.json)
  }

  /// `a ?? b`: the first that is neither missing nor null.
  static func coalesce(_ values: JSONValue?...) -> JSONValue? {
    values.first { $0 != nil && $0 != .null } ?? nil
  }

  /// The inverse: lexicon rules back to gates. Takes the names a draft, a
  /// threadgate/postgate pair or Bluesky's `postInteractionSettingsPref` uses
  /// (`threadgateAllow`, `threadgateAllowRules` or `allow`;
  /// `postgateEmbeddingRules` or `embeddingRules`). An absent allow list is
  /// everyone. A list made only of unknown rules reads as nobody.
  public static func gatesFromRules(_ rules: JSONValue?) -> PostGates {
    let src: JSONValue = rules?.objectValue != nil || rules?.arrayValue != nil ? rules! : [:]
    let allow = coalesce(src["threadgateAllow"], src["threadgateAllowRules"], src["allow"])
    let embedding = coalesce(src["postgateEmbeddingRules"], src["embeddingRules"])

    var reply: [ReplyRule]?
    if let allow = allow?.arrayValue {
      var rules: [ReplyRule] = []
      for rule in allow {
        guard let lexicon = rule["$type"]?.stringValue, let type = typeByLexicon[lexicon] else { continue }
        if type == "list" {
          if let list = rule["list"]?.stringValue { rules.append(.list(list)) }
        } else if !rules.contains(where: { $0.type == type }) {
          rules.append(ReplyRule(json: ["type": .string(type)])!)
        }
      }
      reply = rules
    }
    let quotes = !(embedding?.arrayValue?.contains { $0["$type"]?.stringValue == disableRule } ?? false)
    return PostGates(reply: reply, quotes: quotes)
  }

  public static func gatesFromRules(_ rules: GateRules) -> PostGates {
    gatesFromRules(rules.json)
  }

  /// Whether two gates say the same thing (rule order aside).
  public static func gatesEqual(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    func key(_ gates: JSONValue?) -> ([[UInt16]]?, Bool) {
      let rules = gatesToRules(gates)
      let allow = rules.threadgateAllow.map { list in
        list.map { rule -> [UInt16] in
          let list = rule["list"]?.stringValue ?? ""
          return Array("\(rule["$type"]?.stringValue ?? "")|\(list)".utf16)
        }
        .sorted { $0.lexicographicallyPrecedes($1) }
      }
      return (allow, rules.postgateEmbeddingRules == nil)
    }
    let (allowA, openA) = key(a)
    let (allowB, openB) = key(b)
    return allowA == allowB && openA == openB
  }

  public static func gatesEqual(_ a: PostGates?, _ b: PostGates?) -> Bool {
    gatesEqual(a?.json, b?.json)
  }

  /// The gates an account set as its Bluesky default, from its preferences
  /// (`app.bsky.actor.defs#postInteractionSettingsPref`); everyone when it
  /// set none.
  public static func defaultGatesFromPreferences(_ preferences: JSONValue?) -> PostGates {
    guard let list = preferences?.arrayValue,
      let pref = list.first(where: { $0["$type"]?.stringValue == "app.bsky.actor.defs#postInteractionSettingsPref" }),
      let fields = pref.objectValue
    else { return everyoneGates }
    // A key that is absent means Bluesky's default; present but empty means none.
    var rules: [String: JSONValue] = [:]
    if let value = fields["threadgateAllowRules"] { rules["threadgateAllowRules"] = value.isTruthy ? value : [] }
    if let value = fields["postgateEmbeddingRules"] { rules["postgateEmbeddingRules"] = value.isTruthy ? value : [] }
    return gatesFromRules(.object(rules))
  }

  /// The write account's Bluesky default gates, read with its own agent, or
  /// nil when they couldn't be read in time. Never throws. As the web's
  /// `Promise.race`, the answer is nil at the deadline even when the read
  /// doesn't stop for cancellation.
  public static func readDefaultGates(_ agent: GatesAgent, timeoutMs: Double = defaultGatesTimeoutMs) async
    -> PostGates?
  {
    await PromiseRace.race(timeoutMs: timeoutMs, fallback: nil) {
      do {
        let data = try await agent.getPreferences()
        guard let preferences = data["preferences"], preferences.arrayValue != nil else { return nil }
        return defaultGatesFromPreferences(preferences)
      } catch {
        return nil
      }
    }
  }

  static let postUri = JSRegex(#"^at://(did:[^/]+)/app\.bsky\.feed\.post/([^/?#]+)\z"#)

  static func parsePostUri(_ uri: String?) throws -> (did: String, rkey: String) {
    let text = uri ?? ""
    let units = Array(text.utf16)
    guard let m = postUri.firstMatch(in: text), let did = m.group(1, in: units), let rkey = m.group(2, in: units)
    else { throw GatesError(message: "Not a post URI: \(uri ?? "undefined")") }
    return (did, rkey)
  }

  static let notFoundMessage = JSRegex(#"[rR][eE][cC][oO][rR][dD][nN][oO][tT][fF][oO][uU][nN][dD]|[cC][oO][uU][lL][dD] [nN][oO][tT] [lL][oO][cC][aA][tT][eE] [rR][eE][cC][oO][rR][dD]"#)

  static func isNotFound(_ error: Error) -> Bool {
    if (error as? XRPCErrorDescribing)?.xrpcError == "RecordNotFound" { return true }
    let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    return notFoundMessage.test(message)
  }

  static func readGate(_ agent: GatesAgent, _ repo: String, _ collection: String, _ rkey: String) async throws
    -> JSONValue?
  {
    do {
      let data = try await agent.getRecord(repo: repo, collection: collection, rkey: rkey)
      guard let value = data["value"], value.isTruthy else { return nil }
      return value
    } catch {
      if isNotFound(error) { return nil }
      // Never write a gate over one that couldn't be read: it would drop the
      // writer's hidden replies or detached quotes.
      throw error
    }
  }

  static func deleteGate(_ agent: GatesAgent, _ repo: String, _ collection: String, _ rkey: String) async throws {
    do {
      try await agent.deleteRecord(repo: repo, collection: collection, rkey: rkey)
    } catch {
      if !isNotFound(error) { throw error }
    }
  }

  /// Change who can reply to and quote a published post, keeping what the
  /// gates already hold besides the rules: the threadgate's `hiddenReplies`
  /// and the postgate's `detachedEmbeddingUris`. A gate that would say
  /// nothing but Bluesky's default is deleted, unless it still holds one of
  /// those lists.
  @discardableResult
  public static func updatePostGates(
    _ agent: GatesAgent,
    uri: String,
    reply: [ReplyRule]?,
    quotes: Bool,
    now: Date = Date()
  ) async throws -> PostGates {
    try await updatePostGates(agent, uri: uri, reply: reply.map { .array($0.map(\.json)) } ?? .null, quotes: quotes, now: now)
  }

  /// `updatePostGates` with the reply rules in their web shape.
  @discardableResult
  public static func updatePostGates(
    _ agent: GatesAgent,
    uri: String,
    reply: JSONValue?,
    quotes: Bool,
    now: Date = Date()
  ) async throws -> PostGates {
    let (repo, rkey) = try parsePostUri(uri)
    async let readThreadgate = readGate(agent, repo, threadgate, rkey)
    async let readPostgate = readGate(agent, repo, postgate, rkey)
    let existingThreadgate = try await readThreadgate
    let existingPostgate = try await readPostgate

    let nowMs = (now.timeIntervalSince1970 * 1000).rounded(.down)
    func createdAt(_ existing: JSONValue?) -> JSONValue {
      if let value = existing?["createdAt"], value.isTruthy { return value }
      return .string(VirgaRepo.JSDate.toISOString(nowMs) ?? "")
    }
    let hiddenReplies = existingThreadgate?["hiddenReplies"]?.arrayValue ?? []
    let detached = existingPostgate?["detachedEmbeddingUris"]?.arrayValue ?? []
    let rules = gatesToRules(["reply": reply ?? .null, "quotes": .bool(quotes)])

    if let allow = rules.threadgateAllow {
      try await agent.putRecord(
        repo: repo, collection: threadgate, rkey: rkey,
        record: [
          "$type": .string(threadgate), "post": .string(uri), "createdAt": createdAt(existingThreadgate),
          "allow": .array(allow), "hiddenReplies": .array(hiddenReplies),
        ])
    } else if !hiddenReplies.isEmpty {
      // No `allow` is everyone, per the lexicon.
      try await agent.putRecord(
        repo: repo, collection: threadgate, rkey: rkey,
        record: [
          "$type": .string(threadgate), "post": .string(uri), "createdAt": createdAt(existingThreadgate),
          "hiddenReplies": .array(hiddenReplies),
        ])
    } else if existingThreadgate != nil {
      try await deleteGate(agent, repo, threadgate, rkey)
    }

    if let embeddingRules = rules.postgateEmbeddingRules {
      try await agent.putRecord(
        repo: repo, collection: postgate, rkey: rkey,
        record: [
          "$type": .string(postgate), "post": .string(uri), "createdAt": createdAt(existingPostgate),
          "detachedEmbeddingUris": .array(detached), "embeddingRules": .array(embeddingRules),
        ])
    } else if !detached.isEmpty {
      try await agent.putRecord(
        repo: repo, collection: postgate, rkey: rkey,
        record: [
          "$type": .string(postgate), "post": .string(uri), "createdAt": createdAt(existingPostgate),
          "detachedEmbeddingUris": .array(detached), "embeddingRules": [],
        ])
    } else if existingPostgate != nil {
      try await deleteGate(agent, repo, postgate, rkey)
    }

    return gatesFromRules(rules)
  }
}
