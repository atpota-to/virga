// Ports src/posting/adviser/useAdviserGate.js
//
// The post adviser in the composer: a thin observable model over
// AdviserGateController (gateController.js).
//
//   configure(did:settings:requester:canUseAi:onApplyFixes:)
//     did           the posting account (ComposerState.asDid; nil while the
//                   composer is closed)
//     settings      the account's posting settings' `adviser`
//     requester     backendFor(did), nil for an account that can't use AI
//     canUseAi      capabilitiesFor(did).canUseAi
//     onApplyFixes  each post's text by index (applyFixes(to:) dispatches them)
//   or configure(did:settings:session:onApplyFixes:) to read the last two
//   from the SessionModel, as Composer.jsx does.
//
// → enabled, check(state, mode:), busy (+ publishAnyway/keepEditing),
//   sheet (+ closeSheet/publishFromSheet/keepEditingFromSheet/saveDraftFromSheet/
//   applyFix), usageLine.
//
// `check` ends with 'publish' | 'edit' | 'draft' (AdviserGateController says
// when). Show the busy state while `busy` is set and the sheet while `sheet`
// is. Switching the posting account, or dispose() (the composer going
// away), ends a read or a sheet with 'edit'.

import Foundation
import Observation
import VirgaCore
import VirgaNetwork
import VirgaSession

@MainActor
@Observable
public final class AdviserGateModel {
  /// The busy state while a read runs (busyProps), or nil.
  public private(set) var busy: AdviserBusy?
  /// The sheet's read while it is open (sheetProps.read), or nil.
  public private(set) var sheet: AdviserSheetRead?
  /// Whether the adviser can be asked for this account.
  public private(set) var enabled = false
  /// The month's checks in a sentence, or '': read again after each request.
  public private(set) var usageLine = ""

  @ObservationIgnored public let controller: AdviserGateController
  @ObservationIgnored var usageVersion = 0
  @ObservationIgnored var did: String?

  /// A model over a controller with the app's defaults (the usage kept in
  /// `store`, the context read over `transport`), or over one you made.
  public init(controller: AdviserGateController? = nil, store: (any KeyValueStore)? = nil,
    transport: any HTTPTransport = HTTP.transport)
  {
    self.controller = controller ?? AdviserGateController(store: store, transport: transport)
    self.controller.onChange = { [weak self] view in self?.apply(view) }
    apply(self.controller.view)
  }

  func apply(_ view: AdviserView) {
    busy = view.busy
    sheet = view.sheet
    if view.usageVersion != usageVersion {
      usageVersion = view.usageVersion
      usageLine = controller.usageLine()
    }
  }

  /// The composer's latest props. A different account ends what's in
  /// progress, as the hook's effect does.
  public func configure(
    did: String?, settings: JSONValue?, requester: (any AIRequester)?, canUseAi: Bool,
    onApplyFixes: (@MainActor ([String]) -> Void)? = nil
  ) {
    controller.configure(did: did, settings: settings, requester: requester, canUseAi: canUseAi, onApplyFixes: onApplyFixes)
    enabled = AdviserGateRules.adviserGateEnabled(settings: settings, hasRequester: requester != nil, canUseAi: canUseAi)
    if !did.jsEquals(self.did) {
      self.did = did
      controller.cancel()
      usageLine = controller.usageLine()
    }
  }

  public func configure(
    did: String?, settings: AdviserSettings?, requester: (any AIRequester)?, canUseAi: Bool,
    onApplyFixes: (@MainActor ([String]) -> Void)? = nil
  ) {
    configure(did: did, settings: settings?.json, requester: requester, canUseAi: canUseAi, onApplyFixes: onApplyFixes)
  }

  /// configure from the session, as Composer.jsx does: the requester only
  /// for an account that can use AI.
  public func configure(
    did: String?, settings: AdviserSettings?, session: SessionModel,
    onApplyFixes: (@MainActor ([String]) -> Void)? = nil
  ) {
    let canUseAi = session.capabilitiesFor(did).canUseAi
    configure(
      did: did, settings: settings, requester: canUseAi ? session.backendFor(did) : nil, canUseAi: canUseAi,
      onApplyFixes: onApplyFixes)
  }

  /// The composer's onApplyFixes: each text that is a string goes to its
  /// post (`setText`).
  public static func applyFixes(to composer: ComposerStateModel) -> @MainActor ([String]) -> Void {
    { [weak composer] texts in
      for (index, text) in texts.enumerated() { composer?.dispatch(.setText(index: index, text: text)) }
    }
  }

  /// Check `state` before a publish (`mode: "gate"`) or from the "Check
  /// this post" button (`"manual"`).
  @discardableResult
  public func check(_ state: ComposerState, mode: String = "gate") -> AdviserCheck {
    controller.check(state, mode: mode)
  }

  @discardableResult
  public func check(_ state: JSONValue?, mode: String = "gate") -> AdviserCheck {
    controller.check(state, mode: mode)
  }

  // MARK: The busy state (busyProps)

  /// Whether the busy state offers "Publish anyway".
  public var canPublishAnyway: Bool { busy?.choices.contains(.publish) ?? false }

  public func publishAnyway() {
    guard canPublishAnyway else { return }
    controller.choose(.publish)
  }

  public func keepEditing() { controller.choose(.edit) }

  // MARK: The sheet (sheetProps)

  public var sheetOpen: Bool { sheet != nil }

  /// Closing the sheet is keep editing.
  public func closeSheet() { controller.decide(.edit) }

  public func keepEditingFromSheet() { controller.decide(.edit) }

  /// Publish from the sheet, where it offers that.
  public func publishFromSheet() {
    guard sheet?.canPublish == true else { return }
    controller.decide(.publish)
  }

  /// Save as a draft from the sheet, where it offers that.
  public func saveDraftFromSheet() {
    guard sheet?.canSaveDraft == true else { return }
    controller.decide(.draft)
  }

  @discardableResult
  public func applyFix(_ fixes: [AdviserSheetFix]) -> Int { controller.applyFix(fixes) }

  @discardableResult
  public func applyFix(_ fix: AdviserSheetFix) -> Int { controller.applyFix(fix) }

  /// The composer went away.
  public func dispose() { controller.cancel() }
}
