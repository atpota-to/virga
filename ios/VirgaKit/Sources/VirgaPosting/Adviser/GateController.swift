// Ports src/posting/adviser/gateController.js
//
// The composer's side of the post adviser, without UI: one read at a time,
// the busy state while it runs, the sheet that shows what it found, and the
// writer's way past it. AdviserGateModel (useAdviserGate.js) is a thin model
// over this.
//
// `check(state, mode:)` starts at once and ends once, with what the composer
// should do:
//
//   publish  go ahead (the read found nothing worth stopping for, the writer
//            chose to publish, or the read failed, timed out or wasn't
//            needed: the pre-publish check always fails open)
//   edit     back to the composer
//   draft    save the post as a draft instead
//
// Mode 'gate' is the check before Post now. It honours the account's review
// mode, check scope and "check before posting" switch, gives up after the
// 10 s deadline, and lets the post through when there's nothing to read or
// the month's checks are known to be used up. Mode 'manual' is the
// composer's "Check this post" button: it ignores the scope and always shows
// the sheet, including when there's nothing to check, and asks even when
// this device thinks the month is used up (the server's monthly_limit
// refusal is then the limit sheet).
//
// No double billing: a 'publish' from the sheet means the read already
// happened, so the composer publishes without checking again.

import Foundation
import VirgaCore
import VirgaNetwork

/// What the composer should do after a check (ADVISER_DECISIONS).
public enum AdviserDecision: String, Codable, CaseIterable, Hashable, Sendable {
  case publish
  case edit
  case draft
}

/// The busy state while a read runs: `{ mode, goals, startedAt, choices }`.
public struct AdviserBusy: Hashable, Sendable {
  /// 'gate' | 'manual'.
  public var mode: String
  public var goals: [AdviserGoalItem]
  /// When the read started, in epoch milliseconds.
  public var startedAt: Double
  public var choices: [AdviserChoice]

  public var json: JSONValue {
    [
      "mode": .string(mode), "goals": .array(goals.map(\.json)), "startedAt": .number(startedAt),
      "choices": .array(choices.map { .string($0.rawValue) }),
    ]
  }
}

/// The sheet's read (sheetFor's object): what AdviserSheetView and the sheet
/// draw from. `json` is the web's object, for AdviserSheetView's functions.
public struct AdviserSheetRead: Hashable, Sendable {
  /// 'gate' | 'manual'.
  public var mode: String
  /// One of SHEET_STATUSES: 'ready' | 'error' | 'limit' | 'empty' | 'needsText'.
  public var status: String
  public var did: String?
  /// The analyze-post answer, for 'ready'.
  public var result: JSONValue?
  public var error: String?
  public var errorCode: JSONValue?
  public var scenario: String
  public var context: AdviserReplyContext?
  public var contextKind: String?
  public var readTheRoom: Bool
  public var facts: AdviserDraftFacts?
  public var goalItems: [AdviserGoalItem]
  /// The draft as read, one string per post (where the marks are placed).
  public var posts: [String]
  /// Every post's text now, fixes taken included.
  public var texts: [String]
  /// Keys of the fixes taken.
  public var taken: [String]
  public var fixesTaken: Bool
  public var canPublish: Bool
  public var canSaveDraft: Bool
  /// The composer state the read was of.
  public var state: JSONValue?
  public var usageLine: String

  public var json: JSONValue {
    [
      "mode": .string(mode), "status": .string(status), "did": did.map(JSONValue.string) ?? .null,
      "result": result ?? .null, "error": error.map(JSONValue.string) ?? .null, "errorCode": errorCode ?? .null,
      "scenario": .string(scenario), "context": context?.json ?? .null,
      "contextKind": contextKind.map(JSONValue.string) ?? .null, "readTheRoom": .bool(readTheRoom),
      "facts": facts?.json ?? .null, "goalItems": .array(goalItems.map(\.json)),
      "posts": .array(posts.map(JSONValue.string)), "texts": .array(texts.map(JSONValue.string)),
      "taken": .array(taken.map(JSONValue.string)), "fixesTaken": .bool(fixesTaken), "canPublish": .bool(canPublish),
      "canSaveDraft": .bool(canSaveDraft), "state": state ?? .null, "usageLine": .string(usageLine),
    ]
  }

  /// sheetView.js's model of this read (adviserSheetModel(result, posts)).
  public var model: AdviserSheetModel { AdviserSheet.adviserSheetModel(result, posts) }
}

/// `{ busy, sheet, usageVersion }`.
public struct AdviserView: Hashable, Sendable {
  public var busy: AdviserBusy?
  public var sheet: AdviserSheetRead?
  /// Moves on each request, so the usage line is read again.
  public var usageVersion = 0

  public init(busy: AdviserBusy? = nil, sheet: AdviserSheetRead? = nil, usageVersion: Int = 0) {
    self.busy = busy
    self.sheet = sheet
    self.usageVersion = usageVersion
  }
}

/// A promise and its resolve, on the main actor: the first value wins.
@MainActor
final class AdviserDeferred<Value: Sendable> {
  private var resolved = false
  private var value: Value?
  private var waiters: [CheckedContinuation<Value, Never>] = []

  func resolve(_ value: Value) {
    guard !resolved else { return }
    resolved = true
    self.value = value
    let waiting = waiters
    waiters = []
    for waiter in waiting { waiter.resume(returning: value) }
  }

  var result: Value {
    get async {
      if resolved { return value! }
      return await withCheckedContinuation { waiters.append($0) }
    }
  }
}

/// One check under way: its decision, once it has one.
@MainActor
public final class AdviserCheck {
  let entry: AdviserDeferred<AdviserDecision>

  init(_ entry: AdviserDeferred<AdviserDecision>) {
    self.entry = entry
  }

  /// What the composer should do.
  public var decision: AdviserDecision { get async { await entry.result } }
}

public enum AdviserGateRules {
  /// What the sheet shows instead of a read.
  public static let sheetStatuses = ["ready", "error", "limit", "empty", "needsText"]

  public static let initialAdviserView = AdviserView()

  /// Whether the adviser can be asked at all for this account: switched on
  /// in its settings, a requester to send with, and AI access.
  public static func adviserGateEnabled(settings: JSONValue?, hasRequester: Bool, canUseAi: Bool) -> Bool {
    AdviserSetup.normalizeAdviserSettings(settings).enabled && hasRequester && canUseAi
  }

  /// The sheet's line about the month's checks, or ''.
  public static func adviserUsageLineFor(
    _ did: String?, readUsage: (String, Double) -> AdviserUsage?, now: Double, locale: String? = nil
  ) -> String {
    guard let did, !did.isEmpty else { return "" }
    return AdviserUsageStore.adviserUsageLine(readUsage(did, now), feature: .adviser, now: now, locale: locale)
  }
}

/// createAdviserGateController: everything with a side effect is injected.
@MainActor
public final class AdviserGateController {
  /// aiService.analyzePost as the posting account.
  public typealias AnalyzePost = @Sendable (
    _ requester: (any AIRequester)?, _ payload: JSONValue, _ signal: AdviserAbortSignal
  ) async throws -> JSONValue
  /// context.gatherReplyContext.
  public typealias GatherReplyContext = @Sendable (_ state: JSONValue?, _ kind: String, _ signal: AdviserAbortSignal) async
    -> AdviserReplyContext?

  /// The composer's latest props.
  public struct Config {
    public var did: String?
    public var settings: JSONValue?
    public var requester: (any AIRequester)?
    public var canUseAi: Bool
    public var onApplyFixes: (@MainActor ([String]) -> Void)?

    public init(
      did: String? = nil, settings: JSONValue? = nil, requester: (any AIRequester)? = nil, canUseAi: Bool = false,
      onApplyFixes: (@MainActor ([String]) -> Void)? = nil
    ) {
      self.did = did
      self.settings = settings
      self.requester = requester
      self.canUseAi = canUseAi
      self.onApplyFixes = onApplyFixes
    }
  }

  public private(set) var view = AdviserView()
  public private(set) var config = Config()
  public var onChange: @MainActor (AdviserView) -> Void

  let analyzePost: AnalyzePost
  let gatherReplyContext: GatherReplyContext
  let atLimit: @MainActor (String?) -> Bool
  let readUsage: @MainActor (String, Double) -> AdviserUsage?
  let now: @MainActor () -> Double
  let sleep: @Sendable (Double) async -> Void
  let readMinMs: Double

  var seq = 0
  var pending: (token: Int, entry: AdviserDeferred<AdviserDecision>)?
  var hold: AdviserDeferred<AdviserChoice?>?
  var sheetDecision: AdviserDeferred<AdviserDecision>?
  let reader: AdviserReader

  /// The defaults are the app's: aiService over the requester, the context
  /// read over `transport`, the usage kept in `store`, the system clock, and
  /// task timers.
  public init(
    analyzePost: AnalyzePost? = nil,
    gatherReplyContext: GatherReplyContext? = nil,
    atLimit: (@MainActor (String?) -> Bool)? = nil,
    readUsage: (@MainActor (String, Double) -> AdviserUsage?)? = nil,
    now: @escaping @MainActor () -> Double = { Date().timeIntervalSince1970 * 1000 },
    sleep: @escaping @Sendable (Double) async -> Void = AdviserGate.taskSleep,
    gateTimeoutMs: Double = AdviserGate.adviserGateTimeoutMs,
    readMinMs: Double = AdviserContext.readMinMs,
    onChange: @escaping @MainActor (AdviserView) -> Void = { _ in },
    store: (any KeyValueStore)? = nil,
    transport: any HTTPTransport = HTTP.transport,
    setTimer: PublishWatch.SetTimer? = nil,
    clearTimer: PublishWatch.ClearTimer? = nil
  ) {
    self.analyzePost =
      analyzePost ?? { requester, payload, signal in
        try await AIService.analyzePost(requester, payload, signal: signal, store: store)
      }
    self.gatherReplyContext =
      gatherReplyContext ?? { state, kind, signal in
        await AdviserContext.gatherReplyContext(state, kind, signal: signal, transport: transport)
      }
    self.atLimit =
      atLimit ?? { did in AdviserUsageStore.isAdviserAtLimit(did, now: now(), store: store) }
    self.readUsage =
      readUsage ?? { did, now in AdviserUsageStore.readAdviserUsage(did, feature: .adviser, now: now, store: store) }
    self.now = now
    self.sleep = sleep
    self.readMinMs = readMinMs
    self.onChange = onChange
    reader = AdviserReader(
      analyze: { _, _, _ in throw AIServiceError(message: "No read set up.") }, setIsCheckingPost: { _ in },
      gateTimeoutMs: gateTimeoutMs, setTimer: setTimer, clearTimer: clearTimer)
  }

  func set(_ patch: (inout AdviserView) -> Void) {
    patch(&view)
    onChange(view)
  }

  /// Take the composer's latest props. No side effects.
  public func configure(_ next: Config) {
    config = next
  }

  public func configure(
    did: String?, settings: JSONValue?, requester: (any AIRequester)?, canUseAi: Bool,
    onApplyFixes: (@MainActor ([String]) -> Void)? = nil
  ) {
    configure(Config(did: did, settings: settings, requester: requester, canUseAi: canUseAi, onApplyFixes: onApplyFixes))
  }

  /// Whether the adviser can be asked for the configured account.
  public var isEnabled: Bool {
    AdviserGateRules.adviserGateEnabled(
      settings: config.settings, hasRequester: config.requester != nil, canUseAi: config.canUseAi)
  }

  /// The sheet's line about the month's checks for the configured account.
  public func usageLine() -> String {
    AdviserGateRules.adviserUsageLineFor(config.did, readUsage: readUsage, now: now())
  }

  /// End whatever is in progress with 'edit', quietly (the account changed
  /// or the composer went away).
  public func cancel() { endCurrent() }

  func endCurrent() {
    reader.chooseAdviser(.edit)
    hold?.resolve(.edit)
    sheetDecision?.resolve(.edit)
    if let pending {
      pending.entry.resolve(.edit)
      self.pending = nil
    }
    hold = nil
    sheetDecision = nil
    if view.busy != nil || view.sheet != nil {
      set {
        $0.busy = nil
        $0.sheet = nil
      }
    }
  }

  func bumpUsage() {
    set { $0.usageVersion += 1 }
  }

  final class Found: Sendable {
    let context = Locked<AdviserReplyContext?>(nil)
  }

  /// The read itself: context first (bounded), then the server. Starts now;
  /// the task ends with how the read ended, the context and when it began.
  func startRead(_ plan: AdviserReadPlan, _ state: JSONValue?, gate: Bool)
    -> Task<(ended: AdviserReader.Ended, context: AdviserReplyContext?, startedAt: Double), Never>
  {
    let requester = config.requester
    let found = Found()
    let gather = gatherReplyContext
    let analyze = analyzePost
    reader.setAnalyze { _, _, signal in
      if let kind = plan.context {
        let context = await gather(state, kind, signal)
        found.context.withLock { $0 = context }
      }
      return try await analyze(requester, AdviserContext.analyzePayload(plan, found.context.withLock { $0 }), signal)
    }
    let startedAt = now()
    set {
      $0.busy = AdviserBusy(
        mode: gate ? "gate" : "manual", goals: plan.goalItems, startedAt: startedAt,
        choices: gate ? [.publish, .edit] : [.edit])
    }
    let read = reader.readAdviser(plan.source.text, gate: gate)
    return Task { @MainActor in
      let ended = await read.value
      return (ended, found.context.withLock { $0 }, startedAt)
    }
  }

  /// Keep the busy state up until readMinMs after the read started, so a
  /// fast answer doesn't flash. Nothing is in flight; a choice still counts.
  /// Nil when the hold ran out, else the choice.
  func holdFastAnswer(_ startedAt: Double) async -> AdviserChoice? {
    let left = readMinMs - (now() - startedAt)
    if left <= 0 { return nil }
    let held = AdviserDeferred<AdviserChoice?>()
    hold = held
    let sleep = self.sleep
    let timer = Task { @MainActor in
      await sleep(left)
      held.resolve(nil)
    }
    let choice = await held.result
    timer.cancel()
    // The web's `hold = null` runs before any later check can hold again
    // (microtasks); here it lets go only of its own hold, whatever order the
    // main actor runs things in.
    if hold === held { hold = nil }
    return choice
  }

  /// Opens the sheet now; the decision comes later.
  func openSheet(_ sheet: AdviserSheetRead) -> AdviserDeferred<AdviserDecision> {
    let decision = AdviserDeferred<AdviserDecision>()
    sheetDecision = decision
    set {
      $0.busy = nil
      $0.sheet = sheet
    }
    return decision
  }

  /// The sheet's decision, then `sheetDecision = null` (as the web's
  /// `.then` does, whichever sheet is open by then).
  func decided(_ decision: AdviserDeferred<AdviserDecision>) async -> AdviserDecision {
    let value = await decision.result
    sheetDecision = nil
    return value
  }

  func sheetFor(
    _ mode: String, _ status: String, _ plan: AdviserReadPlan?, _ state: JSONValue?,
    result: JSONValue? = nil, context: AdviserReplyContext? = nil, error: String? = nil, errorCode: JSONValue? = nil
  ) -> AdviserSheetRead {
    let posts = plan?.source.posts ?? []
    let setup = AdviserSetup.normalizeAdviserSettings(config.settings)
    return AdviserSheetRead(
      mode: mode, status: status, did: config.did, result: result, error: error, errorCode: errorCode,
      scenario: plan?.scenario ?? "post", context: context, contextKind: plan?.context,
      readTheRoom: setup.checkReplyContext, facts: plan?.facts, goalItems: plan?.goalItems ?? [], posts: posts,
      texts: posts, taken: [], fixesTaken: false,
      // Publishing from the sheet posts now, so it isn't offered for a post
      // that's set to go out later; the gate only runs for Post now.
      canPublish: mode == "gate" || !ComposerJS.truthy(state?["schedule"]),
      canSaveDraft: true, state: ComposerJS.truthy(state) ? state : nil, usageLine: usageLine())
  }

  /// Check `state` (the composer state, as the web's object) before a
  /// publish (`mode: "gate"`) or from the "Check this post" button
  /// (`"manual"`). Any check in progress ends with 'edit' first.
  @discardableResult
  public func check(_ state: JSONValue?, mode asked: String = "gate") -> AdviserCheck {
    let gate = asked != "manual"
    let mode = gate ? "gate" : "manual"
    endCurrent()
    seq += 1
    let token = seq
    let entry = AdviserDeferred<AdviserDecision>()
    pending = (token, entry)
    let check = AdviserCheck(entry)
    let live = { [weak self] in self?.pending?.token == token }
    let finish = { [weak self] (decision: AdviserDecision) in
      guard let self, live() else { return }
      self.pending = nil
      if self.view.busy != nil || self.view.sheet != nil {
        self.set {
          $0.busy = nil
          $0.sheet = nil
        }
      }
      entry.resolve(decision)
    }

    if !isEnabled {
      finish(gate ? .publish : .edit)
      return check
    }
    let did = config.did
    // The allowance may have moved elsewhere (another screen, Settings).
    bumpUsage()
    let plan = AdviserContext.adviserReadPlan(
      config.settings, state, canUseAi: config.canUseAi, atLimit: atLimit(did),
      asDid: ComposerJS.or(state?["asDid"], did.map(JSONValue.string)) ?? .null)

    if gate {
      if !plan.gate {
        finish(.publish)
        return check
      }
    } else if plan.source.text.isEmpty || !plan.hasSomething {
      let decision = openSheet(sheetFor("manual", plan.source.text.isEmpty ? "needsText" : "empty", plan, state))
      Task { @MainActor [weak self] in
        guard let self else { return }
        finish(await self.decided(decision))
      }
      return check
    }

    let read = startRead(plan, state, gate: gate)
    Task { @MainActor [weak self] in
      let (ended, context, startedAt) = await read.value
      guard let self, live() else { return }
      if ended.outcome == .result || ended.outcome == .error { self.bumpUsage() }
      if ended.outcome == .cancelled {
        return finish(ended.choice == .publish && gate ? .publish : .edit)
      }
      if gate {
        // Fail open: a failure or the deadline lets the post through.
        guard ended.outcome == .result, let result = ended.result, result.isTruthy else { return finish(.publish) }
        if !AdviserContext.adviserShouldInterrupt(result, plan.reviewMode) { return finish(.publish) }
      }

      let choice = await self.holdFastAnswer(startedAt)
      if !live() { return }
      if let choice { return finish(choice == .publish && gate ? .publish : .edit) }

      let sheet: AdviserSheetRead
      if ended.outcome == .result {
        sheet = self.sheetFor(gate ? "gate" : "manual", "ready", plan, state, result: ended.result, context: context)
      } else {
        let fields = ended.error.map(AIErrorFields.init)
        if fields?.codeString == "monthly_limit" {
          sheet = self.sheetFor(mode, "limit", plan, state)
        } else {
          let message = fields.flatMap { $0.message.isEmpty ? nil : $0.message }
          sheet = self.sheetFor(
            mode, "error", plan, state, error: message ?? "The adviser couldn’t read this post. Try again.",
            errorCode: fields?.code.truthy)
        }
      }
      finish(await self.decided(self.openSheet(sheet)))
    }
    return check
  }

  /// check for a composer state.
  @discardableResult
  public func check(_ state: ComposerState, mode: String = "gate") -> AdviserCheck {
    check(state.json, mode: mode)
  }

  /// A choice from the busy state.
  public func choose(_ choice: AdviserChoice) {
    guard view.busy != nil else { return }
    if let hold {
      hold.resolve(choice)
      return
    }
    reader.chooseAdviser(choice)
  }

  /// The sheet's answer: 'publish', 'edit' or 'draft' (anything else is
  /// 'edit').
  public func decide(_ decision: String) {
    guard let sheetDecision else { return }
    sheetDecision.resolve(AdviserDecision(rawValue: decision) ?? .edit)
  }

  public func decide(_ decision: AdviserDecision) { decide(decision.rawValue) }

  /// Take one or more of the sheet's fixes (from adviserSheetModel). The
  /// fixes land in the text as it stands now (earlier fixes included), each
  /// in the first post holding its passage; the composer gets every post's
  /// text back, by index. Answers how many applied.
  @discardableResult
  public func applyFix(_ fixes: [AdviserSheetFix]) -> Int {
    guard let sheet = view.sheet, sheet.status == "ready" else { return 0 }
    let fresh = fixes.filter { !$0.key.isEmpty && $0.issue.isTruthy && !sheet.taken.jsIncludes($0.key) }
    if fresh.isEmpty { return 0 }
    let out = AdviserAnalysis.applyWritingFixesToThread(
      .array(sheet.texts.map { ["text": .string($0)] }), .array(fresh.map(\.issue)))
    let texts = (out.posts?.arrayValue ?? []).map { $0["text"]?.stringValue ?? "" }
    var next = sheet
    next.texts = texts
    next.taken = sheet.taken + fresh.map(\.key)
    next.fixesTaken = sheet.fixesTaken || out.applied > 0
    set { $0.sheet = next }
    if out.applied > 0 { config.onApplyFixes?(texts) }
    return out.applied
  }

  @discardableResult
  public func applyFix(_ fix: AdviserSheetFix?) -> Int {
    applyFix(fix.map { [$0] } ?? [])
  }
}
