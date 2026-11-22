// Ports src/posting/adviser/useAdviserRead.js
//
// One adviser read at a time, bounded and escapable: AdviserReader is the
// web's createAdviserReader (no UI), and AdviserReadModel is the hook, the
// observable state a view binds to.
//
// Holds the composer's blocking `isCheckingPost` flag for exactly one read
// (outcomes in Gate.swift). `readAdviser(text, gate:)` starts at once and
// hands back the read's task, which ends once with `{ outcome, result,
// error, choice }`. A pre-publish check (`gate: true`) gets a deadline and
// a "publish anyway" choice; a read from the adviser button has no deadline
// of its own and can only be left. Answers arriving after the read ended
// are dropped.
//
// `analyze` is told which kind of read it is (the pre-publish check is
// `automatic`: a use the writer didn't ask for this time) and handed the
// read's signal, which aborts when the read ends without its answer.

import Foundation
import Observation
import VirgaCore

/// `{ adviserChoices, adviserReadInterrupted }`: the choices while a read
/// runs (nil when nothing is reading), and whether the last read ended
/// without an answer, so the surface doesn't tick its goals.
public struct AdviserReaderState: Hashable, Sendable {
  public var adviserChoices: [AdviserChoice]?
  public var adviserReadInterrupted: Bool

  public init(adviserChoices: [AdviserChoice]? = nil, adviserReadInterrupted: Bool = false) {
    self.adviserChoices = adviserChoices
    self.adviserReadInterrupted = adviserReadInterrupted
  }
}

/// createAdviserReader.
@MainActor
public final class AdviserReader {
  /// `analyze(text, { automatic, signal })`: the read itself, answering the
  /// analyze-post body.
  public typealias Analyze = @Sendable (_ text: String, _ automatic: Bool, _ signal: AdviserAbortSignal) async throws
    -> JSONValue
  public typealias Ended = AdviserReadEnded<JSONValue>

  public private(set) var state = AdviserReaderState()

  var current: AdviserRead<JSONValue>?
  /// The last read started, for tests that wait until a late answer has
  /// been dropped (its `workTask`).
  var lastRead: AdviserRead<JSONValue>?
  var live = true
  var analyzeFn: Analyze
  let setIsCheckingPost: @MainActor (Bool) -> Void
  var onChange: @MainActor (AdviserReaderState) -> Void
  public let gateTimeoutMs: Double
  let setTimer: PublishWatch.SetTimer?
  let clearTimer: PublishWatch.ClearTimer?

  public init(
    analyze: @escaping Analyze,
    setIsCheckingPost: @escaping @MainActor (Bool) -> Void,
    onChange: @escaping @MainActor (AdviserReaderState) -> Void = { _ in },
    gateTimeoutMs: Double = AdviserGate.adviserGateTimeoutMs,
    setTimer: PublishWatch.SetTimer? = nil,
    clearTimer: PublishWatch.ClearTimer? = nil
  ) {
    analyzeFn = analyze
    self.setIsCheckingPost = setIsCheckingPost
    self.onChange = onChange
    self.gateTimeoutMs = gateTimeoutMs
    self.setTimer = setTimer
    self.clearTimer = clearTimer
  }

  func set(_ patch: (inout AdviserReaderState) -> Void) {
    patch(&state)
    onChange(state)
  }

  /// Start a read of `sourceText`. A new read supersedes any still running,
  /// so two never share the flag. The answer to wait for is the task's.
  @discardableResult
  public func readAdviser(_ sourceText: String, gate: Bool = false) -> Task<Ended, Never> {
    current?.cancel(.edit)
    let analyze = analyzeFn
    let read = AdviserGate.startAdviserRead(
      { signal in try await analyze(sourceText, gate, signal) }, timeoutMs: gate ? gateTimeoutMs : nil,
      setTimer: setTimer, clearTimer: clearTimer)
    current = read
    lastRead = read
    set {
      $0.adviserReadInterrupted = false
      $0.adviserChoices = AdviserGate.adviserReadChoices(gate)
    }
    setIsCheckingPost(true)
    return Task { @MainActor [weak self] in
      let ended = await read.value
      // Only the current read lowers the flag; a superseded one already did.
      if let self, self.current === read {
        self.current = nil
        if self.live {
          self.set {
            $0.adviserReadInterrupted = ended.outcome == .timeout || ended.outcome == .cancelled
            $0.adviserChoices = nil
          }
          self.setIsCheckingPost(false)
        }
      }
      return ended
    }
  }

  /// The writer's choice while a read runs.
  public func chooseAdviser(_ choice: AdviserChoice) {
    current?.cancel(choice)
  }

  /// Keep the latest `analyze` without restarting anything.
  public func setAnalyze(_ fn: @escaping Analyze) {
    analyzeFn = fn
  }

  /// The composer went away: end any read, and change nothing after.
  public func dispose() {
    live = false
    current?.cancel(.edit)
  }

  public func revive() {
    live = true
  }
}

/// The composer's adviser read: AdviserReader as an observable model
/// (useAdviserRead). `readAdviser` and `chooseAdviser` stay the same while
/// `analyze` changes, and `dispose()` (the view going away) ends a read in
/// flight.
@MainActor
@Observable
public final class AdviserReadModel {
  public private(set) var adviserChoices: [AdviserChoice]?
  public private(set) var adviserReadInterrupted = false

  @ObservationIgnored private(set) var reader: AdviserReader
  @ObservationIgnored var setIsCheckingPost: @MainActor (Bool) -> Void
  @ObservationIgnored var analyze: AdviserReader.Analyze
  @ObservationIgnored let setTimer: PublishWatch.SetTimer?
  @ObservationIgnored let clearTimer: PublishWatch.ClearTimer?

  public init(
    analyze: @escaping AdviserReader.Analyze,
    setIsCheckingPost: @escaping @MainActor (Bool) -> Void,
    gateTimeoutMs: Double = AdviserGate.adviserGateTimeoutMs,
    setTimer: PublishWatch.SetTimer? = nil,
    clearTimer: PublishWatch.ClearTimer? = nil
  ) {
    self.analyze = analyze
    self.setIsCheckingPost = setIsCheckingPost
    self.setTimer = setTimer
    self.clearTimer = clearTimer
    reader = AdviserReader(analyze: analyze, setIsCheckingPost: { _ in }, gateTimeoutMs: gateTimeoutMs)
    reader = makeReader(gateTimeoutMs)
  }

  private func makeReader(_ gateTimeoutMs: Double) -> AdviserReader {
    AdviserReader(
      analyze: analyze,
      setIsCheckingPost: { [weak self] busy in self?.setIsCheckingPost(busy) },
      onChange: { [weak self] state in
        self?.adviserChoices = state.adviserChoices
        self?.adviserReadInterrupted = state.adviserReadInterrupted
      },
      gateTimeoutMs: gateTimeoutMs, setTimer: setTimer, clearTimer: clearTimer)
  }

  /// The pre-publish check's deadline. A different one makes a new reader
  /// (ending a read in flight), as the hook does.
  public var gateTimeoutMs: Double { reader.gateTimeoutMs }

  public func setGateTimeout(_ ms: Double) {
    guard ms != reader.gateTimeoutMs else { return }
    reader.dispose()
    reader = makeReader(ms)
  }

  /// The latest `analyze` and flag setter, as each render hands them over.
  public func update(analyze: @escaping AdviserReader.Analyze, setIsCheckingPost: (@MainActor (Bool) -> Void)? = nil) {
    self.analyze = analyze
    reader.setAnalyze(analyze)
    if let setIsCheckingPost { self.setIsCheckingPost = setIsCheckingPost }
  }

  @discardableResult
  public func readAdviser(_ text: String, gate: Bool = false) -> Task<AdviserReader.Ended, Never> {
    reader.readAdviser(text, gate: gate)
  }

  public func chooseAdviser(_ choice: AdviserChoice) {
    reader.chooseAdviser(choice)
  }

  /// The view appeared (again).
  public func revive() { reader.revive() }

  /// The view went away.
  public func dispose() { reader.dispose() }
}
