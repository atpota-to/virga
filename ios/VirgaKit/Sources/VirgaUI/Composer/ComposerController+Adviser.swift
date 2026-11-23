// Ports src/posting/composer/Composer.jsx (the post adviser: useAdviserGate, the check before sending, Check this post)
//
// The post adviser in the composer, as Composer.jsx has it, over
// VirgaPosting's AdviserGateModel (the controller's `adviser`):
//
//   - configured for the posting account while the composer is open, with
//     the account's adviser settings and, for an account that can use AI,
//     its requester; closed, it has no account, which ends a read or a
//     sheet in progress;
//   - the check before sending (`check(state, mode: "gate")`): the busy
//     line gives way to the adviser's, then says "Getting it ready" again;
//     Keep editing stops the send, Save as draft saves it, and a fix taken
//     from the sheet is checked again before it goes;
//   - Check this post (`mode: "manual"`), whose decision publishes, saves a
//     draft, or goes back to the post;
//   - while a read runs the post is held still (`disabled`) and the send
//     button is busy (`sendBusy`).
//
// The composer's own files carry small marked edits that call these
// (ADVISER in ComposerController.swift, ComposerController+Actions.swift,
// ComposerSheet.swift and ComposerOptions.swift).

#if canImport(UIKit)
import Foundation
import VirgaCore
import VirgaPosting
import VirgaSession

extension ComposerController {
  /// A read by the adviser holds the post still too: a fix it offers is
  /// made against the text it read.
  var adviserReading: Bool { adviser.busy != nil }

  /// `sendBusy`: the send button is busy while it sends or the adviser reads.
  var sendBusy: Bool { busy != nil || adviserReading }

  /// `useAdviserGate({ did: open ? asDid : null, settings, requester, canUseAi, onApplyFixes })`.
  func configureAdviser(open: Bool) {
    let did: String? = open && !asDid.isEmpty ? asDid : nil
    adviser.configure(
      did: did, settings: did.map { settingsFor($0).adviser }, session: session,
      onApplyFixes: AdviserGateModel.applyFixes(to: model))
  }

  /// The check before sending, inside submitPost once its own checks have
  /// passed: the state to send (a fix taken from the sheet included), or
  /// nil when the send stops here (Keep editing, a draft saved instead, or a
  /// fix that left the post too long).
  func adviserGate(_ s: ComposerState, attempt: Int) async -> ComposerState? {
    guard adviser.enabled else { return s }
    busy?.line = nil
    busy?.adviser = true
    let decision = await adviser.check(s, mode: "gate").decision
    if self.attempt == attempt, busy != nil {
      busy?.adviser = false
      busy?.line = "Getting it ready"
    }
    switch decision {
    case .edit:
      refocusAfterAdviser()
      return nil
    case .draft:
      endBusy(attempt)
      runAction(PublishActions.draft)
      return nil
    case .publish:
      // A fix taken from the sheet changed the text, so it is checked again:
      // a fix can make a post too long.
      var next = state
      next.json["lifespan"] = s.lifespan
      let after = model.problems(now: Date(), requireAltText: settings.requireAltText, lifespanProblem: { _ in "" })
      if let first = after.first {
        error = ComposerErrorLine(text: first.message)
        if let index = first.postIndex, state.posts.indices.contains(index) { focusPostId = state.posts[index].id }
        return nil
      }
      return next
    }
  }

  /// Check this post: the adviser's read of the post as it is now.
  func askAdviser() {
    Task { @MainActor in
      let decision = await adviser.check(state, mode: "manual").decision
      switch decision {
      case .publish: publishTask = Task { await submitPost(skipAdviser: true) }
      case .draft: runAction(PublishActions.draft)
      case .edit: refocusAfterAdviser()
      }
    }
  }

  /// Back from the adviser to keep editing: the button that started the
  /// check was off while it ran, so the caret goes back to the post.
  func refocusAfterAdviser() {
    let index = min(activeIndex, state.posts.count - 1)
    guard index >= 0 else { return }
    focusPostId = state.posts[index].id
  }
}
#endif
