// Ports src/posting/composer/Composer.jsx (saveDraft, opening a draft, a posted draft's deletion)
//
// Bluesky's drafts, through VirgaPosting's Drafts: Save as draft writes the
// post as one (a new draft, or the one it was opened from), with its
// pictures and video kept on this device by DraftMedia over the app's file
// store; an intent's draftId opens one (listAllDrafts, openDraft, its media
// read back, the post it answers read again); and a draft that has been
// posted is deleted.

#if canImport(UIKit)
import Foundation
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

extension ComposerController {
  /// This device's draft media store for `did` (the web's IndexedDB store).
  func draftMedia(_ did: String) -> any DraftMediaStore {
    DraftMedia.openDraftMedia(did, storage: DraftMediaStorage(store: files, files: TemporaryComposerFiles()))
  }

  func saveDraft() async {
    let s = state
    let did = s.asDid
    error = nil
    let a = actionSet.actions.draft
    if a.disabled {
      error = ComposerErrorLine(text: a.reason ?? "")
      return
    }
    let attempt = startBusy(PublishActions.draft, "Saving the draft")
    defer { endBusy(attempt) }
    let defaultRule = defaultTimer.rule  // TIMER: what the toast compares the draft's timer with
    do {
      let agent = try await session.agentFor(did)
      let opts = DraftSaveOptions(
        device: .thisDevice(store: store), deviceName: Drafts.deviceNameDefault, media: draftMedia(did))
      let owner = s.source?.ownerDid ?? did
      let same = s.source?.kind == "draft" && owner.jsEquals(did)
      let id = s.source?.id?.stringValue
      let res: SavedDraft
      if same {
        res = try await Drafts.updateDraft(agent, id, s.json, opts)
      } else {
        res = try await Drafts.createDraft(agent, s.json, opts)
      }
      let saved = ComposerState(json: res.state)
      if state == s {
        loadState(saved, touched: model.lifespanTouched)
      } else {
        dispatch(.setSource(saved.source))
      }
      // TIMER: a draft keeps no timer; the toast says when the post had its own.
      var notes = [SelfDestruct.draftTimerNote(s.lifespan, model.lifespanTouched, defaultRule)].filter { !$0.isEmpty }
      if s.source?.kind == "scheduled" { notes.append("The scheduled copy is still in your queue.") }
      let label = ComposerSubmit.accountLabel(accountJSON(did), did)
      toasts.push("Draft saved to \(label)’s Bluesky drafts.\(notes.map { " \($0)" }.joined())", seconds: 7)
    } catch {
      let permission = Scopes.isMissingScopeError(error)
      if permission { permissionForced = true }
      let message = Self.optionalMessage(error)
      self.error = ComposerErrorLine(
        text: permission
          ? "Virga needs permission to save drafts. Sign in again to grant it." : message ?? "The draft couldn’t be saved. Try again.",
        permission: permission)
    }
  }

  /// An intent's draft: read from the account's drafts, opened into the
  /// composer with its media, and the post it answers read again.
  func openDraft(_ plan: ComposerIntentPlan, token: Int) {
    let owner = plan.draftOwnerDid ?? plan.asDid
    let session = self.session
    let media = draftMedia(owner)
    let transport = self.transport
    let defaults = settingsFor(owner).json
    Task {
      do {
        let loaded: DraftMedia.Loaded = try await ComposerLoaders.loadDraftTarget(
          draftId: plan.draftId.map(JSONValue.string), ownerDid: owner,
          agentFor: { did in try await session.agentFor(did) },
          listAllDrafts: { agent in try await Drafts.listAllDrafts(agent).drafts },
          openDraft: { view, did in
            await Drafts.openDraft(
              view, asDid: did, defaults: defaults, media: media,
              makePreviewUrl: Self.previewOfFile,
              fetchCard: Drafts.networkCardFetch(transport: transport))
          })
        guard self.loadToken == token else { return }
        let opened = ComposerState(json: loaded.state)
        self.loadState(opened)
        self.loads = [:]
        // A draft keeps only the reply's uri, cid and root; the post itself
        // is read again so the writer can see what they're answering.
        if let reply = opened.reply, !reply.uri.isEmpty, reply.author == nil {
          let ref: JSONValue = ["kind": "post", "uri": .string(reply.uri), "soft": true]
          self.replyRefPending = ref
          self.loadReply(ref, token: token)
        }
        let n = loaded.missing.count
        if n > 0 {
          self.notices.removeAll { $0.key == "missing-media" }
          self.notices.append(
            ComposerNotice(
              key: "missing-media", tone: .warn,
              text:
                "\(n == 1 ? "One image or video in this draft was" : "\(n) images or videos in this draft were") saved on another device. Add \(n == 1 ? "it" : "them") again here before posting."
            ))
        }
      } catch {
        guard self.loadToken == token else { return }
        self.loads["draft"] = .failed(Self.message(error), soft: false)
      }
    }
  }

  /// A file read back from the draft store is a temporary file: its preview is the file.
  static let previewOfFile: @Sendable (JSONValue) throws -> String? = { file in
    ComposerFile(json: file)?.ref.map { URL(fileURLWithPath: $0).absoluteString }
  }

  /// A restored post's images and video that live in this device's draft
  /// store (by localRef) are read back in, so they aren't asked for again.
  func fillMedia(_ kept: ComposerState, token: Int) {
    guard !DraftMedia.missingDraftMedia(kept.json).isEmpty else { return }
    loads["media"] = .loading
    let media = draftMedia(kept.asDid)
    Task {
      let filled = await DraftMedia.loadDraftMedia(kept.asDid, kept.json, media: media, makePreviewUrl: Self.previewOfFile)
      guard self.loadToken == token else { return }
      for action in ComposerRestore.mediaPatches(self.state.json, filled.state) { self.dispatch(action) }
      self.loads["media"] = nil
      let n = filled.missing.count
      guard n > 0 else { return }
      self.notices.removeAll { $0.key == "missing-media" }
      self.notices.append(
        ComposerNotice(
          key: "missing-media", tone: .warn,
          text:
            "\(n == 1 ? "One image or video in this post isn’t" : "\(n) images or videos in this post aren’t") in this browser any more. Add \(n == 1 ? "it" : "them") again before posting."
        ))
    }
  }

  /// After a post that came from a draft went out: the draft goes, and if it
  /// can't, the toast says so.
  func finishDraftSource(_ s: ComposerState) async {
    guard let source = s.source, source.kind == "draft", let id = source.id?.stringValue, !id.isEmpty else { return }
    let owner = source.ownerDid ?? s.asDid
    do {
      let agent = try await session.agentFor(owner)
      let refs = DraftMedia.stateLocalRefs(s.json).map(JSONValue.string)
      try await Drafts.deleteDraft(agent, id, localRefs: refs, media: draftMedia(owner))
    } catch {
      toasts.push(ComposerSubmit.draftNotDeleted, danger: true, seconds: 10)
    }
  }
}
#endif
