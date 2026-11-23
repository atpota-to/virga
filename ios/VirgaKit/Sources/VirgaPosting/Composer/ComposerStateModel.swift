// The composer's state as a model the SwiftUI composer binds to: what the
// web's Composer.jsx keeps with `useReducer(composerReducer, …)`, its
// autosave (the effect that feeds createAutosaver and saveSessionDraft on
// every change) and the split button's facts. The reducer, the validation
// and the actions are ComposerModel's and ComposerActions' ports; this only
// holds the state and hands each change to them. (Composer.jsx itself is
// VirgaUI's.)

import Foundation
import Observation
import VirgaCore

@MainActor @Observable
public final class ComposerStateModel {
  /// The state on screen.
  public private(set) var state: ComposerState
  /// Whether the writer chose this post's timer themselves (kept beside it).
  public var lifespanTouched = false

  @ObservationIgnored let autosaver: Autosaver?
  @ObservationIgnored let now: () -> Double
  @ObservationIgnored let session: AutosaveSession
  /// The accounts this composer has written something for since the last
  /// load (Composer.jsx's `wroteFor`). An empty state only clears an entry
  /// the composer wrote itself, so opening, or switching to, an account with
  /// nothing on screen never wipes what was kept for it.
  @ObservationIgnored var wroteFor = Set<JSKey>()

  /// `state` normalized; `autosaver`, when given, keeps every change, and
  /// the session layer (`session`, stamped with `now`) keeps it with its
  /// files. As the web's effect does on mount, a state that holds something
  /// is kept at once.
  public init(
    _ state: ComposerState, autosaver: Autosaver? = nil,
    now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }, session: AutosaveSession = .shared
  ) {
    self.state = ComposerModel.normalizeComposerState(state)
    self.autosaver = autosaver
    self.now = now
    self.session = session
    keep()
  }

  /// A fresh composer for `asDid` with the account's `defaults`.
  public convenience init(
    asDid: String, defaults: JSONValue? = nil, autosaver: Autosaver? = nil,
    now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }, session: AutosaveSession = .shared
  ) {
    self.init(
      ComposerModel.emptyComposerState(asDid: .string(asDid), defaults: defaults), autosaver: autosaver, now: now,
      session: session)
  }

  /// Runs one reducer action (the web's `dispatch`), and keeps the result.
  public func dispatch(_ action: ComposerAction) {
    let next = ComposerModel.composerReducer(state, action)
    guard next != state else { return }
    countTextChanges(from: state, to: next)
    state = next
    keep()
  }

  /// A post's field handing on what was typed into it (`setText` for that
  /// post): the one change to a post's text that `textChangeCount` doesn't
  /// count.
  public func typed(index: Int, text: String) {
    let next = ComposerModel.composerReducer(state, .setText(index: index, text: text))
    guard next != state else { return }
    state = next
    keep()
  }

  /// How many times this post's text has been changed by anything but its
  /// own field: every dispatch and load that changes it, whoever calls (a
  /// template, a mention picked, a link pasted or stripped, a thread split
  /// or undone, the adviser's fixes, a draft or a new composer loaded). The
  /// iOS post editor puts the post's text in its field only when this has
  /// moved since the two last agreed; otherwise the field is ahead of the
  /// post, not wrong (CI run 90: a letter reached the field before the post,
  /// and putting the post's text back put the caret in front of it). The web
  /// has no counterpart: its textarea is the post's text.
  public func textChangeCount(_ postId: String) -> Int { textChanges[JSKey(postId)] ?? 0 }

  @ObservationIgnored private var textChanges: [JSKey: Int] = [:]

  /// Counts each post of `next` whose text isn't what it was in `previous`
  /// (a new post counts).
  private func countTextChanges(from previous: ComposerState, to next: ComposerState) {
    var before: [JSKey: String] = [:]
    for post in previous.posts { before[JSKey(post.id)] = post.text }
    for post in next.posts where !before[JSKey(post.id)].jsEquals(post.text) {
      textChanges[JSKey(post.id), default: 0] += 1
    }
  }

  /// Runs several actions in order.
  public func dispatch(_ actions: [ComposerAction]) {
    for action in actions { dispatch(action) }
  }

  /// The writer chose this post's timer (Composer.jsx's
  /// `lifespanTouched.current = true` then `setLifespan`). The choice is kept
  /// with the post at once even when the rule is the one it had, as the web's
  /// reducer hands its autosave a new state either way.
  public func chooseLifespan(_ rule: JSONValue) {
    lifespanTouched = true
    let next = ComposerModel.composerReducer(state, .setLifespan(rule))
    if next != state { state = next }
    keep()
  }

  /// Puts `next` on screen in place of what is there (Composer.jsx's
  /// `loadState`): whatever was waiting to be written belonged to the state
  /// it replaces, which the caller has kept, set aside or cleared by now.
  public func load(_ next: ComposerState, touched: Bool = false) {
    autosaver?.cancel()
    wroteFor = []
    lifespanTouched = touched
    state = ComposerModel.composerReducer(state, .load(next))
    for post in state.posts { textChanges[JSKey(post.id), default: 0] += 1 }
    keep()
  }

  /// The web's autosave effect: a state with something in it is written for
  /// its account (debounced) and kept in the session layer; an empty one
  /// only for an account this composer wrote for, which clears it there.
  func keep() {
    let did = state.asDid
    if did.isEmpty { return }
    if Autosave.hasAutosaveContent(state) {
      wroteFor.insert(JSKey(did))
    } else if wroteFor.remove(JSKey(did)) == nil {
      return
    }
    autosaver?.save(did, state.json, lifespanTouched: lifespanTouched)
    Autosave.saveSessionDraft(did, state.json, now: now(), lifespanTouched: lifespanTouched, session: session)
  }

  /// What stops this post from going out now (or at its scheduled time).
  public func problems(
    now: Date, forSchedule: Bool = false, requireAltText: Bool = false,
    lifespanProblem: ((JSONValue) -> String?)? = nil, timeZone: TimeZone? = nil
  ) -> [ComposerProblem] {
    ComposerModel.validateComposer(
      state, now: now, forSchedule: forSchedule, requireAltText: requireAltText, lifespanProblem: lifespanProblem,
      timeZone: timeZone)
  }

  /// The split button for this post (ComposerActions.composerActions).
  public func actions(
    defaultAction: String?, queue: JSONValue?, caps: ComposerCaps, signedOut: Bool = false,
    missingMedia: Bool = false, postNow: Bool = false, authMode: String = "backend"
  ) -> ComposerActionSet {
    ComposerActions.composerActions(
      state, defaultAction: defaultAction, queue: queue, caps: caps, signedOut: signedOut, missingMedia: missingMedia,
      postNow: postNow, authMode: authMode)
  }

  /// Whether there is nothing in it.
  public var isEmpty: Bool { ComposerModel.isEmptyComposer(state) }

  /// Drops a write still waiting (after a publish).
  public func cancelAutosave() { autosaver?.cancel() }
}
