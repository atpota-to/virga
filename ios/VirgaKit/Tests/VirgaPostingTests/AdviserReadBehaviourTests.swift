// gate.js startAdviserRead and useAdviserRead.js createAdviserReader,
// ported from gate.test.js and useAdviserRead.test.js: the read holds the
// composer's flag for exactly one read, lets go on the answer, a failure,
// the pre-publish deadline or the writer's choice, and an answer arriving
// after the read ended changes nothing. Deadlines run on ManualTimers;
// answers arrive when a test opens their gate.

import Foundation
import Testing
import VirgaCore
@testable import VirgaPosting

@Suite struct AdviserGateReadBehaviour {
  @Test func settlesOnTheAnswer() async {
    let timers = ManualTimers()
    let read = AdviserGate.startAdviserRead(
      { _ in "aligned" as JSONValue }, timeoutMs: 10000, setTimer: timers.set, clearTimer: timers.clear)
    let ended = await read.value
    #expect(ended.outcome == .result)
    #expect(ended.result == "aligned")
    #expect(read.isSettled)
    // Its timer is cleared once it has settled.
    #expect(timers.timers.withLock { $0.allSatisfy { !$0.live } })
  }

  @Test func settlesOnAFailureThrownAtOnce() async {
    let read = AdviserGate.startAdviserRead({ _ -> JSONValue in throw AIServiceError(message: "no") })
    let ended = await read.value
    #expect(ended.outcome == .error)
    #expect((ended.error as? AIServiceError)?.message == "no")
  }

  @Test func settlesOnTheDeadlineAndIgnoresALateAnswer() async {
    let timers = ManualTimers()
    let answer = AdviserGateLatch<JSONValue>()
    let started = AdviserGateLatch<AdviserAbortSignal>()
    let read = AdviserGate.startAdviserRead(
      { signal in
        started.open(signal)
        return await answer.wait()
      }, timeoutMs: AdviserGate.adviserGateTimeoutMs, setTimer: timers.set, clearTimer: timers.clear)
    let signal = await started.wait()
    timers.run(upTo: AdviserGate.adviserGateTimeoutMs - 1)
    #expect(!read.isSettled)
    #expect(!signal.aborted)
    timers.run(upTo: AdviserGate.adviserGateTimeoutMs)
    #expect(read.isSettled)
    #expect(signal.aborted)
    answer.open(["overallStatus": "conflict"])
    await read.workTask?.value
    let ended = await read.value
    #expect(ended.outcome == .timeout)
    #expect(ended.result == nil)
  }

  @Test func settlesOnTheWritersChoiceOnce() async {
    let timers = ManualTimers()
    let answer = AdviserGateLatch<JSONValue>()
    let read = AdviserGate.startAdviserRead(
      { _ in await answer.wait() }, timeoutMs: 10000, setTimer: timers.set, clearTimer: timers.clear)
    #expect(read.cancel(.publish))
    answer.open(["overallStatus": "conflict"])
    #expect(!read.cancel(.edit))
    timers.run(upTo: 10000)
    let ended = await read.value
    #expect(ended.outcome == .cancelled)
    #expect(ended.choice == .publish)
    #expect(read.signal.aborted)
  }

  @Test func hasNoDeadlineUnlessGivenOne() async {
    let timers = ManualTimers()
    let answer = AdviserGateLatch<JSONValue>()
    let read = AdviserGate.startAdviserRead(
      { _ in await answer.wait() }, setTimer: timers.set, clearTimer: timers.clear)
    timers.run(upTo: 60000)
    #expect(timers.timers.withLock { $0.isEmpty })
    #expect(!read.isSettled)
    answer.open("late but wanted")
    let ended = await read.value
    #expect(ended.outcome == .result)
    #expect(ended.result == "late but wanted")
  }

  @Test func theSignalStaysLiveOnAnAnswerOrAFailure() async {
    let timers = ManualTimers()
    let answered = AdviserGate.startAdviserRead(
      { _ in "ok" as JSONValue }, timeoutMs: 10000, setTimer: timers.set, clearTimer: timers.clear)
    _ = await answered.value
    #expect(!answered.signal.aborted)
    #expect(!answered.cancel(.edit))
    #expect(!answered.signal.aborted)
    let failed = AdviserGate.startAdviserRead(
      { _ -> JSONValue in throw AIServiceError(message: "busy") }, timeoutMs: 10000, setTimer: timers.set,
      clearTimer: timers.clear)
    _ = await failed.value
    #expect(!failed.signal.aborted)
  }

  @Test func withinMsPassesAPromptAnswerAndRejectsOneThatNeverComes() async throws {
    let value = try await AdviserGate.withinMs(4000, sleep: { _ in try? await Task.sleep(for: .seconds(3600)) }) {
      "thread"
    }
    #expect(value == "thread")
    do {
      _ = try await AdviserGate.withinMs(4000, sleep: { _ in }) { () async throws -> String in
        try await Task.sleep(for: .seconds(3600))
        return "never"
      }
      Issue.record("answered")
    } catch let error as AdviserDeadlineError {
      #expect(error.message == "timed out after 4000ms")
    }
  }
}

@MainActor @Suite struct AdviserReaderBehaviour {
  final class Harness {
    var flag = false
    var flagLog: [Bool] = []
    var seen: [AdviserReaderState] = []
    let answers = AdviserScript<Result<JSONValue, AIServiceError>>()
    let calls = Locked<[(text: String, automatic: Bool, signal: AdviserAbortSignal)]>([])
    let timers = ManualTimers()
    var reader: AdviserReader!

    var analyze: AdviserReader.Analyze {
      { [answers, calls] text, automatic, signal in
        calls.withLock { $0.append((text, automatic, signal)) }
        return try await answers.next().get()
      }
    }
  }

  static func harness() -> Harness {
    let h = Harness()
    h.reader = AdviserReader(
      analyze: h.analyze,
      setIsCheckingPost: { [unowned h] busy in
        h.flag = busy
        h.flagLog.append(busy)
      },
      onChange: { [unowned h] state in h.seen.append(state) },
      setTimer: h.timers.set, clearTimer: h.timers.clear)
    return h
  }

  @Test func holdsTheFlagAndOffersBothWaysOutOfAPrePublishCheck() async {
    let h = Self.harness()
    let task = h.reader.readAdviser("a draft", gate: true)
    await h.answers.called(0)
    #expect(h.calls.withLock { $0[0].text } == "a draft")
    #expect(h.calls.withLock { $0[0].automatic } == true)
    #expect(h.flag)
    #expect(h.reader.state.adviserChoices == [.publish, .edit])
    h.answers.answer(0, .success(["overallStatus": "ok"]))
    let ended = await task.value
    #expect(ended.outcome == .result)
    #expect(ended.result == ["overallStatus": "ok"])
    #expect(!h.flag)
    #expect(h.reader.state.adviserChoices == nil)
    #expect(!h.reader.state.adviserReadInterrupted)
  }

  @Test func offersOnlyKeepEditingOnAReadTheWriterAskedFor() async {
    let h = Self.harness()
    _ = h.reader.readAdviser("a draft", gate: false)
    await h.answers.called(0)
    #expect(h.reader.state.adviserChoices == [.edit])
    #expect(h.calls.withLock { $0[0].automatic } == false)
    h.reader.dispose()
    h.answers.answer(0, .success([:]))
  }

  @Test func tellsTheAnalysisWhenTheReadHasEndedWithoutIt() async {
    let h = Self.harness()
    let first = h.reader.readAdviser("a draft", gate: true)
    await h.answers.called(0)
    let signal = h.calls.withLock { $0[0].signal }
    #expect(!signal.aborted)
    h.timers.run(upTo: AdviserGate.adviserGateTimeoutMs)
    #expect(signal.aborted)
    _ = await first.value
    _ = h.reader.readAdviser("another", gate: false)
    await h.answers.called(1)
    let second = h.calls.withLock { $0[1].signal }
    h.reader.chooseAdviser(.edit)
    #expect(second.aborted)
    h.answers.answer(0, .success([:]))
    h.answers.answer(1, .success([:]))
  }

  @Test func givesTheComposerBackPastTheDeadline() async {
    let h = Self.harness()
    let task = h.reader.readAdviser("a draft", gate: true)
    await h.answers.called(0)
    h.timers.run(upTo: AdviserGate.adviserGateTimeoutMs - 1)
    #expect(h.flag)
    h.timers.run(upTo: AdviserGate.adviserGateTimeoutMs)
    let ended = await task.value
    #expect(ended.outcome == .timeout)
    #expect(!h.flag)
    #expect(h.reader.state.adviserReadInterrupted)
    h.answers.answer(0, .success([:]))
  }

  @Test func putsNoDeadlineOnAReadTheWriterAskedFor() async {
    let h = Self.harness()
    _ = h.reader.readAdviser("a draft", gate: false)
    await h.answers.called(0)
    h.timers.run(upTo: AdviserGate.adviserGateTimeoutMs * 2)
    #expect(h.timers.timers.withLock { $0.isEmpty })
    #expect(h.flag)
    #expect(h.reader.lastRead?.isSettled == false)
    h.reader.dispose()
    h.answers.answer(0, .success([:]))
  }

  @Test func endsOnPublishAnywayAndOnKeepEditingAtOnce() async {
    for choice in [AdviserChoice.publish, .edit] {
      let h = Self.harness()
      let task = h.reader.readAdviser("a draft", gate: true)
      h.reader.chooseAdviser(choice)
      let ended = await task.value
      #expect(ended.outcome == .cancelled)
      #expect(ended.choice == choice)
      #expect(!h.flag)
      #expect(h.reader.state.adviserReadInterrupted)
      h.answers.answer(0, .success([:]))
    }
  }

  @Test func ignoresAnAnswerThatArrivesAfterTheReadHasEnded() async {
    let h = Self.harness()
    let task = h.reader.readAdviser("a draft", gate: true)
    await h.answers.called(0)
    h.reader.chooseAdviser(.edit)
    let ended = await task.value
    let flips = h.flagLog.count
    let read = h.reader.lastRead
    h.answers.answer(0, .success(["overallStatus": "conflict"]))
    await read?.workTask?.value
    #expect(ended.outcome == .cancelled)
    #expect(await read?.value.outcome == .cancelled)
    #expect(h.flagLog.count == flips)
    #expect(!h.flag)
  }

  @Test func aLateAnswerDoesNotPutDownTheFlagANewerReadHolds() async {
    let h = Self.harness()
    let first = h.reader.readAdviser("first", gate: true)
    await h.answers.called(0)
    h.reader.chooseAdviser(.edit)
    _ = await first.value
    let firstRead = h.reader.lastRead
    let second = h.reader.readAdviser("second", gate: true)
    await h.answers.called(1)
    #expect(h.flag)
    h.answers.answer(0, .success(["overallStatus": "ok"]))
    await firstRead?.workTask?.value
    #expect(h.flag)
    #expect(h.reader.lastRead?.isSettled == false)
    h.answers.answer(1, .success(["overallStatus": "ok"]))
    #expect(await second.value.outcome == .result)
    #expect(!h.flag)
  }

  @Test func cancelsAReadStillRunningWhenANewOneStarts() async {
    let h = Self.harness()
    let first = h.reader.readAdviser("first", gate: false)
    _ = h.reader.readAdviser("second", gate: false)
    let ended = await first.value
    #expect(ended.outcome == .cancelled)
    #expect(ended.choice == .edit)
    #expect(h.flag)
    h.reader.dispose()
    h.answers.answer(0, .success([:]))
    h.answers.answer(1, .success([:]))
  }

  @Test func reportsAFailureAsAnErrorAndGivesTheComposerBack() async {
    let h = Self.harness()
    let task = h.reader.readAdviser("a draft", gate: true)
    await h.answers.called(0)
    h.answers.answer(0, .failure(AIServiceError(message: "busy", code: "overloaded")))
    let ended = await task.value
    #expect(ended.outcome == .error)
    #expect((ended.error as? AIServiceError)?.message == "busy")
    #expect(!h.flag)
  }

  @Test func doesNothingWhenThereIsNoReadToEnd() {
    let h = Self.harness()
    h.reader.chooseAdviser(.publish)
    #expect(h.flagLog.isEmpty)
  }

  @Test func endsAReadWhenDisposedAndChangesNothingAfter() async {
    let h = Self.harness()
    let task = h.reader.readAdviser("a draft", gate: true)
    h.reader.dispose()
    let ended = await task.value
    #expect(ended.outcome == .cancelled)
    #expect(ended.choice == .edit)
    #expect(h.flagLog == [true])
    #expect(h.reader.state.adviserChoices != nil)
    h.answers.answer(0, .success([:]))
  }

  @Test func readsWithTheLatestAnalyzeItWasGiven() async {
    let h = Self.harness()
    let later = Locked(0)
    h.reader.setAnalyze { _, _, _ in
      later.withLock { $0 += 1 }
      return ["overallStatus": "caution"]
    }
    let ended = await h.reader.readAdviser("a draft", gate: false).value
    #expect(later.withLock { $0 } == 1)
    #expect(ended.result == ["overallStatus": "caution"])
  }

  @Test func tellsItsListenerEachTimeTheStateChanges() async {
    let h = Self.harness()
    h.reader.setAnalyze { _, _, _ in [:] }
    _ = await h.reader.readAdviser("a draft", gate: true).value
    #expect(
      h.seen == [
        AdviserReaderState(adviserChoices: [.publish, .edit], adviserReadInterrupted: false),
        AdviserReaderState(adviserChoices: nil, adviserReadInterrupted: false),
      ])
  }
}

@MainActor @Suite struct AdviserReadModelBehaviour {
  @Test func startsWithNothingReadingAndMirrorsTheReader() async {
    let answers = AdviserScript<JSONValue>()
    var flags: [Bool] = []
    let timers = ManualTimers()
    let model = AdviserReadModel(
      analyze: { _, _, _ in await answers.next() }, setIsCheckingPost: { flags.append($0) }, setTimer: timers.set,
      clearTimer: timers.clear)
    #expect(model.adviserChoices == nil)
    #expect(!model.adviserReadInterrupted)
    let task = model.readAdviser("x", gate: true)
    #expect(model.adviserChoices == [.publish, .edit])
    model.chooseAdviser(.publish)
    let ended = await task.value
    #expect(ended.choice == .publish)
    #expect(model.adviserChoices == nil)
    #expect(model.adviserReadInterrupted)
    #expect(flags == [true, false])
    answers.answer(0, [:])
  }

  @Test func aNewDeadlineMakesANewReaderAndEndsTheReadInFlight() async {
    let answers = AdviserScript<JSONValue>()
    let timers = ManualTimers()
    let model = AdviserReadModel(
      analyze: { _, _, _ in await answers.next() }, setIsCheckingPost: { _ in }, setTimer: timers.set,
      clearTimer: timers.clear)
    let task = model.readAdviser("x", gate: true)
    model.setGateTimeout(5000)
    #expect(model.gateTimeoutMs == 5000)
    let ended = await task.value
    #expect(ended.outcome == .cancelled)
    model.setGateTimeout(5000)
    #expect(model.gateTimeoutMs == 5000)
    answers.answer(0, [:])
  }

  @Test func readsWithTheLatestAnalyzeAndFlagSetter() async {
    var flags: [String] = []
    let model = AdviserReadModel(analyze: { _, _, _ in "old" }, setIsCheckingPost: { flags.append("old \($0)") })
    model.update(analyze: { _, _, _ in "new" }, setIsCheckingPost: { flags.append("new \($0)") })
    let ended = await model.readAdviser("x").value
    #expect(ended.result == "new")
    #expect(flags == ["new true", "new false"])
  }

  @Test func disposingEndsARead() async {
    let answers = AdviserScript<JSONValue>()
    let model = AdviserReadModel(analyze: { _, _, _ in await answers.next() }, setIsCheckingPost: { _ in })
    let task = model.readAdviser("x")
    model.dispose()
    #expect(await task.value.outcome == .cancelled)
    model.revive()
    answers.answer(0, [:])
  }
}
