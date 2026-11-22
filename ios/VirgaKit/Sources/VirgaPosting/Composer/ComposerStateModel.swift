// The composer's state as a model the SwiftUI composer binds to: what the
// web's Composer.jsx keeps with `useReducer(composerReducer, …)`, its
// autosave (an Autosaver fed on every change once the writer has written
// something) and the split button's facts. The reducer, the validation and
// the actions are ComposerModel's and ComposerActions' ports; this only
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

  /// `state` normalized; `autosaver`, when given, keeps every change.
  public init(_ state: ComposerState, autosaver: Autosaver? = nil) {
    self.state = ComposerModel.normalizeComposerState(state)
    self.autosaver = autosaver
  }

  /// A fresh composer for `asDid` with the account's `defaults`.
  public convenience init(asDid: String, defaults: JSONValue? = nil, autosaver: Autosaver? = nil) {
    self.init(ComposerModel.emptyComposerState(asDid: .string(asDid), defaults: defaults), autosaver: autosaver)
  }

  /// Runs one reducer action (the web's `dispatch`), and hands the result
  /// to the autosaver.
  public func dispatch(_ action: ComposerAction) {
    let next = ComposerModel.composerReducer(state, action)
    guard next != state else { return }
    state = next
    autosaver?.save(state.asDid, state.json, lifespanTouched: lifespanTouched)
  }

  /// Runs several actions in order.
  public func dispatch(_ actions: [ComposerAction]) {
    for action in actions { dispatch(action) }
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
