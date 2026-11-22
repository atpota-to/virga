// AdviserGateController (gateController.js) and AdviserGateModel
// (useAdviserGate.js), ported from gateController.test.js where the
// adviser.gate fixture can't reach: the deadline, a choice while reading or
// during the hold, one check at a time, the fixes from the sheet. Plus the
// aiService and context behaviours a recorded fetch can't show (a timeout,
// a signal that ends after the request went, a read that hangs).

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaPosting

@MainActor @Suite struct AdviserGateControllerBehaviour {
  static let me = "did:plc:me"
  static let seeded = AdviserSetup.nextPostingAdviserState(AdviserSetup.defaultAdviserSettings.json)

  static func setup(_ patch: [String: JSONValue] = [:]) -> JSONValue {
    var out = seeded.objectValue ?? [:]
    for (key, value) in patch { out[key] = value }
    return .object(out)
  }

  static let ok: JSONValue = [
    "sentiment": ["label": "neutral", "score": 0],
    "checks": [["id": "reduceNegativity", "label": "Reduce negativity", "status": "ok"]],
    "overallStatus": "ok", "writing": ["issues": []],
  ]
  static let conflict: JSONValue = [
    "checks": [["id": "limitTopic", "label": "Limit topics", "status": "conflict", "excerpt": .null]],
    "overallStatus": "conflict", "writing": ["issues": []],
  ]

  static func state(_ posts: [String] = ["a draft"], _ patch: [String: JSONValue] = [:]) -> JSONValue {
    var out: [String: JSONValue] = [
      "asDid": .string(me),
      "posts": .array(posts.enumerated().map { ["id": .string("p\($0.offset)"), "text": .string($0.element)] }),
    ]
    for (key, value) in patch { out[key] = value }
    return .object(out)
  }

  final class Harness {
    let answers = AdviserScript<Result<JSONValue, AIServiceError>>()
    let signals = Locked<[AdviserAbortSignal]>([])
    let sleeps = AdviserScript<Void>()
    let sleptFor = Locked<[Double]>([])
    let timers = ManualTimers()
    var clock: Double = 0
    var applied: [[String]] = []
    var views: [AdviserView] = []
    var ctl: AdviserGateController!
  }

  static func harness(
    settings: JSONValue = seeded, holdSleeps: Bool = false, readMinMs: Double = AdviserContext.readMinMs
  ) -> Harness {
    let h = Harness()
    h.ctl = AdviserGateController(
      analyzePost: { [answers = h.answers, signals = h.signals] _, _, signal in
        signals.withLock { $0.append(signal) }
        return try await answers.next().get()
      },
      gatherReplyContext: { _, kind, _ in AdviserReplyContext(kind: kind, thread: [], target: nil) },
      atLimit: { _ in false }, readUsage: { _, _ in nil },
      now: { [unowned h] in h.clock },
      sleep: { [sleeps = h.sleeps, sleptFor = h.sleptFor] ms in
        sleptFor.withLock { $0.append(ms) }
        if holdSleeps { await sleeps.next() }
      },
      readMinMs: readMinMs,
      onChange: { [unowned h] in h.views.append($0) },
      setTimer: h.timers.set, clearTimer: h.timers.clear)
    h.ctl.configure(
      did: me, settings: settings, requester: IdleRequester(did: me), canUseAi: true,
      onApplyFixes: { [unowned h] in h.applied.append($0) })
    return h
  }

  /// Waits until the controller has a sheet open.
  static func sheetOpens(_ h: Harness) async -> AdviserSheetRead {
    if let sheet = h.ctl.view.sheet { return sheet }
    let opened = AdviserGateLatch<AdviserSheetRead>()
    let previous = h.ctl.onChange
    h.ctl.onChange = { view in
      previous(view)
      if let sheet = view.sheet { opened.open(sheet) }
    }
    return await opened.wait()
  }

  @Test func failsOpenOnTheTenSecondDeadline() async {
    let h = Self.harness()
    let check = h.ctl.check(Self.state())
    await h.answers.called(0)
    h.timers.run(upTo: 9_999)
    #expect(h.ctl.view.busy != nil)
    h.timers.run(upTo: 10_000)
    #expect(await check.decision == .publish)
    #expect(h.ctl.view.busy == nil)
    #expect(h.signals.withLock { $0[0].aborted })
    h.answers.answer(0, .success(Self.conflict))
  }

  @Test func publishAnywayWhileReadingGoesAheadAndStopsTheRead() async {
    let h = Self.harness()
    let check = h.ctl.check(Self.state())
    await h.answers.called(0)
    h.ctl.choose(.publish)
    #expect(await check.decision == .publish)
    #expect(h.signals.withLock { $0[0].aborted })
    h.answers.answer(0, .success(Self.ok))
  }

  @Test func keepEditingWhileReadingGoesBackToTheComposer() async {
    let h = Self.harness()
    let check = h.ctl.check(Self.state())
    await h.answers.called(0)
    h.ctl.choose(.edit)
    #expect(await check.decision == .edit)
    #expect(h.ctl.view.busy == nil)
    h.answers.answer(0, .success(Self.ok))
  }

  @Test func aReadTheWriterAskedForOffersOnlyKeepEditing() async {
    let h = Self.harness()
    let check = h.ctl.check(Self.state(), mode: "manual")
    await h.answers.called(0)
    #expect(h.ctl.view.busy?.choices == [.edit])
    #expect(h.ctl.view.busy?.mode == "manual")
    h.ctl.choose(.publish)
    #expect(await check.decision == .edit)
    h.answers.answer(0, .success(Self.ok))
  }

  @Test func holdsAFastAnswerAndAChoiceInTheHoldStillCounts() async {
    let h = Self.harness(holdSleeps: true, readMinMs: 1200)
    let check = h.ctl.check(Self.state())
    await h.answers.called(0)
    h.clock = 300
    h.answers.answer(0, .success(Self.conflict))
    await h.sleeps.called(0)
    #expect(h.sleptFor.withLock { $0 } == [900])
    #expect(h.ctl.view.busy != nil)
    #expect(h.ctl.view.sheet == nil)
    h.ctl.choose(.edit)
    #expect(await check.decision == .edit)
    h.sleeps.answer(0, ())
  }

  @Test func opensTheSheetWhenTheHoldRunsOut() async {
    let h = Self.harness(holdSleeps: true)
    let check = h.ctl.check(Self.state())
    await h.answers.called(0)
    h.clock = 1000
    h.answers.answer(0, .success(Self.conflict))
    await h.sleeps.called(0)
    #expect(h.ctl.view.sheet == nil)
    h.sleeps.answer(0, ())
    let sheet = await Self.sheetOpens(h)
    #expect(sheet.status == "ready")
    h.ctl.decide(.publish)
    #expect(await check.decision == .publish)
  }

  @Test func doesNotHoldAnAnswerThatTookLongEnoughAlready() async {
    let h = Self.harness(holdSleeps: true)
    let check = h.ctl.check(Self.state())
    await h.answers.called(0)
    h.clock = 5000
    h.answers.answer(0, .success(Self.conflict))
    let sheet = await Self.sheetOpens(h)
    #expect(sheet.status == "ready")
    #expect(h.sleptFor.withLock { $0 }.isEmpty)
    h.ctl.decide(.edit)
    #expect(await check.decision == .edit)
  }

  @Test func aNewCheckEndsTheOneBeforeWithEdit() async {
    let h = Self.harness()
    let first = h.ctl.check(Self.state())
    await h.answers.called(0)
    let second = h.ctl.check(Self.state(), mode: "manual")
    #expect(await first.decision == .edit)
    await h.answers.called(1)
    #expect(h.ctl.view.busy?.mode == "manual")
    h.ctl.choose(.edit)
    #expect(await second.decision == .edit)
    h.answers.answer(0, .success(Self.ok))
    h.answers.answer(1, .success(Self.ok))
  }

  @Test func cancelEndsAnOpenSheetWithEdit() async {
    let h = Self.harness()
    let check = h.ctl.check(Self.state())
    h.answers.answer(0, .success(Self.conflict))
    _ = await Self.sheetOpens(h)
    h.ctl.cancel()
    #expect(await check.decision == .edit)
    #expect(h.ctl.view.sheet == nil)
  }

  @Test func countsTheRequest() async {
    let h = Self.harness()
    let before = h.ctl.view.usageVersion
    h.answers.answer(0, .success(Self.ok))
    #expect(await h.ctl.check(Self.state()).decision == .publish)
    #expect(h.ctl.view.usageVersion == before + 2)
  }

  @Test func appliesOneFixThenTheRestGivingBackEveryPostsText() async {
    let h = Self.harness(settings: Self.setup(["reviewMode": "always"]))
    var answer = Self.ok
    answer["writing"] = [
      "issues": [
        ["type": "typo", "found": "the the", "replacement": "the", "note": ""],
        ["type": "grammar", "found": " i ", "replacement": " I ", "note": ""],
      ]
    ]
    let posts = ["first post", "see the the thing", "and i think so"]
    let check = h.ctl.check(Self.state(posts))
    h.answers.answer(0, .success(answer))
    let sheet = await Self.sheetOpens(h)
    let model = sheet.model
    #expect(model.fixes.count == 2)
    #expect(h.ctl.applyFix(model.fixes[0]) == 1)
    #expect(h.applied.last == ["first post", "see the thing", "and i think so"])
    #expect(h.ctl.view.sheet?.taken == ["fix:0"])
    #expect(h.ctl.view.sheet?.fixesTaken == true)
    // Taking it again does nothing; "apply all" takes what's left.
    #expect(h.ctl.applyFix(model.fixes[0]) == 0)
    #expect(h.ctl.applyFix(model.fixes) == 1)
    #expect(h.applied.last == ["first post", "see the thing", "and I think so"])
    #expect(h.applied.count == 2)
    #expect(h.ctl.view.sheet?.taken == ["fix:0", "fix:1"])
    // The marks stay where the read put them.
    #expect(h.ctl.view.sheet?.posts == posts)
    h.ctl.decide("publish")
    #expect(await check.decision == .publish)
  }

  @Test func aFixWhosePassageIsGoneIsTakenButNotApplied() async {
    let h = Self.harness(settings: Self.setup(["reviewMode": "always"]))
    let check = h.ctl.check(Self.state(["x"]))
    h.answers.answer(0, .success(Self.ok))
    _ = await Self.sheetOpens(h)
    let fix = AdviserSheetFix(key: "fix:9", issue: ["found": "absent", "replacement": "present"])
    #expect(h.ctl.applyFix(fix) == 0)
    #expect(h.ctl.view.sheet?.taken == ["fix:9"])
    #expect(h.ctl.view.sheet?.fixesTaken == false)
    #expect(h.applied.isEmpty)
    h.ctl.cancel()
    #expect(await check.decision == .edit)
  }

  @Test func doesNothingWithoutAnOpenRead() {
    let h = Self.harness()
    #expect(h.ctl.applyFix(AdviserSheetFix(key: "fix:0", issue: ["found": "a", "replacement": "b"])) == 0)
    #expect(h.applied.isEmpty)
    h.ctl.decide(.publish)
    h.ctl.choose(.publish)
    #expect(h.views.isEmpty)
  }
}

@MainActor @Suite struct AdviserGateModelBehaviour {
  typealias C = AdviserGateControllerBehaviour

  final class Usage {
    var stored: AdviserUsage?
  }

  /// The gate's 10 s deadline is on timers nothing runs, so a loaded machine
  /// can't let it fire before the test answers.
  static func model(answers: AdviserScript<JSONValue>, usage: Usage = Usage()) -> AdviserGateModel {
    let timers = ManualTimers()
    let controller = AdviserGateController(
      analyzePost: { _, _, _ in await answers.next() },
      gatherReplyContext: { _, _, _ in nil }, atLimit: { _ in false },
      readUsage: { _, _ in usage.stored }, now: { 0 }, sleep: { _ in },
      setTimer: timers.set, clearTimer: timers.clear)
    return AdviserGateModel(controller: controller)
  }

  @Test func isEnabledOnlyWithTheSwitchARequesterAndAI() {
    let model = Self.model(answers: AdviserScript())
    model.configure(did: C.me, settings: C.seeded, requester: IdleRequester(did: C.me), canUseAi: true)
    #expect(model.enabled)
    model.configure(did: C.me, settings: C.seeded, requester: nil, canUseAi: true)
    #expect(!model.enabled)
    model.configure(did: C.me, settings: AdviserSetup.defaultAdviserSettings, requester: IdleRequester(did: C.me), canUseAi: true)
    #expect(!model.enabled)
    model.configure(did: C.me, settings: C.seeded, requester: IdleRequester(did: C.me), canUseAi: false)
    #expect(!model.enabled)
  }

  @Test func showsTheBusyStateAndTheSheetAndTheirWaysOut() async {
    let answers = AdviserScript<JSONValue>()
    let model = Self.model(answers: answers)
    model.configure(did: C.me, settings: C.seeded, requester: IdleRequester(did: C.me), canUseAi: true)
    let check = model.check(C.state())
    await answers.called(0)
    #expect(model.busy?.mode == "gate")
    #expect(model.canPublishAnyway)
    answers.answer(0, C.conflict)
    let opened = AdviserGateLatch<Void>()
    let previous = model.controller.onChange
    model.controller.onChange = { view in
      previous(view)
      if view.sheet != nil { opened.open() }
    }
    await opened.wait()
    #expect(model.sheetOpen)
    #expect(model.busy == nil)
    #expect(model.sheet?.canPublish == true)
    model.saveDraftFromSheet()
    #expect(await check.decision == .draft)
    #expect(model.sheet == nil)
  }

  @Test func publishAnywayIsOnlyThereWhereItIsOffered() async {
    let answers = AdviserScript<JSONValue>()
    let model = Self.model(answers: answers)
    model.configure(did: C.me, settings: C.seeded, requester: IdleRequester(did: C.me), canUseAi: true)
    let check = model.check(C.state(), mode: "manual")
    await answers.called(0)
    #expect(!model.canPublishAnyway)
    model.publishAnyway()
    #expect(model.busy != nil)
    model.keepEditing()
    #expect(await check.decision == .edit)
    answers.answer(0, C.ok)
  }

  @Test func aScheduledPostCannotBePublishedFromTheSheet() async {
    let answers = AdviserScript<JSONValue>()
    let model = Self.model(answers: answers)
    model.configure(did: C.me, settings: C.seeded, requester: IdleRequester(did: C.me), canUseAi: true)
    answers.answer(0, C.ok)
    let check = model.check(C.state(["x"], ["schedule": ["mode": "queue"]]), mode: "manual")
    let opened = AdviserGateLatch<Void>()
    let previous = model.controller.onChange
    model.controller.onChange = { view in
      previous(view)
      if view.sheet != nil { opened.open() }
    }
    if model.sheet == nil { await opened.wait() }
    #expect(model.sheet?.canPublish == false)
    model.publishFromSheet()
    #expect(model.sheet != nil)
    model.closeSheet()
    #expect(await check.decision == .edit)
  }

  @Test func changingTheAccountEndsWhatIsInProgress() async {
    let answers = AdviserScript<JSONValue>()
    let model = Self.model(answers: answers)
    model.configure(did: C.me, settings: C.seeded, requester: IdleRequester(did: C.me), canUseAi: true)
    let check = model.check(C.state())
    await answers.called(0)
    model.configure(did: "did:plc:alt", settings: C.seeded, requester: IdleRequester(did: "did:plc:alt"), canUseAi: true)
    #expect(await check.decision == .edit)
    #expect(model.busy == nil)
    // The same account again changes nothing.
    let again = model.check(C.state())
    await answers.called(1)
    model.configure(did: "did:plc:alt", settings: C.seeded, requester: IdleRequester(did: "did:plc:alt"), canUseAi: true)
    #expect(model.busy != nil)
    model.dispose()
    #expect(await again.decision == .edit)
    answers.answer(0, C.ok)
    answers.answer(1, C.ok)
  }

  @Test func readsTheUsageLineAgainAfterEachRequest() async {
    let answers = AdviserScript<JSONValue>()
    let usage = Usage()
    usage.stored = AdviserUsage(month: "1970-01", used: 12, limit: 30)
    let model = Self.model(answers: answers, usage: usage)
    model.configure(did: C.me, settings: C.seeded, requester: IdleRequester(did: C.me), canUseAi: true)
    #expect(model.usageLine == "18 of 30 free checks left this month.")
    usage.stored = AdviserUsage(month: "1970-01", used: 13, limit: 30)
    #expect(model.usageLine == "18 of 30 free checks left this month.")
    answers.answer(0, C.ok)
    _ = await model.check(C.state()).decision
    #expect(model.usageLine == "17 of 30 free checks left this month.")
  }

  @Test func appliesFixesToTheComposer() {
    let composer = ComposerStateModel(asDid: C.me, session: AutosaveSession())
    composer.dispatch(.addPost())
    let apply = AdviserGateModel.applyFixes(to: composer)
    apply(["one", "two"])
    #expect(composer.state.posts.map(\.text) == ["one", "two"])
    composer.cancelAutosave()
  }
}

@Suite struct AdviserAIServiceBehaviour {
  static let did = "did:plc:writer"

  @Test func aRequestThatTimesOutSaysSo() async {
    let transport = MockTransport()
    transport.on("POST", .urlPrefix("https://server.example/api/ai/analyze-post"), respond: .timeout)
    let req = AdviserFixtureServer.requester(transport, did: Self.did)
    do {
      _ = try await AIService.analyzePost(req, ["text": "hi"], store: nil)
      Issue.record("answered")
    } catch let error as AIServiceError {
      #expect(error.message == "That took too long. Try again.")
      #expect(error.codeString == "TIMEOUT")
      #expect(error.status == 0)
    } catch {
      Issue.record("\(error)")
    }
  }

  @Test func aSignalThatEndsAfterTheRequestWentDoesNotStopIt() async throws {
    let transport = MockTransport()
    let sent = AdviserGateLatch<Void>()
    let release = AdviserGateLatch<Void>()
    transport.on("POST", .urlPrefix("https://server.example/api/ai/analyze-post")) { _ in
      sent.open()
      await release.wait()
      return .json(["overallStatus": "ok", "usage": ["used": 3, "limit": 30]])
    }
    let store = InMemoryKeyValueStore()
    let signal = AdviserAbortSignal()
    let req = AdviserFixtureServer.requester(transport, did: Self.did)
    let call = Task {
      try await AIService.analyzePost(req, ["text": "hi"], signal: signal, store: store, now: { AdviserFixtureServer.now })
    }
    await sent.wait()
    signal.abort()
    release.open()
    let answer = try await call.value
    #expect(answer["overallStatus"] == "ok")
    // The server counted it, so the count is kept.
    #expect(
      AdviserUsageStore.readAdviserUsage(Self.did, now: AdviserFixtureServer.now, store: store)?.used == 3)
  }

  @Test func aCancelledCallerGoesThroughAsItIs() async {
    let transport = MockTransport()
    transport.on("POST", .urlPrefix("https://server.example/api/ai/alt-text"), respond: .hang)
    let req = AdviserFixtureServer.requester(transport, did: Self.did)
    let call = Task {
      try await AIService.generateAltText(req, ["imageBase64": "AAAA", "mimeType": "image/png"], store: nil)
    }
    call.cancel()
    do {
      _ = try await call.value
      Issue.record("answered")
    } catch {
      #expect(error is CancellationError)
    }
  }
}

@Suite struct AdviserContextBehaviour {
  static let other = "did:plc:other"
  static let state: JSONValue = [
    "asDid": "did:plc:me", "posts": [["text": "x"]],
    "reply": ["uri": "at://did:plc:other/app.bsky.feed.post/r1", "cid": "c", "text": "hello"],
  ]

  @Test func givesUpOnAThreadReadThatTakesTooLong() async {
    let transport = MockTransport()
    transport.on(.path("/xrpc/app.bsky.feed.getPostThread"), respond: .hang)
    let waited = Locked<[Double]>([])
    let context = await AdviserContext.gatherReplyContext(
      Self.state, "reply", timeoutMs: 4000, sleep: { ms in waited.withLock { $0.append(ms) } }, transport: transport)
    #expect(waited.withLock { $0 } == [4000])
    #expect(context?.thread == [AdviserContextLine(author: "someone", text: "hello")])
  }

  @Test func aReadThatHasEndedSendsNothingAndStandsInThePostAlone() async {
    let transport = MockTransport()
    let signal = AdviserAbortSignal()
    signal.abort()
    let context = await AdviserContext.gatherReplyContext(
      Self.state, "reply", signal: signal, sleep: { _ in try? await Task.sleep(for: .seconds(3600)) },
      transport: transport)
    #expect(transport.requests.isEmpty)
    #expect(context?.target == AdviserContextLine(author: "someone", text: "hello"))
    #expect(context?.thread.count == 1)
  }

  @Test func theStyleReadStopsWhenTheSignalEnds() async {
    let transport = MockTransport()
    let signal = AdviserAbortSignal()
    signal.abort()
    do {
      _ = try await AdviserStyle.fetchStylePostTexts("did:plc:me", signal: signal, transport: transport)
      Issue.record("answered")
    } catch {
      #expect(error is CancellationError)
    }
    #expect(transport.requests.isEmpty)
  }
}
