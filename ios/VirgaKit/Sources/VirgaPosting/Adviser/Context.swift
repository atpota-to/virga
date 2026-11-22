// Ports src/posting/adviser/context.js
//
// What one adviser read is about: which account is writing, what kind of
// draft it is, whether the pre-publish check covers it, and the conversation
// it answers, read from the public AppView.
//
// Everything is keyed to the posting account (`state.asDid`), not to the
// account Virga is showing: "a reply to someone else" means someone other
// than the account the post goes out as, and that account's setup,
// requester and allowance are the ones used.
//
// The state is read as loosely as the web reads it (JSONValue; a
// ComposerState's `.json`). Where the web would throw on a malformed state
// (`posts` that isn't a list, mapped), the port reads it as empty.

import Foundation
import VirgaCore
import VirgaNetwork

/// A row of the busy state's list: `{ key, label, detail }`.
public struct AdviserGoalItem: Codable, Hashable, Sendable {
  public var key: String
  public var label: String
  public var detail: String?

  public var json: JSONValue {
    ["key": .string(key), "label": .string(label), "detail": detail.map(JSONValue.string) ?? .null]
  }
}

/// The draft as the adviser frames it.
public struct AdviserDraftFacts: Codable, Hashable, Sendable {
  public var repliesToOther: Bool
  public var quotesOther: Bool
  public var repliesToSelf: Bool
  public var isThread: Bool

  public var json: JSONValue { (try? JSONValue(encoding: self)) ?? [:] }
}

/// The draft as read: one string per post, and the whole as one text.
public struct AdviserSource: Codable, Hashable, Sendable {
  public var posts: [String]
  public var text: String
}

/// Everything one read needs to decide and to send.
public struct AdviserReadPlan: Hashable, Sendable {
  /// The adviser can be asked at all: it's on, and the account can use AI.
  public var available: Bool
  /// The pre-publish check should run for this draft.
  public var gate: Bool
  /// 'significant' | 'always'.
  public var reviewMode: String
  public var hasSomething: Bool
  public var scenario: String
  public var goals: AdviserGoals
  public var goalItems: [AdviserGoalItem]
  /// enabledWritingChecks' object, or nil when none are on.
  public var writingChecks: JSONValue?
  /// Which conversation to read ('reply' | 'quote' | 'selfReply'), or nil.
  public var context: String?
  /// The busy state's rows: each goal, reading the room, the proofread.
  public var expectedChecks: Int
  public var source: AdviserSource
  public var facts: AdviserDraftFacts

  public var json: JSONValue {
    [
      "available": .bool(available), "gate": .bool(gate), "reviewMode": .string(reviewMode),
      "hasSomething": .bool(hasSomething), "scenario": .string(scenario),
      "goals": (try? JSONValue(encoding: goals)) ?? .null, "goalItems": .array(goalItems.map(\.json)),
      "writingChecks": writingChecks ?? .null, "context": context.map(JSONValue.string) ?? .null,
      "expectedChecks": .number(Double(expectedChecks)), "source": (try? JSONValue(encoding: source)) ?? .null,
      "facts": facts.json,
    ]
  }
}

/// A post of the conversation: `{ author, text }`.
public struct AdviserContextLine: Codable, Hashable, Sendable {
  public var author: String
  public var text: String

  public var json: JSONValue { ["author": .string(author), "text": .string(text)] }
}

/// The conversation a draft answers: `{ kind, thread, target }`.
public struct AdviserReplyContext: Codable, Hashable, Sendable {
  public var kind: String
  public var thread: [AdviserContextLine]
  public var target: AdviserContextLine?

  public var json: JSONValue {
    ["kind": .string(kind), "thread": .array(thread.map(\.json)), "target": target?.json ?? .null]
  }
}

public enum AdviserContext {
  /// A fast answer is held until this long after the read started, so the
  /// busy state doesn't flash.
  public static let readMinMs: Double = 1200

  /// Past this the busy state says the read is slower than usual.
  public static let slowReadAfterMs: Double = 8000

  /// How many posts above the one replied to are read for context.
  public static let contextParentHeight = 6

  static func orEmpty(_ value: JSONValue?) -> JSONValue { ComposerJS.or(value, [:]) ?? [:] }

  /// The goals and checks a read covers, for the busy state's list. Empty
  /// when nothing is set up (the pre-publish check then doesn't run).
  public static func adviserGoalItems(_ adviser: JSONValue?) -> [AdviserGoalItem] {
    let a = orEmpty(adviser)
    let goals = orEmpty(a["goals"])
    let presets = orEmpty(goals["presets"])
    var items: [AdviserGoalItem] = []
    if ComposerJS.truthy(presets["reduceNegativity"]) {
      items.append(AdviserGoalItem(key: "reduceNegativity", label: "Reduce negativity", detail: nil))
    }
    if ComposerJS.truthy(presets["lessConfrontational"]) {
      items.append(AdviserGoalItem(key: "lessConfrontational", label: "Less confrontational", detail: nil))
    }
    let limitTopic = orEmpty(presets["limitTopic"])
    if ComposerJS.truthy(limitTopic["enabled"]), let topic = limitTopic["topic"]?.stringValue,
      !topic.jsTrimmed().isEmpty
    {
      items.append(AdviserGoalItem(key: "limitTopic", label: "Limit topics", detail: topic.jsTrimmed()))
    }
    if let custom = goals["customText"]?.stringValue, !custom.jsTrimmed().isEmpty {
      items.append(AdviserGoalItem(key: "customText", label: "Your own goals", detail: nil))
    }
    let writing = orEmpty(a["writingChecks"])
    let checks = ["typos", "grammar", "clarity"].filter { writing[$0] == .bool(true) }
    if !checks.isEmpty {
      items.append(AdviserGoalItem(key: "writing", label: "Writing check", detail: checks.joined(separator: ", ")))
    }
    return items
  }

  public static func adviserGoalItems(_ adviser: AdviserSettings) -> [AdviserGoalItem] {
    adviserGoalItems(adviser.json)
  }

  /// How many goals the setup has (writing checks aside).
  public static func adviserGoalCount(_ adviser: JSONValue?) -> Int {
    adviserGoalItems(adviser).filter { $0.key != "writing" }.count
  }

  /// The busy state's line under the goals.
  public static func readExpectation(_ elapsedMs: JSONValue?) -> String {
    elapsedMs.jsNumber >= slowReadAfterMs
      ? "Taking a little longer than usual" : "Usually a few seconds"
  }

  public static func readExpectation(_ elapsedMs: Double) -> String {
    readExpectation(.number(elapsedMs))
  }

  /// `parseRecordUri(uri)?.did || null`.
  static func didOf(_ uri: JSONValue?) -> JSONValue? {
    PostLink.parseRecordUri(uri?.stringValue).map { .string($0.did) }
  }

  /// The post the first post quotes, when it quotes a post.
  static func quotedPost(_ state: JSONValue?) -> JSONValue? {
    guard let record = state?["posts"]?[0]?["record"], ComposerJS.truthy(record["uri"]) else { return nil }
    return ComposerJS.strictEquals(ComposerJS.or(record["kind"], "post"), "post") ? record : nil
  }

  /// The draft as the adviser frames it, for the posting account `asDid`
  /// (nil: the state's own `asDid`, as the web's default).
  public static func adviserDraftFacts(_ state: JSONValue?, asDid: JSONValue? = nil) -> AdviserDraftFacts {
    let asDid = asDid ?? state?["asDid"]
    let reply = state?["reply"]
    let replyAuthor: JSONValue? =
      ComposerJS.truthy(reply) ? (reply?["author"]?["did"].truthy ?? didOf(reply?["uri"])) : nil
    let quote = quotedPost(state)
    let quoteAuthor: JSONValue? = quote.flatMap { $0["view"]?["author"]?["did"].truthy ?? didOf($0["uri"]) }
    let hasReplyAuthor = ComposerJS.truthy(replyAuthor)
    let length = AdviserSheetView.lengthOf(state?["posts"])
    return AdviserDraftFacts(
      repliesToOther: hasReplyAuthor && !ComposerJS.strictEquals(replyAuthor, asDid),
      quotesOther: ComposerJS.truthy(quoteAuthor) && !ComposerJS.strictEquals(quoteAuthor, asDid),
      repliesToSelf: hasReplyAuthor && ComposerJS.strictEquals(replyAuthor, asDid),
      isThread: ComposerJS.greater(ComposerJS.or(length, 0), 1))
  }

  public static func adviserDraftFacts(_ state: ComposerState, asDid: String? = nil) -> AdviserDraftFacts {
    adviserDraftFacts(state.json, asDid: asDid.map(JSONValue.string))
  }

  /// The draft as read: one string per post, and the whole as one text
  /// (posts joined by blank lines, trimmed).
  public static func adviserSource(_ state: JSONValue?) -> AdviserSource {
    let posts = (state?["posts"]?.arrayValue ?? []).map { $0["text"]?.stringValue ?? "" }
    return AdviserSource(posts: posts, text: posts.joined(separator: "\n\n").jsTrimmed())
  }

  /// Everything one read needs to decide and to send, for the account's
  /// adviser setup (normalized here) and a composer state. `asDid` nil is
  /// the state's own.
  ///
  ///   available   the adviser is on and the account can use AI
  ///   gate        the pre-publish check should run for this draft:
  ///               available, "check before publishing" on, the scope
  ///               covers it, there is something to check, there is text,
  ///               and this month's checks aren't known to be used up
  ///   context     which conversation to read, or nil
  public static func adviserReadPlan(
    _ adviser: JSONValue?, _ state: JSONValue?, canUseAi: Bool = false, atLimit: Bool = false,
    asDid: JSONValue? = nil
  ) -> AdviserReadPlan {
    let setup = AdviserSetup.normalizeAdviserSettings(adviser)
    let facts = adviserDraftFacts(state, asDid: asDid)
    let writingChecks = AdviserAnalysis.enabledWritingChecks(try? JSONValue(encoding: setup.writingChecks))
    let goalItems = adviserGoalItems(setup)
    let goalCount = goalItems.filter { $0.key != "writing" }.count
    let readTheRoom = setup.checkReplyContext
    let otherContext = readTheRoom && (facts.repliesToOther || facts.quotesOther)
    let context: String? =
      !readTheRoom
      ? nil
      : facts.repliesToOther ? "reply" : facts.quotesOther ? "quote" : facts.repliesToSelf ? "selfReply" : nil
    let hasSomething = goalCount > 0 || otherContext || writingChecks != nil
    let source = adviserSource(state)
    let available = setup.enabled && canUseAi
    return AdviserReadPlan(
      available: available,
      gate: available && setup.checkBeforePublish
        && AdviserAnalysis.adviserScopeAllowsDraft(.string(setup.checkScope), repliesToOther: facts.repliesToOther)
        && hasSomething && !source.text.isEmpty && !atLimit,
      reviewMode: setup.reviewMode,
      hasSomething: hasSomething,
      scenario: AdviserAnalysis.adviserScenarioFor(
        repliesToOther: facts.repliesToOther, quotesOther: facts.quotesOther, repliesToSelf: facts.repliesToSelf,
        isThread: facts.isThread),
      goals: setup.goals,
      goalItems: goalItems,
      writingChecks: writingChecks,
      context: context,
      expectedChecks: goalCount + (otherContext ? 1 : 0) + (writingChecks != nil ? 1 : 0),
      source: source,
      facts: facts)
  }

  public static func adviserReadPlan(
    _ adviser: AdviserSettings?, _ state: ComposerState, canUseAi: Bool = false, atLimit: Bool = false,
    asDid: String? = nil
  ) -> AdviserReadPlan {
    adviserReadPlan(
      adviser?.json, state.json, canUseAi: canUseAi, atLimit: atLimit, asDid: asDid.map(JSONValue.string))
  }

  /// One post as a line of the conversation, or nil for one with no text.
  static func lineFrom(_ post: JSONValue?) -> AdviserContextLine? {
    let text =
      post?["record"]?["text"]?.stringValue ?? post?["value"]?["text"]?.stringValue ?? post?["text"]?.stringValue ?? ""
    let trimmed = text.jsTrimmed()
    if trimmed.isEmpty { return nil }
    let a = orEmpty(post?["author"])
    let name = a["displayName"]?.stringValue?.jsTrimmed() ?? ""
    let author =
      !name.isEmpty ? name : ComposerJS.truthy(a["handle"]) ? "@\(a["handle"]!.jsString)" : "someone"
    return AdviserContextLine(author: author, text: trimmed)
  }

  /// The conversation a draft answers, for "read the room": the post
  /// replied to or quoted and up to six posts above it, oldest first, from
  /// the public AppView. Bounded by `timeoutMs` (the wait goes through
  /// `sleep`, setTimeout's stand-in); on a failure, a timeout or the
  /// signal's abort, the post alone stands in for the thread. Nil when the
  /// plan reads none (`kind` nil or empty) or there's no post to read.
  public static func gatherReplyContext(
    _ state: JSONValue?, _ kind: String?, signal: AdviserAbortSignal? = nil,
    timeoutMs: Double = AdviserGate.adviserContextTimeoutMs,
    sleep: @escaping @Sendable (Double) async -> Void = AdviserGate.taskSleep,
    appview: String = AppConfig.appview, transport: any HTTPTransport = HTTP.transport
  ) async -> AdviserReplyContext? {
    guard let kind, !kind.isEmpty else { return nil }
    var uri: JSONValue?
    var target: AdviserContextLine?
    if kind == "quote" {
      let quote = quotedPost(state)
      uri = quote?["uri"].truthy
      target = ComposerJS.truthy(quote?["view"]) ? lineFrom(quote?["view"]) : nil
    } else {
      let reply = state?["reply"]
      uri = reply?["uri"].truthy
      if ComposerJS.truthy(reply) {
        var post: [String: JSONValue] = [:]
        if let author = reply?["author"] { post["author"] = author }
        if let text = reply?["text"] { post["text"] = text }
        target = lineFrom(.object(post))
      }
    }
    guard let uri else { return nil }

    var thread: [AdviserContextLine] = []
    let params = QueryParams([("uri", uri), ("depth", 0), ("parentHeight", .number(Double(contextParentHeight)))])
    do {
      let body = try await AdviserGate.withinMs(timeoutMs, sleep: sleep) {
        try await signal.run {
          try await PublicAppView.publicXrpc("app.bsky.feed.getPostThread", params, appview: appview, transport: transport)
        }
      }
      var collected: [AdviserContextLine] = []
      var node = body["thread"]
      while let current = node, current.isTruthy, ComposerJS.truthy(current["post"]) {
        if let line = lineFrom(current["post"]) { collected.append(line) }
        node = current["parent"]
      }
      thread = collected.reversed()
      // The thread read also has the target's own text when the composer
      // didn't (a reply opened from a bare link).
      if target == nil, let last = thread.last { target = last }
    } catch {
      // The post alone, below.
    }
    if thread.isEmpty, let target { thread = [target] }
    return AdviserReplyContext(kind: kind, thread: thread, target: target)
  }

  public static func gatherReplyContext(
    _ state: ComposerState, _ kind: String?, signal: AdviserAbortSignal? = nil,
    timeoutMs: Double = AdviserGate.adviserContextTimeoutMs,
    sleep: @escaping @Sendable (Double) async -> Void = AdviserGate.taskSleep,
    appview: String = AppConfig.appview, transport: any HTTPTransport = HTTP.transport
  ) async -> AdviserReplyContext? {
    await gatherReplyContext(
      state.json, kind, signal: signal, timeoutMs: timeoutMs, sleep: sleep, appview: appview, transport: transport)
  }

  /// The analyze-post body for a plan and the context gathered for it. The
  /// text is trimmed: the server checks each excerpt it returns against
  /// exactly what it was sent.
  public static func analyzePayload(_ plan: AdviserReadPlan?, _ context: AdviserReplyContext? = nil) -> JSONValue {
    var body: JSONValue = ["text": .string(plan?.source.text ?? "")]
    if let plan {
      body["goals"] = (try? JSONValue(encoding: plan.goals)) ?? .null
      body["scenario"] = .string(plan.scenario)
    }
    if let context { body["context"] = context.json }
    if let writing = plan?.writingChecks, writing.isTruthy { body["writingChecks"] = writing }
    return body
  }

  /// Whether the pre-publish check stops the publish to show what it found.
  /// 'always' shows every read; 'significant' only a conflict with a goal or
  /// any writing issue (a caution lets the post through).
  public static func adviserShouldInterrupt(_ result: JSONValue?, _ reviewMode: String? = "significant") -> Bool {
    guard let result, result.isTruthy else { return false }
    if reviewMode == "always" { return true }
    let issues = result["writing"]?["issues"]?.arrayValue ?? []
    return result["overallStatus"]?.stringValue == "conflict" || !issues.isEmpty
  }
}
