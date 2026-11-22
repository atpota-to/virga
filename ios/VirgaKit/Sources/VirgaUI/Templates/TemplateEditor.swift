// Ports src/posting/library/TemplateEditor.jsx
// Ports src/posting/library/library.css (.tpl-form, .tpl-text-foot, .tpl-blank-new, .tpl-blanks, .tpl-blank, .tpl-attached, .tpl-posts, .lib-choices, .lib-choice, .tpl-grid, .tpl-shortcut, .tpl-actions)
//
// Make or change a template: its name, its text with blanks for the
// questions it asks (and the ones that fill themselves, such as the first
// name of whoever is replied to), what it attaches, where it's offered, its
// group, its "/shortcut" and the words that suggest it. Saved in the
// account's repo as `net.anisota.feed.template`, where anyone can read it,
// through the account's own TemplatesModel (useTemplates).
//
// `template` edits that one; `seed` (`{ text, embed }`, or `{ draft, note }`
// from draftFromReply) starts a new one from a post. A sheet, full height,
// its foot held at the bottom while the form scrolls. Closing it (the ✕,
// Cancel, Escape on a hardware keyboard) asks first when there are
// changes: "Discard your changes?" takes the foot's place, as does "Delete
// … for good?"; a swipe down is held while there are changes. Escape puts
// a prompt away.
//
// Differences: SwiftUI's text editor doesn't say where the caret is on iOS
// 17, so Insert and A blank… put what they add at the end of the text; the
// Group field has no list of the groups already used (a datalist) under it.
// Its reads are the library's (LibrarySources: the account's posts, what a
// template quotes, a pasted link); a web page's card is linkCard.js's
// fetchLinkCard (VirgaPosting's LinkCard).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// `seed`: a new template from a post (`{ text, embed, use }`), or a draft
/// from draftFromReply with its note.
struct TemplateSeed {
  var text = ""
  var embed: JSONValue?
  var use: String?
  var draft: TemplateDraft?
  var note: String?
}

/// The editor's words that more than one part says.
enum TemplateEditorWords {
  static let attachOptions = [
    SegmentedOption("none", "Nothing"), SegmentedOption("post", "One of your posts"), SegmentedOption("link", "A link"),
  ]
  static let kindOptions = [SegmentedOption("text", "Typed answer"), SegmentedOption("choice", "Pick from a list")]

  /// `firstLine(text)`: the first line with anything on it, trimmed.
  static func firstLine(_ text: String?) -> String {
    (text ?? "").components(separatedBy: "\n").map { $0.jsTrimmed() }.first { !$0.isEmpty } ?? ""
  }

  /// `viewSummary(view)`: what a read view is called.
  static func viewSummary(_ view: JSONValue?) -> TemplateAttachSummary? {
    guard let view, view.objectValue != nil else { return nil }
    if view["record"]?["text"] != nil || view["author"].truthy != nil {
      let handle = view["author"]?["handle"]?.stringValue ?? ""
      return TemplateAttachSummary(
        by: handle.isEmpty ? "Post" : "Post by @\(handle)", title: firstLine(view["record"]?["text"]?.stringValue).nonEmpty ?? "Post")
    }
    if let name = view["displayName"]?.stringValue, !name.isEmpty {
      let handle = view["creator"]?["handle"]?.stringValue ?? ""
      return TemplateAttachSummary(by: handle.isEmpty ? "Feed" : "Feed by @\(handle)", title: name)
    }
    if let name = view["name"]?.stringValue, !name.isEmpty {
      let handle = view["creator"]?["handle"]?.stringValue ?? ""
      return TemplateAttachSummary(by: handle.isEmpty ? "List" : "List by @\(handle)", title: name)
    }
    return nil
  }

  /// `startingDraft(template, seed)`.
  static func startingDraft(_ template: PostTemplate?, _ seed: TemplateSeed?) -> TemplateDraft {
    if let template { return EditorDrafts.draftFromTemplate(template) }
    if let draft = seed?.draft { return EditorDrafts.draftFromTemplate(draft) }
    if let seed {
      var blank = EditorDrafts.blankTemplate
      blank.text = seed.text
      blank.embed = seed.embed
      blank.use = seed.use ?? "any"
      return EditorDrafts.draftFromTemplate(blank)
    }
    return EditorDrafts.draftFromTemplate(nil as PostTemplate?)
  }
}

extension View {
  /// `TemplateEditor`: the editor over this view while `isPresented`.
  func templateEditor(
    isPresented: Binding<Bool>, did: String?, template: PostTemplate?, seed: TemplateSeed? = nil,
    onSaved: ((PostTemplate) -> Void)? = nil, onDeleting: ((String?) -> Void)? = nil
  ) -> some View {
    modifier(TemplateEditorSheet(isPresented: isPresented, did: did, template: template, seed: seed, onSaved: onSaved, onDeleting: onDeleting))
  }
}

struct TemplateEditorSheet: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Binding var isPresented: Bool
  let did: String?
  let template: PostTemplate?
  let seed: TemplateSeed?
  let onSaved: ((PostTemplate) -> Void)?
  let onDeleting: ((String?) -> Void)?

  func body(content: Content) -> some View {
    content.sheet(isPresented: $isPresented) {
      TemplateEditorForm(
        did: did, template: template, seed: seed, onClose: { isPresented = false }, onSaved: onSaved, onDeleting: onDeleting)
        .presentationDetents([.large])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

struct TemplateEditorForm: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let did: String?
  let template: PostTemplate?
  let seed: TemplateSeed?
  let onClose: () -> Void
  let onSaved: ((PostTemplate) -> Void)?
  let onDeleting: ((String?) -> Void)?

  enum Field: Hashable {
    case name, text, quote, group, shortcut, keywords, blank
  }

  struct LinkState {
    var status = "idle"
    var summary: TemplateAttachSummary?
    var error = ""
  }

  struct PostsState {
    var status = "idle"
    var items: [JSONValue] = []
    var cursor: String?
    var shown = Measure.Templates.postsStep
  }

  @State private var model: TemplatesModel?
  @State private var initial: TemplateDraft?
  @State private var draft = TemplateDraft()
  @State private var tried = false
  @State private var saving = false
  @State private var serverError: TemplateServiceError?
  @State private var otherError: String?
  @State private var confirmDiscard = false
  @State private var confirmDelete = false
  @State private var blankLabel: String?
  @State private var link = LinkState()
  @State private var posts = PostsState()
  @FocusState private var focus: Field?

  /// The library's reads (LibrarySources) go through the session's transport.
  private var transport: any HTTPTransport { app.archiveEnvironment.transport }

  var body: some View {
    let templates = model?.templates ?? []
    let others = templates.filter { !$0.rkey.jsEquals(template?.rkey ?? "") }
    let problems = problemsNow(others)
    let showProblems = tried || serverError?.fieldErrors != nil
    let problem = { (field: String) -> String? in showProblems ? problems[field] : nil }
    let changed = initial.map { TemplateEditorModel.editorHasChanges($0, draft) } ?? false
    DialogFrame(title: template != nil ? "Edit the template" : "New template", onClose: { requestClose(changed) }, hasActions: true) {
      form(problem: problem, templates: templates)
    } actions: {
      foot(changed: changed)
    }
    .interactiveDismissDisabled(changed || saving)
    .onKeyPress(.escape) {
      if confirmDiscard {
        confirmDiscard = false
      } else if confirmDelete {
        if !saving { confirmDelete = false }
      } else if blankLabel != nil {
        blankLabel = nil
      } else {
        requestClose(changed)
      }
      return .handled
    }
    .task {
      if model == nil {
        let made = TemplatesModel(session: app.session, did: did)
        model = made
        made.start()
      }
      if initial == nil {
        let start = TemplateEditorWords.startingDraft(template, seed)
        initial = start
        draft = start
        focus = .name
        await readInitialQuote(start)
      }
    }
    .task(id: draft.quoteMode == "post" && posts.status == "idle") {
      guard draft.quoteMode == "post", posts.status == "idle", let did else { return }
      posts.status = "loading"
      do {
        let read = try await LibrarySources.fetchOwnPosts(did, transport: transport)
        posts = PostsState(status: "ready", items: read.items, cursor: read.cursor)
      } catch {
        posts.status = "error"
      }
    }
    .onDisappear { model?.stop() }
    .accessibilityIdentifier("template-editor")
  }

  /// `{ ...editorProblems(draft, others), ...serverError?.fieldErrors }`.
  private func problemsNow(_ others: [PostTemplate]) -> TemplateFieldErrors {
    var out = TemplateEditorModel.editorProblems(draft, others)
    for entry in serverError?.fieldErrors?.entries ?? [] { out[entry.field] = entry.message }
    return out
  }

  // MARK: Closing

  private func requestClose(_ changed: Bool) {
    if saving { return }
    if changed && !confirmDiscard { confirmDiscard = true } else { onClose() }
  }

  /// What an existing quote is, read, so the form can name it.
  private func readInitialQuote(_ start: TemplateDraft) async {
    let kind = EditorDrafts.templateEmbedKind(start.embed)
    guard kind == "post" || kind == "feed" || kind == "list" else { return }
    let views = await LibrarySources.hydrateEmbedViews([start.embed ?? .null], transport: transport)
    guard let view = views[uri: start.embed?["record"]?["uri"]?.stringValue ?? ""] else { return }
    if view == .string(Library.missing) {
      link = LinkState(status: "ready", summary: TemplateAttachSummary(by: "Gone", title: "What this quotes has been deleted."))
    } else {
      link = LinkState(status: "ready", summary: TemplateEditorWords.viewSummary(view))
      if draft.embed == start.embed { draft.quoteView = view }
    }
  }

  // MARK: The form

  private func form(problem: @escaping (String) -> String?, templates: [PostTemplate]) -> some View {
    VStack(alignment: .leading, spacing: Measure.Templates.formGap) {
      NoteText("Templates are saved in your repo, where anyone can read them. Don’t put anything private in one.")
      if let note = seed?.note, !note.isEmpty {
        Callout { Text(note) }
      }
      nameField(problem)
      textField(problem)
      let blanks = TemplateEditorModel.blanksIn(draft)
      if !blanks.asked.isEmpty || !blanks.context.isEmpty {
        questions(blanks, problem: problem)
      }
      attach(problem)
      VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
        FieldLabel("Offer it when")
        Segmented(
          label: "Offer it when", options: TemplateEditorModel.useOptions.map { SegmentedOption($0.value, $0.label) },
          selection: draft.use.isEmpty ? "any" : draft.use, size: .small
        ) { draft.use = $0 }
      }
      groupAndShortcut(problem)
      FieldStack("Suggest it when a post mentions") {
        TextField("app, client, reader", text: $draft.keywordsText)
          .textInputAutocapitalization(.never)
          .virgaField(invalid: problem("keywords") != nil)
          .focused($focus, equals: .keywords)
          .accessibilityLabel("Suggest it when a post mentions")
        FieldHint("Words separated by commas. A reply to a post with one of them offers this template first.")
        fieldError(problem("keywords"))
      }
      if let serverError, serverError.fieldErrors == nil {
        Callout(tone: .danger) {
          VStack(alignment: .leading, spacing: theme.space3) {
            Text(serverError.message.isEmpty ? "The template couldn’t be saved. Try again." : serverError.message)
            if serverError.permission, let did {
              Button("Sign in again") { AccountCopy.requestReauth(did, immediate: true) }
                .buttonStyle(.virga(size: .small))
            }
          }
        }
        .accessibilityIdentifier("template-editor-error")
      } else if let otherError {
        Callout(tone: .danger) { Text(otherError) }
      }
    }
  }

  private func nameField(_ problem: (String) -> String?) -> some View {
    FieldStack("Name") {
      TextField("Is there an app for that?", text: $draft.name)
        .virgaField(invalid: problem("name") != nil)
        .focused($focus, equals: .name)
        .onChange(of: draft.name) { _, next in if next.utf16.count > 200 { draft.name = next.jsSlice(0, 200) } }
        .accessibilityLabel("Name")
        .accessibilityIdentifier("template-name")
      fieldError(problem("name"))
    }
  }

  private func textField(_ problem: (String) -> String?) -> some View {
    let count = Graphemes.countGraphemes(draft.text)
    let limit = PostTemplates.templateLimits.textGraphemes
    return VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
      FieldLabel("Text")
      TextEditor(text: $draft.text)
        .frame(minHeight: theme.points(ThemeKit.textAreaMinHeight) * Measure.Templates.textRows / 3)
        .virgaTextArea(invalid: problem("text") != nil)
        .focused($focus, equals: .text)
        .accessibilityLabel("Text")
        .accessibilityIdentifier("template-text")
      // One line under the text: what can be put in it, and its count.
      HStack(alignment: .firstTextBaseline, spacing: Measure.Templates.footColumnGap) {
        VirgaMenu(accessibilityLabel: "Insert", entries: insertEntries) {
          Label("Insert", systemImage: "chevron.down")
            .labelStyle(TrailingIconLabelStyle())
            .virgaText(size: theme.points(ThemeKit.linkActionFontSize), weight: ThemeKit.linkActionWeight)
            .foregroundStyle(theme.ink)
        }
        .accessibilityIdentifier("template-insert")
        Spacer(minLength: 0)
        FieldHint("\(AppLocale.formatNumber(count)) of \(limit)", isOver: count > limit)
      }
      if let label = blankLabel {
        newBlank(label)
      }
      FieldHint("A blank is a word in double braces, like {{app}}. Using the template asks for each one.")
      fieldError(problem("text"))
    }
  }

  private var insertEntries: [MenuEntry] {
    var out: [MenuEntry] = [.item(MenuItem("A blank…", key: "blank") { blankLabel = "" })]
    for c in TemplateEditorModel.contextInserts {
      out.append(.item(MenuItem(c.label, key: c.key) { insertToken(c.key) }))
    }
    return out
  }

  private func newBlank(_ label: String) -> some View {
    VStack(alignment: .leading, spacing: Measure.Templates.newBlankGap) {
      FieldLabel("What should it ask?")
      HStack(spacing: Measure.Templates.rowGap) {
        TextField("Which app?", text: Binding(get: { blankLabel ?? "" }, set: { blankLabel = $0 }))
          .virgaField()
          .focused($focus, equals: .blank)
          .onSubmit { addAskedBlank() }
          .onKeyPress(.escape) {
            blankLabel = nil
            return .handled
          }
          .accessibilityLabel("What should it ask?")
          .frame(minWidth: Measure.Templates.rowFieldMin)
        Button("Add") { addAskedBlank() }
          .buttonStyle(.virga(.primary, size: .small))
          .disabled(label.jsTrimmed().isEmpty)
        Button {
          blankLabel = nil
        } label: {
          Image(systemName: Glyph.close)
        }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .accessibilityLabel("Don’t add a blank")
      }
    }
    .padding(.vertical, Measure.Templates.newBlankPadding)
    .padding(.leading, Measure.Templates.newBlankInset)
    .overlay(alignment: .leading) { Rectangle().fill(theme.line2).frame(width: Measure.Templates.newBlankRule) }
    .onAppear { focus = .blank }
  }

  private func insertToken(_ key: String) {
    let out = TemplateEditorModel.insertAtSelection(draft.text, "{{\(key)}}", nil)
    draft.text = out.text
    focus = .text
  }

  private func addAskedBlank() {
    guard let out = TemplateEditorModel.addBlank(draft, blankLabel ?? "", nil) else { return }
    draft = out.draft
    blankLabel = nil
    focus = .text
  }

  // MARK: Questions

  private func questions(_ blanks: TemplateBlanks, problem: (String) -> String?) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel("Questions")
        .padding(.bottom, Measure.Templates.legendSpaceBelow)
        .accessibilityAddTraits(.isHeader)
      ForEach(blanks.asked, id: \.key) { v in
        question(v)
          .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
      }
      if !blanks.asked.isEmpty {
        Rectangle().fill(theme.line).frame(height: 1)
      }
      if !blanks.context.isEmpty {
        FieldHint("Filled in for you: \(blanks.context.map(\.label).joined(separator: ", ")).")
          .padding(.top, theme.space2)
      }
      if let message = problem("variables") {
        Text(message).virgaText(.textSm).foregroundStyle(theme.danger).padding(.top, theme.space2)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Questions")
    .accessibilityIdentifier("template-questions-editor")
  }

  private func patch(_ key: String, _ fields: [String: JSONValue]) {
    draft = TemplateEditorModel.patchVariable(draft, key, fields)
  }

  private func question(_ v: DraftVariable) -> some View {
    let wide = theme.windowWidth >= Measure.Templates.blankFieldsSideBySide
    let ask = FieldStack("Question") {
      TextField("Fill in “\(v.key)”", text: Binding(get: { v.label }, set: { patch(v.key, ["label": .string($0)]) }))
        .virgaField()
        .accessibilityLabel("Question")
    }
    let hint = FieldStack("Example or hint") {
      TextField("", text: Binding(get: { v.hint }, set: { patch(v.key, ["hint": .string($0)]) }))
        .virgaField()
        .accessibilityLabel("Example or hint")
    }
    return VStack(alignment: .leading, spacing: Measure.Templates.blankGap) {
      Text("{{\(v.key)}}")
        .font(theme.codeFont(around: theme.textSm))
        .foregroundStyle(theme.muted)
      if wide {
        HStack(alignment: .top, spacing: Measure.Templates.blankFieldsColumnGap) {
          ask.frame(maxWidth: .infinity)
          hint.frame(maxWidth: .infinity)
        }
      } else {
        VStack(alignment: .leading, spacing: Measure.Templates.blankFieldsRowGap) {
          ask
          hint
        }
      }
      Segmented(
        label: "How “\(v.label.isEmpty ? v.key : v.label)” is answered", options: TemplateEditorWords.kindOptions,
        selection: v.kind == "choice" ? "choice" : "text", size: .small
      ) { patch(v.key, ["kind": .string($0)]) }
      if v.kind == "choice" {
        FieldStack("Choices, one per line") {
          TextEditor(text: Binding(get: { v.choicesText }, set: { patch(v.key, ["choicesText": .string($0)]) }))
            .frame(minHeight: theme.points(ThemeKit.textAreaMinHeight) * Measure.Templates.choicesRows / 3)
            .virgaTextArea()
            .accessibilityLabel("Choices, one per line")
        }
      }
      Toggle(
        "Optional: an empty answer is left out", isOn: Binding(get: { v.optional }, set: { patch(v.key, ["optional": .bool($0)]) })
      )
      .toggleStyle(.virgaCheck)
    }
    .padding(.vertical, Measure.Templates.blankPadding)
    .accessibilityElement(children: .contain)
  }

  // MARK: Attach

  private func attach(_ problem: (String) -> String?) -> some View {
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
      FieldLabel("Attach")
      if draft.quoteMode == "other" {
        HStack(spacing: Measure.Templates.attachGap) {
          Text("This template attaches something Virga can’t show here, such as pictures. Saving keeps it.")
            .virgaText(.textSm)
            .foregroundStyle(theme.ink2)
            .frame(maxWidth: .infinity, alignment: .leading)
          Button("Remove it") { setAttach("none") }
            .buttonStyle(.virga(size: .small))
        }
      } else {
        Segmented(label: "Attach", options: TemplateEditorWords.attachOptions, selection: draft.quoteMode, size: .small) { setAttach($0) }
          .accessibilityIdentifier("template-attach")
      }
      if draft.quoteMode == "link" {
        HStack(spacing: Measure.Templates.rowGap) {
          TextField(
            "https://bsky.app/profile/…/post/…, or any web page",
            text: Binding(
              get: { draft.quoteUrl },
              set: {
                draft.quoteUrl = $0
                draft.embed = nil
                draft.quoteView = nil
                link = LinkState()
              })
          )
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .virgaField(invalid: problem("quote") != nil)
          .focused($focus, equals: .quote)
          .onSubmit { Task { await readLink() } }
          .accessibilityLabel("A link to a post, feed, list or web page")
          Button(link.status == "loading" ? "Reading…" : "Read the link") { Task { await readLink() } }
            .buttonStyle(.virga(size: .small))
            .disabled(draft.quoteUrl.jsTrimmed().isEmpty || link.status == "loading")
        }
      }
      if draft.quoteMode == "post" {
        postsToQuote
      }
      if draft.embed != nil, let summary = link.summary, draft.quoteMode != "other" {
        TemplateAttachCard(summary: summary)
      }
      if draft.embed != nil, link.summary == nil, draft.quoteMode != "other", draft.quoteMode != "none" {
        let kind = EditorDrafts.templateEmbedKind(draft.embed) ?? ""
        FieldHint("Attached: \(kind == "link" ? "a link card" : "a \(kind)").")
      }
      if !link.error.isEmpty {
        Text(link.error).virgaText(.textSm).foregroundStyle(theme.danger)
      }
      fieldError(problem("quote"))
    }
  }

  private var postsToQuote: some View {
    let shown = Array(posts.items.prefix(posts.shown))
    return VStack(alignment: .leading, spacing: Measure.Templates.attachGap) {
      if posts.status == "loading" {
        TemplateBones()
      }
      if posts.status == "error" {
        Callout(tone: .danger) {
          HStack(spacing: theme.space3) {
            Text("Your recent posts couldn’t be read.")
            Button("Try again") { posts = PostsState() }
              .buttonStyle(.virga(size: .small))
          }
        }
      }
      if posts.status == "ready" && posts.items.isEmpty {
        FieldHint("No posts of yours to quote yet.")
      }
      if !shown.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          Rectangle().fill(theme.line).frame(height: 1)
          ForEach(Array(shown.enumerated()), id: \.offset) { _, view in
            let on = draft.embed?["record"]?["uri"]?.stringValue == view["uri"]?.stringValue
            Button {
              pickPost(view)
            } label: {
              Text(TemplateEditorWords.firstLine(view["record"]?["text"]?.stringValue).nonEmpty ?? "A post with no text")
                .virgaText(.textBase, weight: on ? VirgaWeight.semibold : VirgaWeight.regular)
                .foregroundStyle(on ? theme.ink : theme.ink2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, minHeight: Measure.Templates.choiceHeight, alignment: .leading)
                .padding(Measure.Templates.choicePadding)
                .overlay(alignment: .leading) {
                  if on { Rectangle().fill(theme.accent).frame(width: Measure.Templates.choiceRule) }
                }
                .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(on ? .isSelected : [])
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Attach")
      }
      if posts.items.count > posts.shown {
        Button("Show more") { posts.shown += Measure.Templates.postsStep }
          .buttonStyle(.virga(.ghost, size: .small))
      }
    }
  }

  private func setAttach(_ mode: String) {
    if mode == "none" {
      draft.quoteMode = "none"
      draft.embed = nil
      draft.quoteView = nil
      draft.quoteUrl = ""
      link = LinkState()
    } else if mode == "post" {
      let keep = draft.quoteMode == "post"
      draft.quoteMode = "post"
      if !keep { draft.embed = nil }
      draft.quoteUrl = ""
    } else {
      let keep = draft.quoteMode == "link"
      draft.quoteMode = "link"
      if !keep { draft.embed = nil }
    }
  }

  private func readLink() async {
    let url = draft.quoteUrl.jsTrimmed()
    guard !url.isEmpty else { return }
    link = LinkState(status: "loading")
    let transport = self.transport
    let fetchLinkCard: FetchLinkCard = LinkCard.fetchLinkCard(transport: transport)
    var found = await LibrarySources.resolveRecordLink(url, transport: transport)
    if found == nil { found = try? await LibrarySources.resolveExternalLink(url, fetchLinkCard: fetchLinkCard) }
    guard let found else {
      link = LinkState(status: "error", error: "That link couldn’t be read. Check it, or try another.")
      return
    }
    draft.embed = found.embed
    draft.quoteView = found.view
    link = LinkState(status: "ready", summary: TemplateAttachSummary(by: found.by, title: found.title))
  }

  private func pickPost(_ view: JSONValue) {
    draft.embed = [
      "$type": "app.bsky.embed.record",
      "record": ["uri": view["uri"] ?? .null, "cid": view["cid"] ?? .null],
    ]
    draft.quoteView = view
    link = LinkState(status: "ready", summary: TemplateEditorWords.viewSummary(view))
  }

  // MARK: Group, shortcut

  private func groupAndShortcut(_ problem: (String) -> String?) -> some View {
    let group = FieldStack("Group") {
      TextField("Optional", text: $draft.group)
        .virgaField(invalid: problem("group") != nil)
        .focused($focus, equals: .group)
        .accessibilityLabel("Group")
      fieldError(problem("group"))
    }
    let shortcut = FieldStack("Shortcut") {
      HStack(spacing: Measure.Templates.shortcutGap) {
        Text("/").font(theme.codeFont(around: theme.textBase)).foregroundStyle(theme.muted).accessibilityHidden(true)
        TextField(
          "app",
          text: Binding(
            get: { draft.shortcut },
            set: { next in
              var units = Array(next.utf16)
              while units.first == 0x2F { units.removeFirst() }
              draft.shortcut = String(jsUnits: units)
            })
        )
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .virgaField(invalid: problem("shortcut") != nil)
        .focused($focus, equals: .shortcut)
        .accessibilityLabel("Shortcut")
      }
      FieldHint("Type it after a slash in the composer to use the template.")
      fieldError(problem("shortcut"))
    }
    return ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: Measure.Templates.gridGap) {
        group.frame(minWidth: Measure.Templates.gridMin, maxWidth: .infinity, alignment: .topLeading)
        shortcut.frame(minWidth: Measure.Templates.gridMin, maxWidth: .infinity, alignment: .topLeading)
      }
      VStack(alignment: .leading, spacing: Measure.Templates.gridGap) {
        group
        shortcut
      }
    }
  }

  @ViewBuilder
  private func fieldError(_ message: String?) -> some View {
    if let message {
      Text(message).virgaText(.textSm).foregroundStyle(theme.danger).fixedSize(horizontal: false, vertical: true)
    }
  }

  // MARK: The foot

  @ViewBuilder
  private func foot(changed: Bool) -> some View {
    if confirmDiscard {
      prompt("Discard your changes?") {
        Button("Keep editing") { confirmDiscard = false }
          .buttonStyle(.virga)
        Button("Discard", action: onClose)
          .buttonStyle(.virga(.danger))
          .accessibilityIdentifier("template-discard")
      }
    } else if confirmDelete {
      prompt("Delete “\(template?.name ?? "")” for good? It goes from your repo, and from every app that reads it.") {
        Button("Keep it") { confirmDelete = false }
          .buttonStyle(.virga)
          .disabled(saving)
        Button(saving ? "Deleting…" : "Delete for good") { Task { await doDelete() } }
          .buttonStyle(.virga(.danger))
          .disabled(saving)
      }
    } else {
      HStack(spacing: Measure.Templates.actionsGap) {
        if let rkey = template?.rkey, !rkey.isEmpty {
          Button {
            confirmDelete = true
          } label: {
            Label("Delete", systemImage: Glyph.trash)
          }
          .buttonStyle(.virga(destructive: true))
          .disabled(saving)
          if !theme.isPhone { Spacer(minLength: 0) }
        }
        Button("Cancel") { requestClose(changed) }
          .buttonStyle(.virga)
          .disabled(saving)
        Button(saving ? "Saving…" : "Save template") { Task { await save() } }
          .buttonStyle(.virga(.primary))
          .disabled(saving)
          .accessibilityIdentifier("template-save")
      }
    }
  }

  /// A prompt in the foot's place: its question, then its two answers.
  private func prompt<Buttons: View>(_ question: String, @ViewBuilder buttons: () -> Buttons) -> some View {
    VStack(alignment: .leading, spacing: Measure.Templates.actionsGap) {
      Text(question)
        .virgaText(.textSm)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: Measure.Templates.actionsGap) {
        if !theme.isPhone { Spacer(minLength: 0) }
        buttons()
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(question)
  }

  // MARK: Saving and deleting

  private func save() async {
    if saving { return }
    tried = true
    serverError = nil
    otherError = nil
    let others = (model?.templates ?? []).filter { !$0.rkey.jsEquals(template?.rkey ?? "") }
    let own = TemplateEditorModel.editorProblems(draft, others)
    if let first = own.fields.first {
      focus = Self.field(first)
      return
    }
    guard let model else { return }
    saving = true
    defer { saving = false }
    do {
      let value = EditorDrafts.templateFromDraft(draft)
      let saved: PostTemplate
      if let rkey = template?.rkey, !rkey.isEmpty {
        saved = try await model.update(rkey, value)
      } else {
        saved = try await model.create(value)
      }
      toasts?.push(template != nil ? "Template saved." : "Template made. It’s in your library now.")
      onSaved?(saved)
      onClose()
    } catch let error as TemplateServiceError {
      serverError = error
    } catch {
      otherError = (error as? LocalizedError)?.errorDescription ?? "The template couldn’t be saved. Try again."
    }
  }

  private func doDelete() async {
    guard let rkey = template?.rkey, !rkey.isEmpty, let model else { return }
    saving = true
    serverError = nil
    otherError = nil
    onDeleting?(rkey)
    defer { saving = false }
    do {
      try await model.remove(rkey)
      toasts?.push("Template deleted.")
      onClose()
    } catch {
      onDeleting?(nil)
      if let failed = error as? TemplateServiceError { serverError = failed } else { otherError = error.localizedDescription }
      confirmDelete = false
    }
  }

  static func field(_ name: String) -> Field? {
    switch name {
    case "name": return .name
    case "text", "variables": return .text
    case "quote": return .quote
    case "group": return .group
    case "shortcut": return .shortcut
    case "keywords": return .keywords
    default: return nil
    }
  }
}

/// `.lib-bone-card`: three bones, pulsing, while recent posts are read.
struct TemplateBones: View {
  @Environment(\.virgaTheme) private var theme
  @State private var dim = false

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Templates.boneGap) {
      ForEach([0.8, 0.6, 0.7], id: \.self) { share in
        GeometryReader { geometry in
          RoundedRectangle(cornerRadius: theme.radiusSm)
            .fill(theme.line)
            .frame(width: geometry.size.width * share, height: Measure.Templates.boneHeight)
        }
        .frame(height: Measure.Templates.boneHeight)
      }
    }
    .padding(Measure.Templates.previewPadding)
    .overlay(RoundedRectangle(cornerRadius: Measure.Templates.previewRadius).strokeBorder(theme.line, lineWidth: 1))
    .opacity(dim ? Measure.Templates.pulseLow : 1)
    .onAppear {
      guard !theme.reduceMotion else { return }
      withAnimation(.easeInOut(duration: Measure.Templates.pulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
    }
    .accessibilityHidden(true)
  }
}

/// A label with its icon after its words (a menu's chevron).
struct TrailingIconLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.title
      configuration.icon.imageScale(.small)
    }
  }
}
#endif
