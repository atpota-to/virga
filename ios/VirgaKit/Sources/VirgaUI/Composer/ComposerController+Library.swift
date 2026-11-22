// Ports src/posting/composer/Composer.jsx (the library, templates and plans; continuing a thread)
//
// A "/" shortcut's template goes into the post where the shortcut was
// typed: its text, and what it attaches (a link card, or a post, feed or
// list it quotes). A template with blanks to fill opens the library on the
// web, where its questions are asked; the library's panel isn't ported, so
// the composer says so instead. Continue a thread picks one of the
// account's own recent posts (from the archive, else its author feed) and
// makes the post a reply to it.

#if canImport(UIKit)
import Foundation
import VirgaCore
import VirgaNetwork
import VirgaPosting

extension ComposerController {
  /// Templates with blanks to fill are filled in the library's panel.
  static let templateNeedsLibrary =
    "This template has blanks to fill in, which the library asks for. The library isn’t in the iOS app yet."

  /// The template context: who's being replied to, and the account's handle.
  func templateContext() -> TemplateContext {
    Library.libraryContext(state: state.json, selfHandle: account?.handle)
  }

  /// How often each template was used, for the slash menu's order.
  func templateUsage() -> TemplateUsageCounts {
    TemplateUsage.readTemplateUsage(asDid, store: store)
  }

  /// A template picked from the "/" menu, over the shortcut that named it.
  func applyTemplate(_ postId: String, _ template: PostTemplate, range: TextSelection?) {
    let context = templateContext()
    guard PostTemplates.templateQuestions(template, context).isEmpty else {
      notices.removeAll { $0.key == "template-library" }
      notices.append(ComposerNotice(key: "template-library", tone: .info, text: Self.templateNeedsLibrary))
      return
    }
    let plan = Library.applyPlanFor(Library.itemFromTemplate(template, context), context: context)
    Task { await applyPlan(plan, postId, range: range) }
  }

  /// `applyPlan(plan, postId, range)`: the plan's words at the range (or
  /// the end), then what it attaches.
  func applyPlan(_ plan: LibraryPlan, _ postId: String, range: TextSelection?) async {
    var index = indexOfPost(postId)
    if index < 0 { index = 0 }
    guard state.posts.indices.contains(index) else { return }
    let post = state.posts[index]
    let id = post.id
    if plan.insertText != nil || range != nil {
      let end = post.text.utf16.count
      let r = Library.insertText(post.text, plan.insertText, range ?? TextSelection(start: end, end: end))
      dispatch(.setText(index: index, text: r.text))
      pendingCaret[id] = r.caret
    }
    if let rkey = plan.templateRkey { _ = TemplateUsage.recordTemplateUse(rkey, state.asDid, store: store) }
    guard let attach = plan.attach else { return }
    if attach.isLink {
      await attachLink(attach, id)
    } else {
      await attachRecord(attach, id)
    }
  }

  private func current(_ id: String) -> PostDraft? {
    let at = indexOfPost(id)
    return at >= 0 ? state.posts[at] : nil
  }

  private func attachLink(_ attach: LibraryAttachment, _ id: String) async {
    guard let p = current(id) else { return }
    let url = attach.url ?? ""
    if !p.images.isEmpty || p.video != nil {
      mediaNote = "This post’s images take the attachment space, so a link card won’t show."
      return
    }
    if let card = p.card, !card.url.jsEquals(url) {
      let ok = await askUser(
        ComposerAsk(
          title: "Replace the link card?", body: "A post holds one link card, so this replaces the one already there.",
          choices: [.init(value: "keep", label: "Keep it"), .init(value: "replace", label: "Replace it", primary: true)]))
      guard ok == "replace" else { return }
    }
    cardLoading.insert(id)
    defer { cardLoading.remove(id) }
    let fetched = await ComposerLinkCards.fetchLinkCard(url, transport: transport)
    let card =
      fetched
      ?? ComposerCard(
        json: [
          "url": .string(url), "title": .string(attach.title ?? ""), "description": .string(attach.description ?? ""),
          "thumb": .null,
        ])
    let at = indexOfPost(id)
    if at >= 0 { dispatch(.setCard(index: at, card: card)) }
  }

  private func attachRecord(_ attach: LibraryAttachment, _ id: String) async {
    guard let p = current(id) else { return }
    if let record = p.record, !record.uri.jsEquals(attach.uri ?? "") {
      let ok = await askUser(
        ComposerAsk(
          title: "Replace what this post quotes?",
          body: "A post holds one quote or attachment, so this replaces the one already there.",
          choices: [.init(value: "keep", label: "Keep it"), .init(value: "replace", label: "Replace it", primary: true)]))
      guard ok == "replace" else { return }
    }
    recordLoading.insert(id)
    defer { recordLoading.remove(id) }
    do {
      let full = try await LibrarySources.hydrateAttachment(attach, transport: transport)
      let at = indexOfPost(id)
      if at >= 0 {
        dispatch(.setRecord(index: at, record: ComposerRecord(kind: full.kind, uri: full.uri ?? "", cid: full.cid, view: full.view)))
      }
    } catch {
      let pick = error as? LibraryPickError
      mediaNote = pick?.code == LibraryPickError.gone ? pick?.message ?? "" : "Couldn’t attach that from your library. Try again."
    }
  }

  // MARK: Continue a thread

  func openContinue() {
    dialog = .continueThread
    let did = state.asDid
    continueState = (status: "loading", items: [], error: "")
    let openArchive = self.openArchive
    let transport = self.transport
    Task {
      let rows = ComposerLoaders.continueCandidates(await LibrarySources.readArchivePosts(did, openStore: openArchive), did, limit: 6)
      var items: [JSONValue] = rows.map { r in
        ["uri": r["uri"] ?? .null, "at": r["at"] ?? .null, "text": r["text"] ?? .null]
      }
      if items.isEmpty {
        do {
          let page = try await LibrarySources.fetchOwnPosts(did, transport: transport)
          items = page.items.prefix(6).map { v in
            ["uri": v["uri"] ?? .null, "at": v["record"]?["createdAt"] ?? .null, "text": .string(v["record"]?["text"]?.stringValue ?? ""), "view": v]
          }
        } catch {
          self.continueState = (
            status: "error", items: [], error: "Couldn’t read your recent posts. Check your connection and try again."
          )
          return
        }
      }
      self.continueState = (status: "ready", items: items, error: "")
    }
  }

  func pickContinue(_ item: JSONValue) {
    dialog = nil
    let ref: JSONValue = ["kind": "post", "uri": item["uri"] ?? .null]
    replyRefPending = ref
    loadReply(ref)
  }
}
#endif
