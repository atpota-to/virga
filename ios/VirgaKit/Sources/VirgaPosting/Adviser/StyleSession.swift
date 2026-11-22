// Ports src/posting/adviser/styleSession.js
//
// One sitting of the style dialog: gather the account's recent posts once,
// read a style from them, and refine it from the writer's notes as often as
// they like against the same posts. Nothing is kept until the dialog saves;
// closing it drops the posts.
//
// Stages while working: 'gather' (reading posts from the AppView, with a
// running count), 'read' (the server has them), 'write' (shown a few seconds
// in, since the reading is one request and its second half is the writing).
//
// createStyleSession becomes StyleSession, a main-actor model the dialog
// binds to; its view is observed, and `onChange` hears each change as the
// web's does. Its work (fetchTexts, synthesize) and its timer are injected.

import Foundation
import Observation
import VirgaCore
import VirgaNetwork

/// A stage of the work: `{ id, label }`.
public struct StyleStage: Codable, Hashable, Sendable {
  public var id: String
  public var label: String
}

/// What the dialog shows (INITIAL_STYLE_VIEW's shape).
public struct StyleView: Hashable, Sendable {
  /// What went wrong: `{ code, message }`.
  public struct Failure: Codable, Hashable, Sendable {
    public var code: JSONValue?
    public var message: String
  }

  /// 'idle' | 'working' | 'result' | 'error'.
  public var phase = "idle"
  /// 'gather' | 'read' | 'write'.
  public var stage = "gather"
  public var postCount = 0
  public var summary = ""
  public var analyzedCount: Double = 0
  public var updatedAt = ""
  public var error: Failure?
  public var usage: JSONValue?
  /// The summary came from this sitting, not the saved one.
  public var fresh = false

  public init() {}

  public var json: JSONValue {
    [
      "phase": .string(phase), "stage": .string(stage), "postCount": .number(Double(postCount)),
      "summary": .string(summary), "analyzedCount": .number(analyzedCount), "updatedAt": .string(updatedAt),
      "error": error.map { ["code": $0.code ?? .null, "message": .string($0.message)] } ?? .null,
      "usage": usage ?? .null, "fresh": .bool(fresh),
    ]
  }
}

/// A timer on the main actor: `setTimeout(fn, ms)` and `clearTimeout(id)`.
public typealias MainActorSetTimer = @MainActor (_ ms: Double, _ fn: @escaping @MainActor () -> Void) -> Int
public typealias MainActorClearTimer = @MainActor (_ id: Int) -> Void

public enum AdviserMainTimers {
  /// Timers over tasks on the main actor (the app's; tests script their own).
  @MainActor public static func live() -> (set: MainActorSetTimer, clear: MainActorClearTimer) {
    let table = Table()
    return ({ ms, fn in table.set(ms, fn) }, { id in table.clear(id) })
  }

  @MainActor final class Table {
    var tasks: [Int: Task<Void, Never>] = [:]
    var next = 0

    func set(_ ms: Double, _ fn: @escaping @MainActor () -> Void) -> Int {
      next += 1
      let id = next
      tasks[id] = Task { @MainActor [weak self] in
        try? await Task.sleep(for: PromiseRace.timerDelay(ms))
        if Task.isCancelled { return }
        self?.tasks[id] = nil
        fn()
      }
      return id
    }

    func clear(_ id: Int) {
      tasks[id]?.cancel()
      tasks[id] = nil
    }
  }
}

public enum StyleSessionWords {
  public static let styleStages = [
    StyleStage(id: "gather", label: "Gathering your recent posts"),
    StyleStage(id: "read", label: "Reading for patterns"),
    StyleStage(id: "write", label: "Writing the description"),
  ]

  /// When the label moves from reading to writing.
  public static let writeStageFlipMs: Double = 3500

  public static let initialStyleView = StyleView()

  /// What to tell the writer about a failed reading, from the error's fields
  /// as the web reads them (`{ code, status, detail, message }`).
  public static func styleErrorMessage(_ err: JSONValue?) -> String {
    let code = err?["code"]?.stringValue
    if code == "not_enough_posts" {
      return "There aren’t enough posts to learn from yet. It needs at least 5 of your own posts."
    }
    if code == "monthly_limit" {
      return "This month’s free style readings are used up. They start again on the first of the month."
    }
    if code == "STYLE_FETCH_FAILED" || code == "EMPTY_STYLE" {
      return err?["message"].map { $0.stringValue ?? $0.jsString } ?? ""
    }
    if ComposerJS.greaterOrEqual(err?["status"], 500) && !ComposerJS.truthy(err?["detail"]) {
      return "The style reading didn’t finish. Try again."
    }
    return err?["message"].truthy.map { $0.stringValue ?? $0.jsString } ?? "The style reading didn’t finish. Try again."
  }

  /// styleErrorMessage for a thrown error.
  public static func styleErrorMessage(_ error: any Error) -> String {
    styleErrorMessage(AIErrorFields(error).json)
  }

  /// `new Date(value)`'s time for a value read from a profile.
  static func time(_ value: JSONValue, timeZone: TimeZone) -> Double {
    switch value {
    case .number(let n): return JSDate.timeClip(n)
    case .bool(let b): return b ? 1 : 0
    default: return JSDate.timeClip(JSDate.toMs(value, timeZone: timeZone))
    }
  }

  /// "Written from 212 of your posts · 12 Nov 2026", or ''. The count is
  /// written in `countLocale` (the web's activeLocale(), the default) and the
  /// date in `locale` (by default the active one too), in `timeZone`'s local
  /// time.
  public static func styleProfileLine(
    analyzedCount: JSONValue? = nil, updatedAt: JSONValue? = nil, locale: String? = nil, countLocale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> String {
    var parts: [String] = []
    if ComposerJS.greater(analyzedCount, 0), let count = analyzedCount {
      if case .number(let n) = count {
        parts.append("Written from \(AppLocale.formatNumber(n, locale: countLocale ?? AppLocale.activeLocale())) of your posts")
      } else {
        parts.append("Written from \(count.jsString) of your posts")
      }
    }
    let zone = timeZone ?? AppLocale.activeTimeZone()
    if let updatedAt, updatedAt.isTruthy {
      let at = time(updatedAt, timeZone: zone)
      if !at.isNaN {
        parts.append(
          AppLocale.toLocaleDateString(
            at, DateFormatOptions(year: "numeric", month: "short", day: "numeric"),
            locale: locale ?? AppLocale.activeLocale(), timeZone: zone))
      }
    }
    return parts.joined(separator: " · ")
  }

  public static func styleProfileLine(
    _ profile: AdviserStyleProfile?, locale: String? = nil, countLocale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    styleProfileLine(
      analyzedCount: profile.map { .number($0.analyzedCount) }, updatedAt: profile.map { .string($0.updatedAt) },
      locale: locale, countLocale: countLocale, timeZone: timeZone)
  }
}

@MainActor
@Observable
public final class StyleSession {
  /// `fetchStylePostTexts(did, { sampleSize, signal, onPage })`.
  public typealias FetchTexts = @MainActor (
    _ did: String?, _ sampleSize: JSONValue?, _ signal: AdviserAbortSignal, _ onPage: @escaping @MainActor (Int) -> Void
  ) async throws -> [String]
  /// `synthesizeStyleFromTexts(requester, { texts, guidance, previousSummary, signal })`.
  public typealias Synthesize = @MainActor (
    _ requester: (any AIRequester)?, _ texts: [String], _ guidance: String, _ previousSummary: String,
    _ signal: AdviserAbortSignal
  ) async throws -> StyleReading

  /// What the dialog shows.
  public private(set) var view: StyleView

  @ObservationIgnored let did: String?
  @ObservationIgnored let requester: (any AIRequester)?
  @ObservationIgnored let fetchTexts: FetchTexts
  @ObservationIgnored let synthesize: Synthesize
  @ObservationIgnored let setTimer: MainActorSetTimer
  @ObservationIgnored let clearTimer: MainActorClearTimer
  @ObservationIgnored public var onChange: (@MainActor (StyleView) -> Void)?

  @ObservationIgnored var texts: [String]?
  @ObservationIgnored var run = 0
  @ObservationIgnored var flip: Int?
  @ObservationIgnored var controller: AdviserAbortSignal?

  /// The style read from `did`'s posts as `requester`. A saved `profile`
  /// with a summary is shown first. `fetchTexts` and `synthesize` default to
  /// AdviserStyle's, over `transport` and keeping the usage in `store`.
  public init(
    did: String?, requester: (any AIRequester)?, profile: AdviserStyleProfile? = nil,
    onChange: (@MainActor (StyleView) -> Void)? = nil, fetchTexts: FetchTexts? = nil, synthesize: Synthesize? = nil,
    store: (any KeyValueStore)? = nil, transport: any HTTPTransport = HTTP.transport,
    now: @escaping @Sendable () -> Double = AIService.systemNow,
    setTimer: MainActorSetTimer? = nil, clearTimer: MainActorClearTimer? = nil
  ) {
    var view = StyleView()
    if let profile, !profile.summary.isEmpty {
      view.phase = "result"
      view.summary = profile.summary
      view.analyzedCount = profile.analyzedCount
      view.updatedAt = profile.updatedAt
    }
    self.view = view
    self.did = did
    self.requester = requester
    self.onChange = onChange
    self.fetchTexts =
      fetchTexts ?? { did, sampleSize, signal, onPage in
        try await AdviserStyle.fetchStylePostTexts(
          did, sampleSize: sampleSize, onPage: { n in await onPage(n) }, signal: signal, transport: transport)
      }
    self.synthesize =
      synthesize ?? { requester, texts, guidance, previousSummary, signal in
        try await AdviserStyle.synthesizeStyleFromTexts(
          requester, texts: texts, guidance: guidance, previousSummary: previousSummary, now: now, signal: signal,
          store: store)
      }
    let timers = setTimer.map { ($0, clearTimer ?? { _ in }) } ?? AdviserMainTimers.live()
    self.setTimer = timers.0
    self.clearTimer = timers.1
  }

  func set(_ patch: (inout StyleView) -> Void) {
    patch(&view)
    onChange?(view)
  }

  func stopTimers() {
    if let flip { clearTimer(flip) }
    flip = nil
  }

  /// Read the style. `guidance` is the writer's note, `previousSummary` the
  /// description to start from (a refine), `again` reads the posts again.
  public func start(sampleSize: JSONValue? = nil, guidance: String = "", previousSummary: String = "", again: Bool = false)
    async
  {
    run += 1
    let id = run
    let alive = { [weak self] in self?.run == id }
    stopTimers()
    controller?.abort()
    let signal = AdviserAbortSignal()
    controller = signal
    if again { texts = nil }
    let had = view.phase == "result" && !view.summary.isEmpty
    let have = texts.map { !$0.isEmpty } ?? false
    set {
      $0.phase = "working"
      $0.stage = have ? "read" : "gather"
      $0.postCount = have ? self.texts!.count : 0
      $0.error = nil
    }
    do {
      if !have {
        let got = try await fetchTexts(did, sampleSize, signal) { [weak self] posts in
          if alive() { self?.set { $0.postCount = posts } }
        }
        if !alive() { return }
        texts = got
        set {
          $0.stage = "read"
          $0.postCount = got.count
        }
      }
      flip = setTimer(StyleSessionWords.writeStageFlipMs) { [weak self] in
        if alive() { self?.set { $0.stage = "write" } }
      }
      let result = try await synthesize(requester, texts ?? [], guidance, previousSummary, signal)
      if !alive() { return }
      stopTimers()
      set {
        $0.phase = "result"
        $0.stage = "write"
        $0.summary = result.summary
        $0.analyzedCount = result.analyzedCount
        $0.updatedAt = result.updatedAt
        $0.usage = result.usage.truthy ?? $0.usage
        $0.fresh = true
      }
    } catch {
      let fields = AIErrorFields(error)
      if !alive() || error is CancellationError || fields.name == "AbortError" { return }
      stopTimers()
      let failure = StyleView.Failure(
        code: fields.code.truthy, message: StyleSessionWords.styleErrorMessage(fields.json))
      if fields.codeString == "monthly_limit" {
        let limit = fields.payload?["limit"].truthy ?? 3
        let used = fields.payload?["used"].nonNull ?? limit
        set { $0.usage = ["used": used, "limit": limit] }
      }
      set {
        $0.phase = had ? "result" : "error"
        $0.error = failure
      }
    }
  }

  /// The writer edited the description by hand.
  public func edit(_ summary: String) {
    set {
      $0.summary = summary
      $0.fresh = true
    }
  }

  /// Whether the posts are gathered.
  public var hasPosts: Bool { !(texts ?? []).isEmpty }

  /// The dialog closed: drop what's in flight and the posts.
  public func dispose() {
    run += 1
    stopTimers()
    controller?.abort()
    texts = nil
  }
}
