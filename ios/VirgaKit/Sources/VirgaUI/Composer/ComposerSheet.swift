// Ports src/posting/composer/Composer.jsx (rendering)
// Ports src/posting/composer/composer.css (.composer-dialog, .composer, .composer-bar, .composer-busy, .composer-actions)
//
// The composer: one sheet for writing a post or a thread, as any of the
// accounts on this device. Its head is the title and Close; its body
// scrolls (who it goes out as, the notices, what it replies to, the
// posts, the post's settings, the busy line and the error); its foot holds
// the main button, under the thumb on a phone, with the post's own tools
// and why the button is off. Inside it nothing is a box but a field and
// what a post holds; the send button is ink.

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
      ComposerHead(title: title, phone: theme.isPhone) { controller.closeComposer() }
      ScrollView {
        ComposerBody(controller: controller)
          .padding(.horizontal, theme.isPhone ? ComposerMeasure.phoneSide : ComposerMeasure.side)
          .padding(.bottom, theme.space4)
      }
      .scrollDismissesKeyboard(.interactively)
      .sheet(item: $controller.dialog) { dialog in
        ComposerDialogView(controller: controller, dialog: dialog)
          .presentationDetents([.medium, .large])
          .presentationBackground(theme.surface)
          .presentationCornerRadius(Measure.Dialog.radius)
      }
      ComposerFoot(controller: controller)
    }
    .background(theme.surface)
    .overlay { ToastStack(center: toasts) }
    .sheet(item: $controller.ask, onDismiss: { if controller.askResolve != nil { controller.answer(nil) } }) { ask in
      ConfirmDialog(ask: ask) { controller.answer($0) }
        .presentationDetents([.medium])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

/// The sheet's head: the title, and Close (a phone's in words, at the left).
struct ComposerHead: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let phone: Bool
  let onClose: () -> Void

  var body: some View {
    HStack(spacing: theme.space3) {
      if phone {
        Button("Close", action: onClose)
          .buttonStyle(.virga(.ghost, size: .small))
          .accessibilityIdentifier("composer-close")
      }
      Text(title)
        .virgaText(.textLg, weight: VirgaWeight.semibold, tracking: Measure.Dialog.titleTracking)
        .foregroundStyle(theme.ink)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("composer-title")
      Spacer(minLength: 0)
      if !phone {
        Button(action: onClose) { Image(systemName: Glyph.close) }
          .buttonStyle(.virga(.ghost, size: .small, icon: true))
          .accessibilityLabel("Close")
          .accessibilityIdentifier("composer-close")
      }
    }
    .padding(phone ? Measure.Dialog.phoneHead : Measure.Dialog.head)
  }
}

/// What the sheet's body scrolls through.
struct ComposerBody: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

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
      if case .failed(let text, _)? = controller.loads["scheduled"] ?? controller.loads["draft"] {
        Callout(tone: .danger) {
          VStack(alignment: .leading, spacing: theme.space2) {
            Text(text)
            Button("Write a new post instead") { controller.startOver(confirm: false) }
              .buttonStyle(.virga(size: .small))
          }
        }
      } else {
        ComposerPosts(controller: controller, disabled: disabled)
        ComposerOptions(controller: controller, disabled: disabled)
      }
      ComposerStatus(controller: controller)
    }
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
    if let busy = controller.busy {
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
    let busy = controller.busy != nil
    let toolsIndex = min(controller.activeIndex, max(0, state.posts.count - 1))
    VStack(spacing: 0) {
      Rectangle().fill(theme.line).frame(height: 1)
      HStack(spacing: ComposerMeasure.actionsGap) {
        if theme.isPhone, state.posts.indices.contains(toolsIndex) {
          PostTools(controller: controller, post: state.posts[toolsIndex], disabled: controller.disabled)
        }
        Text(theme.isPhone && passing ? "" : why)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .frame(maxWidth: .infinity, alignment: .leading)
          .accessibilityIdentifier("composer-why")
        if also.contains(PublishActions.draft) {
          Button(ComposerActions.actionLabel(PublishActions.draft, state)) { controller.runAction(PublishActions.draft) }
            .buttonStyle(.virga(.ghost))
            .disabled(busy || model.actions.draft.disabled)
        }
        if also.contains(PublishActions.schedule) {
          Button {
            controller.runAction(PublishActions.schedule)
          } label: {
            Label(ComposerActions.actionLabel(PublishActions.schedule, state, short: true), systemImage: ComposerGlyph.schedule)
          }
          .buttonStyle(.virga)
          .disabled(busy || model.actions.schedule.disabled)
        }
        PublishButton(state: state, model: model, busy: busy, also: also) { controller.runAction($0) }
      }
      .padding(theme.isPhone ? ComposerMeasure.phoneFoot : ComposerMeasure.foot)
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
        DescribeDialog.altText(
          image: image,
          onSave: { alt in
            let index = controller.indexOfPost(postId)
            if index >= 0 { controller.dispatch(.updateImage(index: index, id: imageId, patch: ["alt": .string(alt)])) }
          }, onClose: close)
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
        did: controller.asDid, value: (controller.state.gates.reply, controller.state.gates.quotes),
        sourceLine: controller.gatesLine, transport: controller.transport,
        onSave: { reply, quotes in
          let gates: JSONValue = ["reply": reply.map(JSONValue.array) ?? .null, "quotes": .bool(quotes)]
          controller.dispatch(.setGates(gates))
        },
        onUseDefault: useDefault, onClose: close)
    case .timer:
      TimerDialog(note: "", onClose: close)
    }
  }
}
#endif
