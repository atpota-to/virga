// Ports src/posting/composer/Composer.jsx (rendering)
// Ports src/posting/composer/composer.css (.composer-dialog, .composer, .composer-bar, .composer-busy, .composer-actions)
//
// The composer: one sheet for writing a post or a thread, as any of the
// accounts on this device. Wider than a phone, its head is the title and
// Close and its foot ends in the main button; on a phone (640 and under)
// the sheet fills the screen, with Close, its title and the send button in
// a bar held at the top, where the keyboard can't cover them. Its body
// scrolls (who it goes out as, the notices, what it replies to, the posts,
// the post's settings, the busy line and the error); the foot holds the
// post's own tools (760 and under), why the main button is off, and Save
// as draft and Schedule. Inside it nothing is a box but a field and what a
// post holds; the send button is ink.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting
import VirgaSession

struct ComposerSheet: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ToastCenter.self) private var toasts
  @Bindable var controller: ComposerController

  private var title: String {
    let state = controller.state
    if state.reply != nil { return "Reply" }
    if state.source?.kind == "scheduled" { return "Scheduled post" }
    if state.source?.kind == "draft" { return "Draft" }
    return state.posts.count > 1 ? "New thread" : "New post"
  }

  var body: some View {
    VStack(spacing: 0) {
      if theme.composerNarrow {
        ComposerBar(controller: controller, title: title)
      } else {
        ComposerHead(title: title) { controller.closeComposer() }
      }
      ScrollView {
        ComposerBody(controller: controller)
          .padding(.horizontal, theme.composerNarrow ? ComposerMeasure.phoneSide : ComposerMeasure.side)
          .padding(.bottom, theme.space4)
      }
      .scrollDismissesKeyboard(.interactively)
      .sheet(item: $controller.dialog) { dialog in
        ComposerDialogView(controller: controller, dialog: dialog)
          .presentationDetents(dialog.isTall ? [.large] : [.medium, .large])
          .presentationBackground(theme.surface)
          .presentationCornerRadius(Measure.Dialog.radius)
      }
      ComposerFoot(controller: controller)
    }
    .background(theme.surface)
    .overlay { ToastStack(center: toasts) }
    // ADVISER: the adviser's sheet, and its account while the composer is open.
    .adviserSheet(controller.adviser)
    .onAppear { controller.configureAdviser(open: true) }
    .onDisappear { controller.configureAdviser(open: false) }
    .onChange(of: controller.asDid) { _, _ in controller.configureAdviser(open: true) }
    .sheet(item: $controller.ask, onDismiss: { if controller.askResolve != nil { controller.answer(nil) } }) { ask in
      ConfirmDialog(ask: ask) { controller.answer($0) }
        .presentationDetents([.medium])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

/// A wider window's head: the dialog's title and its Close.
struct ComposerHead: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let onClose: () -> Void

  var body: some View {
    HStack(spacing: theme.space3) {
      Text(title)
        .virgaText(.textLg, weight: VirgaWeight.semibold, tracking: Measure.Dialog.titleTracking)
        .foregroundStyle(theme.ink)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("composer-title")
      Spacer(minLength: 0)
      Button(action: onClose) { Image(systemName: Glyph.close) }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .accessibilityLabel("Close")
        .accessibilityIdentifier("composer-close")
    }
    .padding(Measure.Dialog.head)
  }
}

/// A phone's bar (`.composer-bar`), in the dialog head's place and held at
/// the top, where the keyboard can't cover it: Close, the title, and the
/// send button.
struct ComposerBar: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let title: String

  var body: some View {
    let model = controller.actionSet
    HStack(spacing: ComposerMeasure.barGap) {
      Button("Close") { controller.closeComposer() }
        .buttonStyle(.plain)
        .virgaText(.textBase, weight: VirgaWeight.medium)
        .foregroundStyle(theme.ink)
        .frame(minHeight: ComposerMeasure.barCloseHeight)
        .contentShape(Rectangle())
        .accessibilityIdentifier("composer-close")
      Text(title)
        .virgaText(.textBase, weight: VirgaWeight.semibold)
        .foregroundStyle(theme.ink)
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("composer-title")
      PublishButton(
        state: controller.state, model: model, busy: controller.sendBusy, also: controller.also,  // ADVISER: sendBusy
        footnote: controller.usageLine.isEmpty ? "" : "\(controller.usageLine).",  // SCHEDULE
        onAction: { controller.runAction($0) })
    }
    .frame(minHeight: ComposerMeasure.barHeight)
    .padding(ComposerMeasure.bar)
    .background(theme.surface)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("composer-bar")
  }
}

/// What the sheet's body scrolls through.
struct ComposerBody: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

  /// A draft or a scheduled post that couldn't be opened.
  private var loadError: String? {
    if case .failed(let text, _)? = controller.loads["scheduled"] ?? controller.loads["draft"] { return text }
    return nil
  }

  var body: some View {
    let state = controller.state
    let disabled = controller.disabled
    VStack(alignment: .leading, spacing: ComposerMeasure.gap) {
      PostAsPicker(
        asDid: controller.asDid, locked: state.source?.kind == "scheduled",
        lockedReason: "A scheduled post stays with the account that scheduled it.", disabled: disabled
      ) { controller.changeAsDid($0) }
      ComposerAccountNotice(controller: controller)
      ComposerNotices(controller: controller)
      ComposerSourceWarning(controller: controller)  // SCHEDULE
      if let loadError {
        Callout(tone: .danger) {
          VStack(alignment: .leading, spacing: theme.space2) {
            Text(loadError)
            Button("Write a new post instead") { controller.startOver(confirm: false) }
              .buttonStyle(.virga(size: .small))
          }
        }
      } else if controller.loads["draft"] == .loading || controller.loads["scheduled"] == .loading {
        // The composer's shape while a draft or a scheduled post is read (ComposerSkeleton).
        LibrarySkeleton(rows: 3)
          .accessibilityElement()
          .accessibilityLabel(controller.loads["scheduled"] != nil ? "Opening the scheduled post" : "Opening the draft")
          .accessibilityIdentifier("composer-skeleton")
      } else {
        ComposerPosts(controller: controller, disabled: disabled)
        ComposerOptions(controller: controller, disabled: disabled)
        ComposerWhenPanel(controller: controller, disabled: disabled)  // SCHEDULE
      }
      ComposerStatus(controller: controller)
    }
    // SCHEDULE: the account's limits, read as it opens and for each account it goes out as.
    .task(id: controller.asDid) { await controller.refreshLimits(controller.asDid) }
  }
}

/// A signed-out account, or one without the permission to post.
struct ComposerAccountNotice: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

  var body: some View {
    if controller.signedOut {
      Callout(tone: .warn) {
        VStack(alignment: .leading, spacing: theme.space2) {
          Text("This account is signed out. Sign back in to post as it, or choose another account.")
          Button("Sign back in") { AccountCopy.requestReauth(controller.asDid, immediate: true) }
            .buttonStyle(.virga(size: .small))
        }
      }
    } else {
      PostingPermissionNotice(did: controller.asDid, force: controller.permissionForced)
    }
  }
}

/// The notices over the post, each with its way on and Dismiss.
struct ComposerNotices: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

  var body: some View {
    ForEach(controller.notices) { notice in
      Callout(tone: notice.tone == .warn ? .warn : .plain) {
        HStack(alignment: .top, spacing: theme.space2) {
          VStack(alignment: .leading, spacing: theme.space2) {
            Text(notice.text)
            if let label = notice.actionLabel, let action = notice.action {
              Button(label, action: action).buttonStyle(.virga(size: .small))
            }
          }
          Spacer(minLength: 0)
          Button {
            controller.notices.removeAll { $0.key == notice.key }
          } label: {
            Image(systemName: Glyph.close)
          }
          .buttonStyle(.virga(.ghost, size: .small, icon: true))
          .accessibilityLabel("Dismiss")
        }
      }
      .accessibilityIdentifier("composer-notice")
    }
  }
}

/// What it replies to, the step back from a split, the posts, and adding one.
struct ComposerPosts: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let disabled: Bool

  private var replyError: String {
    if case .failed(let text, _)? = controller.loads["reply"] { return text }
    return ""
  }

  private var quoteError: String? {
    if case .failed(let text, _)? = controller.loads["quote"] { return text }
    return nil
  }

  var body: some View {
    let state = controller.state
    let replyLoad = controller.loads["reply"]
    let replyLoading = replyLoad == .loading || replyLoad == .softLoading
    VStack(alignment: .leading, spacing: ComposerMeasure.gap) {
      ReplyContext(
        reply: state.reply, selfDid: controller.asDid, loading: replyLoading, error: replyError, disabled: disabled,
        onRetry: { controller.retryReply() }, onRemove: { controller.dropReply() })
      if let quoteError {
        Callout(tone: .warn) { Text(quoteError) }
      }
      if controller.undoable, let undo = controller.threadUndo {
        Callout {
          HStack(spacing: theme.space2) {
            Text(ThreadEdits.undoLine(undo, fmt: { AppLocale.fmtInt(Double($0)) }))
            Spacer(minLength: 0)
            Button("Undo") { controller.undoThreadEdit() }
              .buttonStyle(.virga(size: .small))
              .disabled(disabled)
              .keyboardShortcut("z", modifiers: .command)
            Button {
              controller.threadUndo = nil
            } label: {
              Image(systemName: Glyph.close)
            }
            .buttonStyle(.virga(.ghost, size: .small, icon: true))
            .accessibilityLabel("Dismiss")
          }
        }
      }
      VStack(alignment: .leading, spacing: state.posts.count > 1 ? 0 : ComposerMeasure.blocksGap) {
        ForEach(Array(state.posts.enumerated()), id: \.element.id) { index, post in
          PostBlock(controller: controller, post: post, index: index, total: state.posts.count, disabled: disabled)
        }
      }
      if ThreadSplit.threadNumbering(state.posts.map(\.text)) == .stale {
        HStack(spacing: theme.space2) {
          FieldHint("These posts are numbered, and the numbers no longer match their order.")
          Button("Renumber") { controller.renumber() }.buttonStyle(.linkAction).disabled(disabled)
        }
      }
      if state.posts.count < ComposerModel.maxPosts {
        Button {
          controller.addPost()
        } label: {
          Label("Add a post to the thread", systemImage: ComposerGlyph.plus)
        }
        .buttonStyle(.linkAction)
        .disabled(disabled)
        .accessibilityIdentifier("add-post")
      }
      if !controller.mediaNote.isEmpty {
        Callout(tone: .warn) { Text(controller.mediaNote) }
      }
    }
  }
}

/// The busy line while it sends, and the error when it couldn't.
struct ComposerStatus: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

  var body: some View {
    // ADVISER: while it reads, its line in the busy line's place.
    if let reading = controller.adviser.busy {
      AdviserBusyLine(
        busy: reading, onPublishAnyway: controller.adviser.canPublishAnyway ? { controller.adviser.publishAnyway() } : nil,
        onKeepEditing: { controller.adviser.keepEditing() })
    }
    if let busy = controller.busy, !busy.adviser {
      VStack(alignment: .leading, spacing: theme.space2) {
        ProgressLine(value: nil)
        HStack(spacing: ComposerMeasure.busyGap) {
          Text(busy.slow ? ComposerSubmit.slowPublishNote : busy.line ?? "Working…")
            .virgaText(.textSm)
            .foregroundStyle(theme.ink2)
            .accessibilityIdentifier("composer-busy")
          Spacer(minLength: 0)
          if busy.cancellable {
            Button("Cancel") { controller.cancelPublish() }.buttonStyle(.virga(.ghost, size: .small))
          }
        }
      }
      .accessibilityElement(children: .contain)
    }
    if let error = controller.error {
      Callout(tone: .danger) {
        VStack(alignment: .leading, spacing: theme.space2) {
          Text(error.text).accessibilityIdentifier("composer-error")
          if error.reauth {
            Button("Sign back in") { AccountCopy.requestReauth(controller.asDid, immediate: true) }
              .buttonStyle(.virga(size: .small))
          }
        }
      }
    }
  }
}

/// The foot: the post's tools (a phone's), why the main button is off, the
/// ways that have a button of their own, and the main button.
struct ComposerFoot: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

  var body: some View {
    let state = controller.state
    let model = controller.actionSet
    let primary = model.actions[model.primary]
    let primaryReason = primary.disabled ? primary.reason ?? "" : ""
    let passing = primaryReason.isEmpty || composerPassingBlocks.contains(primaryReason)
    let why =
      controller.busy != nil
      ? "" : !primaryReason.isEmpty ? primaryReason : model.draftFallback ? "Over 300 characters: it can be saved as a draft." : ""
    let also = controller.also
    let busy = controller.sendBusy  // ADVISER
    let toolsIndex = min(controller.activeIndex, max(0, state.posts.count - 1))
    let narrow = theme.composerNarrow
    VStack(spacing: 0) {
      Rectangle().fill(theme.line).frame(height: 1)
      HStack(spacing: ComposerMeasure.actionsGap) {
        if theme.composerToolsInFoot, state.posts.indices.contains(toolsIndex) {
          PostTools(controller: controller, post: state.posts[toolsIndex], disabled: controller.disabled)
        }
        Text(narrow && passing ? "" : why)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .frame(maxWidth: .infinity, alignment: .leading)
          .accessibilityIdentifier("composer-why")
        if also.contains(PublishActions.draft) {
          Button(ComposerActions.actionLabel(PublishActions.draft, state)) { controller.runAction(PublishActions.draft) }
            .buttonStyle(.virga(.ghost))
            .disabled(busy || model.actions.draft.disabled)
            .accessibilityIdentifier("save-draft")
        }
        if also.contains(PublishActions.schedule) {
          Button {
            controller.runAction(PublishActions.schedule)
          } label: {
            Label(ComposerActions.actionLabel(PublishActions.schedule, state, short: true), systemImage: ComposerGlyph.schedule)
          }
          .buttonStyle(.virga)
          .disabled(busy || model.actions.schedule.disabled)
          .accessibilityIdentifier("composer-schedule")
        }
        // On a phone the main button is in the bar at the top of the sheet.
        if !narrow {
          PublishButton(
            state: state, model: model, busy: busy, also: also,
            footnote: controller.usageLine.isEmpty ? "" : "\(controller.usageLine).",  // SCHEDULE
            onAction: { controller.runAction($0) })
        }
      }
      .padding(narrow ? ComposerMeasure.phoneFoot : ComposerMeasure.foot)
    }
    .background(theme.surface)
  }
}

/// The small dialog that's up.
struct ComposerDialogView: View {
  let controller: ComposerController
  let dialog: ComposerDialog

  /// "Use my default", while the post's reply settings are its own.
  private var useDefault: (() -> Void)? {
    guard controller.state.gates.custom else { return nil }
    let controller = self.controller
    return {
      controller.dialog = nil
      controller.useDefaultGates()
    }
  }

  var body: some View {
    let close = { controller.dialog = nil }
    switch dialog {
    case .alt(let postId, let imageId):
      if let post = controller.state.posts.first(where: { $0.id.jsEquals(postId) }),
        let image = post.images.first(where: { $0.id.jsEquals(imageId) })
      {
        let save = { (alt: String) in
          let index = controller.indexOfPost(postId)
          if index >= 0 { controller.dispatch(.updateImage(index: index, id: imageId, patch: ["alt": .string(alt)])) }
        }
        // ADVISER: with a requester that can use AI, the dialog that can
        // describe and revise (Adviser/AltTextDialog.swift).
        if controller.caps.canUseAi, let requester = controller.session.backendFor(controller.asDid) {
          AltTextDialog(
            image: image, requester: requester, did: controller.asDid, context: post.text, store: controller.store,
            onSave: save, onClose: close)
        } else {
          DescribeDialog.altText(image: image, onSave: save, onClose: close)
        }
      }
    case .videoAlt(let postId):
      let post = controller.state.posts.first { $0.id.jsEquals(postId) }
      DescribeDialog.videoAlt(
        alt: post?.video?.alt ?? "",
        onSave: { alt in
          let index = controller.indexOfPost(postId)
          guard index >= 0, let video = controller.state.posts[index].video else { return }
          var json = video.json.objectValue ?? [:]
          json["alt"] = .string(alt)
          controller.dispatch(.setVideo(index: index, video: ComposerVideo(json: .object(json))))
        }, onClose: close)
    case .card(let postId):
      if let card = controller.state.posts.first(where: { $0.id.jsEquals(postId) })?.card {
        LinkCardDialog(
          card: card, transport: controller.transport,
          onSave: { next in
            let index = controller.indexOfPost(postId)
            if index >= 0 { controller.dispatch(.setCard(index: index, card: next)) }
          }, onClose: close)
      }
    case .meta:
      MetaDialog(
        langs: controller.state.langs, labels: controller.state.labels,
        onSave: { langs, labels in
          controller.dispatch(.setLangs(langs))
          controller.dispatch(.setLabels(labels))
        }, onClose: close)
    case .gates:
      GatesDialog(
        did: controller.asDid, value: (reply: controller.state.gates.reply, quotes: controller.state.gates.quotes),
        sourceLine: controller.gatesLine, transport: controller.transport,
        onSave: { reply, quotes in
          let gates: JSONValue = ["reply": reply.map(JSONValue.array) ?? .null, "quotes": .bool(quotes)]
          controller.dispatch(.setGates(gates))
        },
        onUseDefault: useDefault, onClose: close)
    case .timer:
      TimerDialog(note: "", onClose: close)
    case .continueThread:
      ContinueThreadDialog(
        status: controller.continueState.status, items: controller.continueState.items,
        error: controller.continueState.error, onPick: { controller.pickContinue($0) },
        onRetry: { controller.openContinue() }, onClose: close)
    case .library(let request):
      LibraryDialog(controller: controller, request: request, onClose: close)
    case .saveTemplate:
      TemplateEditorForm(
        did: controller.asDid, template: nil, seed: controller.templateSeed, onClose: close, onSaved: nil, onDeleting: nil)
    }
  }
}
#endif
