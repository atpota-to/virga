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

extension ComposerController {
  /// A draft or a scheduled post that couldn't be opened.
  var loadError: String? {
    if case .failed(let text, _)? = loads["scheduled"] ?? loads["draft"] { return text }
    return nil
  }

  /// The post the foot's tools add to: the one being written in.
  var toolsIndex: Int { min(activeIndex, max(0, state.posts.count - 1)) }

  /// The foot's tools are there for a post that's on screen: not while a
  /// draft or a scheduled post is opening, nor when it couldn't be opened.
  var footToolsShown: Bool {
    state.posts.indices.contains(toolsIndex) && loadError == nil && loads["scheduled"] != .loading
      && loads["draft"] != .loading
  }
}

/// What the web marks role="status", role="alert" or aria-live, read out to
/// VoiceOver as it appears or changes.
enum ComposerAnnounce {
  static func post(_ text: String?) {
    guard let text, !text.isEmpty else { return }
    UIAccessibility.post(notification: .announcement, argument: text)
  }
}

/// `role="status"`: the words read out when they appear and when they change.
struct ComposerAnnounces: ViewModifier {
  let text: String

  func body(content: Content) -> some View {
    content
      .onAppear { ComposerAnnounce.post(text) }
      .onChange(of: text) { _, next in ComposerAnnounce.post(next) }
  }
}

extension View {
  func composerAnnounces(_ text: String) -> some View {
    modifier(ComposerAnnounces(text: text))
  }
}

/// A callout's words, and its buttons at the right (`.callout-actions {
/// margin-left: auto; gap: 6px }`): a notice and the error centre them on
/// the words, the others hang them from the top.
struct ComposerCalloutLine<Actions: View>: View {
  @Environment(\.virgaTheme) private var theme
  let text: String
  var centred = false
  let actions: Actions

  init(_ text: String, centred: Bool = false, @ViewBuilder actions: () -> Actions) {
    self.text = text
    self.centred = centred
    self.actions = actions()
  }

  var body: some View {
    HStack(alignment: centred ? .center : .top, spacing: theme.points(ThemeKit.calloutGap)) {
      Text(text).frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: ComposerMeasure.calloutActionsGap) { actions }
        .fixedSize()
    }
  }
}

struct ComposerSheet: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ToastCenter.self) private var toasts
  @Bindable var controller: ComposerController
  /// A drag of files is over the composer (`dragOver`).
  @State private var dropOver = false

  /// The caret in the first post, 40 ms after it's drawn, on a wide screen,
  /// while nothing else has it (the web's check that focus is idle): a
  /// window resized while a later post is being written leaves it there.
  private func focusFirstPost() {
    guard !theme.composerNarrow else { return }
    let controller = self.controller
    Task { @MainActor in
      try? await Task.sleep(nanoseconds: UInt64(ComposerMeasure.focusDelay * 1_000_000_000))
      let posts = controller.state.posts
      let editing = controller.editingPostId.map { id in posts.contains { $0.id.jsEquals(id) } } ?? false
      guard controller.focusPostId == nil, !editing else { return }
      if let first = posts.first?.id { controller.focusPostId = first }
    }
  }

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
      if TypingProbe.isBench {
        // The UI tests' bench: a plain field, outside the scroll so it stays put.
        TypingProbePlainField()
          .frame(height: 64)
          .padding(.horizontal, theme.composerNarrow ? ComposerMeasure.phoneSide : ComposerMeasure.side)
      }
      ScrollViewReader { proxy in
        ScrollView {
          ComposerBody(controller: controller)
            .padding(.horizontal, theme.composerNarrow ? ComposerMeasure.phoneSide : ComposerMeasure.side)
            .padding(.top, theme.composerNarrow ? ComposerMeasure.phoneBodyTop : ComposerMeasure.bodyTop)
            .padding(.bottom, ComposerMeasure.bodyBottom)
            // A post's "@" or "/" suggestions, under its editor, brought
            // into view as they open (ComposerReveals, PostEditor.swift).
            .environment(\.composerScroller, ComposerScroller { [motion = theme.motion.control] id in
              DispatchQueue.main.async {
                withAnimation(motion) { proxy.scrollTo(id) }
              }
            })
        }
        // SCHEDULE: the when panel opens under the post's settings, which on
        // a phone can be below the foot of the sheet: brought into view.
        .onChange(of: controller.scheduling.whenOpen) { _, open in
          guard open else { return }
          DispatchQueue.main.async {
            withAnimation(theme.motion.control) { proxy.scrollTo(ComposerWhenPanel.anchor) }
          }
        }
        // The error is brought into view as it's shown (the web's
        // scrollIntoView, block 'nearest'): it is drawn last, under the
        // settings, which on a phone can be below the foot.
        .onChange(of: controller.error) { _, next in
          guard next != nil else { return }
          DispatchQueue.main.async {
            withAnimation(theme.motion.control) { proxy.scrollTo(ComposerStatus.errorAnchor) }
          }
        }
      }
      .scrollDismissesKeyboard(.interactively)
      // `.composer-drop`: over the post area, the head or bar and the foot left clear.
      .overlay { if dropOver { ComposerDropHint() } }
      // The toasts are the host's one stack, at the window's corner beside a
      // wider window's dialog, as the web's `.toasts` are, and under the
      // sheet where the two meet: the web's composer is a modal <dialog>
      // (showModal, the top layer), drawn over the page's toasts and its
      // scrim over them too (Menu.jsx's sheetHost portals into the dialog
      // for that reason). A stack above the sheet would cover its foot. A
      // phone's sheet covers that stack, so it draws its own over the post
      // area, above the foot, where they don't hide Save as draft and Schedule.
      .overlay { if theme.composerNarrow { ToastStack(center: toasts) } }
      .sheet(item: $controller.dialog) { dialog in
        // On a phone at its detents; wider, the web's centred modal, its
        // own width and as tall as what's in it (the library 980 by 720).
        ComposerDialogView(controller: controller, dialog: dialog)
          .dialogSheetSizing(
            phone: theme.windowWidth <= dialog.phoneWidth, detents: dialog.detents, width: dialog.sheetWidth,
            height: dialog.sheetHeight)
          .presentationBackground(theme.surface)
          .presentationCornerRadius(Measure.Dialog.radius)
      }
      ComposerFoot(controller: controller)
    }
    .background(theme.surface)
    // The UI tests' typing probe (TypingProbe): a hidden element whose value is its record.
    .overlay(alignment: .topLeading) {
      if TypingProbe.isOn { TypingProbeElement().frame(width: 1, height: 1).allowsHitTesting(false) }
    }
    // Files dropped anywhere on the composer go to the post being written.
    .composerDrop(controller, over: $dropOver)
    // ADVISER: the adviser's sheet, and its account while the composer is open.
    .adviserSheet(controller.adviser)
    .onAppear {
      controller.configureAdviser(open: true)
      controller.narrow = theme.composerNarrow
      focusFirstPost()
    }
    .onDisappear { controller.configureAdviser(open: false) }
    // Opening, or loading a new post into it, puts the caret in the first
    // post on a wide screen (the web's effect on [open, generation, narrow]).
    .onChange(of: controller.generation) { _, _ in focusFirstPost() }
    .onChange(of: theme.composerNarrow) { _, narrow in
      controller.narrow = narrow
      focusFirstPost()
    }
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

  var body: some View {
    let state = controller.state
    let disabled = controller.disabled
    let loadError = controller.loadError
    VStack(alignment: .leading, spacing: ComposerMeasure.gap) {
      PostAsPicker(
        asDid: controller.asDid, locked: state.source?.kind == "scheduled",
        lockedReason: "A scheduled post stays with the account that scheduled it.", disabled: disabled
      ) { controller.changeAsDid($0) }
      ComposerAccountNotice(controller: controller)
      ComposerNotices(controller: controller)
      ComposerSourceWarning(controller: controller)  // SCHEDULE
      if let loadError {
        Callout(tone: .danger, alert: loadError) {
          ComposerCalloutLine(loadError) {
            Button("Write a new post instead") { controller.startOver(confirm: false) }
              .buttonStyle(.virga(size: .small))
          }
        }
      } else if controller.loads["draft"] == .loading || controller.loads["scheduled"] == .loading {
        // The composer's shape while a draft or a scheduled post is read.
        ComposerSkeleton(label: controller.loads["scheduled"] != nil ? "Opening the scheduled post" : "Opening the draft")
      } else {
        ComposerPosts(controller: controller, disabled: disabled)
        ComposerOptions(controller: controller, disabled: disabled)
        ComposerWhenPanel(controller: controller, disabled: disabled)  // SCHEDULE
      }
      ComposerStatus(controller: controller)
    }
    // SCHEDULE: the account's limits, read as it opens, for each account it
    // goes out as, and again when that account gains or loses Virga's server
    // (the web's effect on [open, asDid, caps.canSchedule]); TIMER: the
    // default timer waits on them.
    .task(id: "\(controller.caps.canSchedule) \(controller.asDid)") { await controller.refreshLimits(controller.asDid) }
    // TIMER: a post whose timer the writer hasn't chosen takes the default,
    // whenever the default or the state loaded changes (ComposerController+Timer.swift).
    .onChange(of: controller.defaultTimerKey, initial: true) { _, _ in controller.applyDefaultTimer() }
    // An idle video with a file starts uploading, whichever way it arrived.
    .onChange(of: controller.videoUploadKey, initial: true) { _, _ in controller.startVideoUploads() }
  }
}

/// A signed-out account, or one without the permission to post.
struct ComposerAccountNotice: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

  var body: some View {
    if controller.signedOut {
      let words = "This account is signed out. Sign back in to post as it, or choose another account."
      Callout(tone: .warn, alert: words) {
        ComposerCalloutLine(words) {
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
      // role="status": read out as it comes.
      Callout(tone: notice.tone == .warn ? .warn : .plain, alert: notice.text) {
        ComposerCalloutLine(notice.text, centred: true) {
          if let label = notice.actionLabel, let action = notice.action {
            Button(label, action: action).buttonStyle(.virga(size: .small))
          }
          Button {
            controller.notices.removeAll { $0.key == notice.key }
          } label: {
            Image(systemName: Glyph.close)
          }
          .buttonStyle(.virga(.ghost, size: .small, icon: true))
          .accessibilityLabel("Dismiss")
        }
      }
      .accessibilityElement(children: .contain)
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

  /// An intent's template that's gone, or templates that couldn't be read.
  private var templateError: String? {
    if case .failed(let text, _)? = controller.loads["template"] { return text }
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
        Callout(tone: .warn, alert: quoteError) { Text(quoteError) }
      }
      if let templateError {
        Callout(tone: .warn, alert: templateError) { Text(templateError) }
          .accessibilityIdentifier("composer-template-error")
      }
      if controller.undoable, let undo = controller.threadUndo {
        let line = ThreadEdits.undoLine(undo, fmt: { AppLocale.fmtInt(Double($0)) })
        Callout(alert: line) {
          ComposerCalloutLine(line, centred: true) {
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
        Callout(tone: .warn, alert: controller.mediaNote) { Text(controller.mediaNote) }
      }
    }
  }
}

/// The busy line while it sends, and the error when it couldn't.
struct ComposerStatus: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController

  /// The error's place in the composer's scroll, to bring it into view.
  static let errorAnchor = "composer-error-line"

  var body: some View {
    // ADVISER: while it reads, its line in the busy line's place.
    if let reading = controller.adviser.busy {
      AdviserBusyLine(
        busy: reading, onPublishAnyway: controller.adviser.canPublishAnyway ? { controller.adviser.publishAnyway() } : nil,
        onKeepEditing: { controller.adviser.keepEditing() })
    }
    if let busy = controller.busy, !busy.adviser {
      let line = busy.slow ? ComposerSubmit.slowPublishNote : busy.line ?? "Working…"
      VStack(alignment: .leading, spacing: theme.space2) {
        ProgressLine(value: nil)
        HStack(spacing: ComposerMeasure.busyGap) {
          Text(line)
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
      // role="status" aria-live="polite": each step read out.
      .composerAnnounces(line)
    }
    if let error = controller.error {
      // role="alert", centred on its words with Sign back in at the right.
      Callout(tone: .danger, alert: error.text) {
        HStack(alignment: .center, spacing: theme.points(ThemeKit.calloutGap)) {
          Text(error.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("composer-error")
          if error.reauth {
            Button("Sign back in") { AccountCopy.requestReauth(controller.asDid, immediate: true) }
              .buttonStyle(.virga(size: .small))
              .fixedSize()
          }
        }
      }
      .id(Self.errorAnchor)
    }
  }
}

/// The foot: the post's tools (760 and under), why the main button is off,
/// the ways that have a button of their own, and the main button. No rule
/// over it: the space says it is the dialog's foot. On a phone a why that
/// has to be read takes a line of its own over the tools and the buttons.
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
    // An empty post, or one over the limit, says so where it is written
    // once the post's tools are in the foot (760 and under).
    let shown = theme.composerToolsInFoot && passing ? "" : why
    let narrow = theme.composerNarrow
    VStack(alignment: .leading, spacing: ComposerMeasure.actionsRowGap) {
      if narrow && !shown.isEmpty {
        whyLine(shown).padding(.trailing, ComposerMeasure.phoneWhyTrailing)
      }
      HStack(spacing: narrow ? ComposerMeasure.phoneActionsGap : ComposerMeasure.actionsGap) {
        if theme.composerToolsInFoot && controller.footToolsShown {
          let index = controller.toolsIndex
          PostTools(controller: controller, post: state.posts[index], disabled: controller.disabled, inFoot: true)
            .padding(.leading, -ComposerMeasure.footToolsLead)
        }
        if narrow {
          Spacer(minLength: 0)
        } else {
          whyLine(shown).frame(maxWidth: .infinity, alignment: .leading)
        }
        ComposerAlso(controller: controller, model: model)
        // On a phone the main button is in the bar at the top of the sheet.
        if !narrow {
          PublishButton(
            state: state, model: model, busy: controller.sendBusy, also: controller.also,  // ADVISER: sendBusy
            footnote: controller.usageLine.isEmpty ? "" : "\(controller.usageLine).",  // SCHEDULE
            onAction: { controller.runAction($0) })
        }
      }
      .frame(minHeight: narrow ? Measure.Touch.target : nil)
    }
    .padding(narrow ? ComposerMeasure.phoneFoot : ComposerMeasure.foot)
    .background(theme.surface)
    // aria-live="polite": the reason the main button is off, read out as
    // it changes (a reason the foot hides is said where it's written).
    .onChange(of: shown) { _, next in ComposerAnnounce.post(next) }
  }

  private func whyLine(_ text: String) -> some View {
    Text(text)
      .virgaText(.textSm, lineHeight: ComposerMeasure.whyLineHeight)
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityIdentifier("composer-why")
  }
}

/// Save as draft (words alone) and Schedule (the outline), beside the main
/// button; each says why when it's off (its title). Schedule says it in
/// words alone in a phone's foot of 350 or less, so the foot keeps one line.
struct ComposerAlso: View {
  @Environment(\.virgaTheme) private var theme
  let controller: ComposerController
  let model: ComposerActionSet

  var body: some View {
    let state = controller.state
    let also = controller.also
    let busy = controller.sendBusy  // ADVISER
    let narrow = theme.composerNarrow
    let draft = model.actions.draft
    let schedule = model.actions.schedule
    // The kit's padding taken back: 10 a side on a wide screen, none on a phone.
    let kitPad = theme.points(ThemeKit.buttonPadding.left)
    let footWidth = theme.windowWidth - ComposerMeasure.phoneFoot.leading - ComposerMeasure.phoneFoot.trailing
    let scheduleIcon = !(narrow && footWidth <= ComposerMeasure.footWordsOnly)
    if !also.isEmpty {
      HStack(spacing: narrow ? ComposerMeasure.phoneAlsoGap : ComposerMeasure.alsoGap) {
        if also.contains(PublishActions.draft) {
          Button(ComposerActions.actionLabel(PublishActions.draft, state)) { controller.runAction(PublishActions.draft) }
            .buttonStyle(.virga(.ghost))
            .disabled(busy || draft.disabled)
            .padding(.horizontal, -(kitPad - (narrow ? 0 : ComposerMeasure.draftPadding)))
            .help(draft.reason ?? "")
            .accessibilityHint(draft.disabled ? draft.reason ?? "" : "")
            .accessibilityIdentifier("save-draft")
        }
        if also.contains(PublishActions.schedule) {
          Button {
            controller.runAction(PublishActions.schedule)
          } label: {
            if scheduleIcon {
              Label(ComposerActions.actionLabel(PublishActions.schedule, state, short: true), systemImage: ComposerGlyph.schedule)
            } else {
              Text(ComposerActions.actionLabel(PublishActions.schedule, state, short: true))
            }
          }
          .buttonStyle(.virga)
          .disabled(busy || schedule.disabled)
          .help(schedule.reason ?? "")
          .accessibilityHint(schedule.disabled ? schedule.reason ?? "" : "")
          .accessibilityIdentifier("composer-schedule")
        }
      }
      .fixedSize()
    }
  }
}

/// The composer's shape while a draft or a scheduled post is read: a post
/// of three lines (the last 45% wide) over the settings' three chips.
struct ComposerSkeleton: View {
  @Environment(\.virgaTheme) private var theme
  let label: String

  var body: some View {
    let phone = theme.composerNarrow
    VStack(alignment: .leading, spacing: ComposerMeasure.gap) {
      VStack(alignment: .leading, spacing: ComposerMeasure.skeletonLineGap) {
        line(nil)
        line(nil)
        line(ComposerMeasure.skeletonShortLine)
      }
      .padding(.top, ComposerMeasure.skeletonTop)
      .padding(.bottom, ComposerMeasure.skeletonBottom)
      VStack(alignment: .leading, spacing: 0) {
        Rectangle().fill(theme.rule).frame(height: 1)
        if phone {
          VStack(alignment: .leading, spacing: ComposerMeasure.skeletonChipGap) { chips }
        } else {
          HStack(spacing: ComposerMeasure.skeletonChipGap) { chips }
            .padding(.top, ComposerMeasure.optionsTop)
        }
      }
    }
    .accessibilityElement()
    .accessibilityLabel(label)
    .accessibilityIdentifier("composer-skeleton")
    .composerAnnounces("\(label)…")
  }

  @ViewBuilder private var chips: some View {
    ForEach(0..<3, id: \.self) { _ in
      Capsule().fill(theme.surface3)
        .frame(width: ComposerMeasure.skeletonChip.width, height: ComposerMeasure.skeletonChip.height)
    }
  }

  private func line(_ share: CGFloat?) -> some View {
    GeometryReader { box in
      RoundedRectangle(cornerRadius: theme.radiusSm)
        .fill(theme.surface3)
        .frame(width: box.size.width * (share ?? 1))
    }
    .frame(height: ComposerMeasure.skeletonLine)
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
          DescribeDialog.altText(image: image, transport: controller.transport, onSave: save, onClose: close)
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
      // TIMER: the post's timer over its rule (LifespanDialog.swift, ComposerController+Timer.swift).
      LifespanDialog(
        value: controller.state.lifespan, fit: controller.timerDialogFit, publishAt: controller.timerPublishAt,
        limits: controller.limits.value, did: controller.asDid, holds: controller.timerDialogHolds,
        note: controller.timerNote, transport: controller.transport,
        onSave: { controller.saveTimer($0) }, onClose: close)
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
