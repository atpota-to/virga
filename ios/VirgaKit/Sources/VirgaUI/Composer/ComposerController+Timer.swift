// Ports src/posting/composer/Composer.jsx (the timer: its fit, the default timer and lifespanTouched, timerNote, LifespanDialog's props, the "No free timer" question and immediateTimerProblem before a post goes out now, armAfterPublish after it has)
//
// A post's timer is the state's `lifespan`. Until the writer chooses one
// (`lifespanTouched`, ComposerStateModel's), the post takes the account's
// default timer (Settings › Posting), armed only when Virga's server says
// there's a free timer of its kind (ComposerDefaults.defaultTimerFor over
// the limits refreshLimits reads): ComposerBody runs `applyDefaultTimer`
// whenever the default or the loaded state changes, as the web's effect on
// [defaultTimer, generation] does. `timerNote` says why a post has no timer,
// or that the one chosen has no room.
//
// Posting now asks first when the timer chosen has no free timer of its
// kind (the limits read again): Keep editing, or Post without it. A set time
// already passed stops the post with its sentence; without Virga's server
// the post goes out with its timer off. Once it's out the timer is armed on
// the root post (the rest of a thread goes with it) through the timer
// service over the account's VirgaBackend, without holding the composer up;
// a toast says when it couldn't be, and the limits are read again.
//
// A scheduled post's timer goes with the post to Virga's server: that is
// submitSchedule's (ComposerController+Schedule.swift: its own "No free
// timer" question, scheduledTimerProblem, serializeForSchedule's fit). The
// lines that reach this file from elsewhere are marked TIMER.

#if canImport(UIKit)
import Foundation
import VirgaCore
import VirgaPosting
import VirgaSession

/// What the default timer's effect runs on: `[defaultTimer, generation]`.
struct ComposerDefaultTimerKey: Equatable {
  var timer: DefaultTimer
  var generation: Int
}

extension ComposerController {
  // MARK: What a timer can do on this post

  /// `fit`: composerTimerFit for this post (a reply's can't limit replies;
  /// without Virga's server there's no timer at all).
  var timerFit: TimerFit {
    SelfDestruct.composerTimerFit(unavailable: !caps.canSchedule, reply: state.reply != nil)
  }

  /// `defaultTimer`: the account's default timer, armed only when the
  /// limits show room for it. defaultTimerFor reads only the settings'
  /// `lifespan` and the fit's `available`.
  var defaultTimer: DefaultTimer {
    let limits = self.limits
    let fromSettings: JSONValue = ["lifespan": settings.lifespan.json]
    let fit: JSONValue = ["available": .bool(timerFit.available)]
    return ComposerDefaults.defaultTimerFor(
      fromSettings, canSchedule: caps.canSchedule, limitsStatus: limits.status, limits: limits.value, fit: fit)
  }

  var defaultTimerKey: ComposerDefaultTimerKey { ComposerDefaultTimerKey(timer: defaultTimer, generation: generation) }

  /// The effect: a post whose timer the writer hasn't chosen takes the default.
  func applyDefaultTimer() {
    guard !model.lifespanTouched else { return }
    let rule = defaultTimer.rule
    if !SelfDestruct.sameTimer(state.lifespan, rule) { dispatch(.setLifespan(rule.json)) }
  }

  /// `scheduledRowRef.current?.payload?.selfDestruct`: the timer the
  /// scheduled row this post was opened from already holds.
  var heldTimer: JSONValue? { scheduling.row?["payload"]?["selfDestruct"] }

  /// `timerNote`: why the default timer is off for this post; once the
  /// writer has chosen, that timers need the server, or that the one chosen
  /// has no free timer of its kind; else ''.
  var timerNote: String {
    if !model.lifespanTouched { return defaultTimer.note }
    let on = Self.lifespanOn(state)
    if on && !timerFit.available { return ComposerDefaults.timerNeedsServer }
    let limits = self.limits
    if on && limits.status == "ready" {
      return SelfDestruct.timerRoomProblem(state.lifespan, limits.value, holds: heldTimer)
    }
    return ""
  }

  // MARK: The dialog (LifespanDialog's props)

  /// `{ editingExisting: false, reply, thread }`.
  var timerDialogFit: LifespanEditorFit {
    LifespanEditorFit(editingExisting: false, reply: state.reply != nil, thread: state.posts.count > 1)
  }

  /// `state.schedule?.mode === 'at' ? state.schedule.at : undefined`.
  var timerPublishAt: String? { state.schedule?.mode == "at" ? state.schedule?.at : nil }

  /// The timer a scheduled post being edited already holds, else none.
  var timerDialogHolds: JSONValue? { state.source?.kind == "scheduled" ? heldTimer : nil }

  /// Done in the dialog: the writer has chosen this post's timer.
  func saveTimer(_ rule: JSONValue) {
    model.lifespanTouched = true
    dispatch(.setLifespan(rule))
  }

  // MARK: Posting now (submitPost's timer)

  /// `s.lifespan?.enabled`.
  static func lifespanOn(_ s: ComposerState) -> Bool { s.lifespan["enabled"]?.isTruthy ?? false }

  /// `{ ...lifespan, enabled: false }`.
  static func lifespanOff(_ lifespan: JSONValue) -> JSONValue {
    var members = lifespan.objectValue ?? [:]
    members["enabled"] = false
    return .object(members)
  }

  /// With the timer on and a server to arm it, the limits are read again;
  /// when there's no free timer of its kind the writer is asked. Nil is Keep
  /// editing (or the question gone); else the post, its timer off when they
  /// chose Post without it.
  func askNoFreeTimer(_ s: ComposerState, fit: TimerFit) async -> ComposerState? {
    guard Self.lifespanOn(s), fit.available else { return s }
    let fresh = await refreshLimits(s.asDid)
    let problem = fresh.map { SelfDestruct.timerRoomProblem(s.lifespan, $0) } ?? ""
    guard !problem.isEmpty else { return s }
    let choice = await askUser(
      ComposerAsk(
        title: "No free timer", body: "\(problem) \(ComposerDefaults.noFreeTimer)",
        choices: [
          .init(value: "edit", label: "Keep editing"), .init(value: "without", label: "Post without it", primary: true),
        ]))
    guard choice == "without" else { return nil }
    var out = s
    out.lifespan = Self.lifespanOff(s.lifespan)
    model.lifespanTouched = true
    dispatch(.setLifespan(out.lifespan))
    return out
  }

  /// Just before it goes: a set time that has already passed stops the
  /// post (its sentence thrown, said under it); without a server to arm it
  /// the post goes out with its timer off.
  func timerChecked(_ s: ComposerState, fit: TimerFit) throws -> ComposerState {
    guard Self.lifespanOn(s) else { return s }
    if fit.available {
      let problem = SelfDestruct.immediateTimerProblem(s.lifespan, now)
      if !problem.isEmpty { throw JSError(message: problem) }
      return s
    }
    var out = s
    out.lifespan = Self.lifespanOff(s.lifespan)
    return out
  }

  // MARK: After it went out

  /// The timer armed on what was just published, as the account in the
  /// root post's URI, with the fit as it is now. Not waited for: a toast
  /// says when it couldn't be set (or what was adjusted), and the limits
  /// are read again either way.
  func armAfterPublish(_ s: ComposerState, _ result: ComposerPublishResult) {
    guard Self.lifespanOn(s) else { return }
    let did = s.asDid
    let fitNow = SelfDestruct.composerTimerFit(unavailable: !session.capabilitiesFor(did).canSchedule, reply: s.reply != nil)
    let req = session.backendFor(TimerService.timerDidForUri(result.root["uri"]))
    let published: JSONValue = ["posts": .array(result.posts), "root": result.root]
    let rule = s.lifespan
    let snippet = TimerService.timerSnippet(s.posts.first?.text).map(JSONValue.string) ?? .null
    let postedAt = result.written.first?["record"]?["createdAt"]?.stringValue
    let at = now
    let toasts = self.toasts
    Task {
      let outcome = await TimerService.armAfterPublish(
        req, published, rule, snippet: snippet, postedAt: postedAt, fit: fitNow, now: at)
      Self.sayArmed(outcome, toasts: toasts)
      await self.refreshLimits(did)
    }
  }

  /// What the toast says once the timer has been tried.
  static func sayArmed(_ outcome: ArmOutcome, toasts: ToastCenter) {
    if outcome.status == "armed" {
      if !outcome.note.isEmpty { toasts.push(outcome.note) }
      return
    }
    let message = outcome.error?.message ?? ""
    let why = message.isEmpty ? "" : " \(message)"
    toasts.push(
      "Your post went out, but without its timer.\(why)", danger: true, seconds: Measure.Schedule.warningToastSeconds)
  }
}
#endif
