// Ports src/posting/pages/TemplatesPage.jsx
// Ports src/posting/pages/hub.css (.hub-list, .hub-row, .tpl-row-item, .tpl-name, .tpl-name-button, .tpl-shortcut-chip, .tpl-chip, .tpl-group-head, .hub-notice, .empty-block)
//
// The account's templates: the posts and replies it starts from, grouped as
// the library shows them, most used first (TemplateUsage, kept on this
// device). Make, change and delete them here (TemplateEditor); Use starts
// a post from one. They're records in the account's repo, which anyone can
// read, and Anisota reads the same ones. Read through the account's own
// TemplatesModel (useTemplates).
//
// A row is led by its name (the way into the editor) with its /shortcut,
// Use and its ⋯ on the name's line at every width; its words (each blank a
// marked chip, named as it is asked or as it fills itself) and its facts
// take the row's width under them.
//
// Use opens the composer (ComposerHost) with the template's intent.
//
// iOS additions: /posting/templates/new opens the editor on a new template,
// and /posting/templates/<rkey> on that one, once it's read. A blank's chip is drawn on a tint
// in the run of words (a dashed edge can't be drawn inside text); the
// focus after a delete is the system's to place.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights
import VirgaPosting
import VirgaSession

struct TemplatesPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  @Environment(AppModel.self) private var app
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let did: String?
  /// The part of the address after the page: "new", or a template's rkey.
  let id: String?
  @State private var model: TemplatesModel
  @State private var editing: Editing?
  @State private var deleting: PostTemplate?
  @State private var openedFromAddress = false

  static let useWords = ["reply": "For replies", "post": "For new posts", "any": "For posts and replies"]
  static let attachWords = [
    "post": "Quotes a post", "feed": "Attaches a feed", "list": "Attaches a list", "link": "Attaches a link card",
    "unsupported": "Attaches pictures",
  ]

  /// Which template the editor is open on (nil for a new one).
  struct Editing: Identifiable {
    var template: PostTemplate?
    var id: String { template?.rkey ?? "new" }
  }

  init(session: SessionModel, did: String?, id: String? = nil) {
    self.did = did
    self.id = id
    _model = State(initialValue: TemplatesModel(session: session, did: did))
  }

  var body: some View {
    let templates = model.templates
    let caps = app.session.capabilitiesFor(did)
    // Read again whenever the list changes, so a use made in the composer shows.
    let usage = TemplateUsage.readTemplateUsage(did, store: app.stores.keyValue)
    let sorted = TemplateUsage.sortTemplatesForShelf(templates, usage)
    let prefix = "repo:\(PostTemplates.templateCollection)".utf16
    let canWrite = !caps.missing.contains { $0.utf16.starts(with: prefix) }
    VirgaPage(PostingHeader.model("templates")) {
      if !canWrite {
        Callout(tone: .warn) {
          ViewThatFits(in: .horizontal) {
            HStack(spacing: theme.space4) {
              Text("Virga needs permission to save templates in your repo. Sign in again to grant it.")
                .frame(maxWidth: .infinity, alignment: .leading)
              signInAgain
            }
            VStack(alignment: .leading, spacing: theme.space3) {
              Text("Virga needs permission to save templates in your repo. Sign in again to grant it.")
              signInAgain
            }
          }
        }
        .accessibilityIdentifier("templates-permission")
      }
      if model.error != nil && !templates.isEmpty {
        LoadError(message: "Your templates couldn’t be read again from your repo; these are the last ones seen.") {
          Task { await model.reload() }
        }
      }
      if model.loading && templates.isEmpty {
        RowSkeleton(rows: 3, actions: 1)
          .accessibilityLabel("Templates")
      } else if model.error != nil && templates.isEmpty {
        LoadError(message: "Your templates couldn’t be read from your repo.") { Task { await model.reload() } }
      } else if templates.isEmpty && model.ready {
        VStack(alignment: .leading, spacing: theme.points(ThemeKit.emptyBlockGap)) {
          Text(
            "No templates yet. A template is a post or reply to start from, with blanks it asks you to fill in, such as the name of the person you’re answering."
          )
          .virgaText(.textBase)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: theme.characters(56), alignment: .leading)
          Button {
            editing = Editing(template: nil)
          } label: {
            Label("New template", systemImage: Glyph.plus)
          }
          .buttonStyle(.virga)
          .disabled(!canWrite)
          .accessibilityIdentifier("templates-new")
        }
      } else if !templates.isEmpty {
        list(sorted, usage: usage, canWrite: canWrite, canPost: caps.canPost)
      }
    }
    .task { model.start() }
    .onDisappear { model.stop() }
    .onChange(of: templates.map(\.rkey), initial: true) { _, _ in openFromAddress(templates) }
    // On the template it opened on until it has gone; an address's editor
    // goes back to the page's own address once it has.
    .templateEditor(
      item: $editing, did: did, template: { $0.template },
      onDismiss: {
        if id != nil { navigate(PostingRoutes.postingPageByKey["templates"]?.path ?? "/posting/templates") }
      })
    .postingConfirm(
      isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), title: "Delete this template?",
      onConfirm: {
        guard let rkey = deleting?.rkey else { return }
        try await model.remove(rkey)
        toasts?.push("Template deleted.")
      }
    ) {
      Text(
        "“\(deleting?.name ?? "")” goes from your repo, so every app that reads your templates loses it, Anisota included. This can’t be undone."
      )
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("templates-page")
  }

  private var signInAgain: some View {
    Button("Sign in again") {
      if let did { AccountCopy.requestReauth(did, immediate: true) }
    }
    .buttonStyle(.virga(size: .small))
  }

  /// The address's template, opened once it has been read.
  private func openFromAddress(_ templates: [PostTemplate]) {
    guard let id, !openedFromAddress else { return }
    if id == "new" {
      openedFromAddress = true
      editing = Editing(template: nil)
    } else if let found = templates.first(where: { $0.rkey.jsEquals(id) }) {
      openedFromAddress = true
      editing = Editing(template: found)
    }
  }

  // MARK: The list

  private struct Group {
    var name: String
    var items: [PostTemplate]
  }

  private func groups(_ sorted: [PostTemplate]) -> [Group] {
    var out: [Group] = []
    for t in sorted {
      let name = t.group.jsTrimmed()
      if let last = out.last, last.name.jsEquals(name) {
        out[out.count - 1].items.append(t)
      } else {
        out.append(Group(name: name, items: [t]))
      }
    }
    return out
  }

  private func list(_ sorted: [PostTemplate], usage: TemplateUsageCounts, canWrite: Bool, canPost: Bool) -> some View {
    let grouped = groups(sorted)
    let anyGroup = grouped.contains { !$0.name.isEmpty }
    return VirgaSection(
      title: PostingWords.countPhrase(model.templates.count, "template"),
      sub: "Type a template’s /shortcut in the composer, or find it in the library.",
      trailing: AnyView(
        Button {
          editing = Editing(template: nil)
        } label: {
          Label("New template", systemImage: Glyph.plus)
        }
        .buttonStyle(.linkAction)
        .disabled(!canWrite)
        .accessibilityIdentifier("templates-new")),
      flush: true
    ) {
      ForEach(Array(grouped.enumerated()), id: \.offset) { _, group in
        VStack(alignment: .leading, spacing: 0) {
          if anyGroup {
            Text(group.name.isEmpty ? "Other templates" : group.name)
              .virgaText(.textSm, weight: VirgaWeight.semibold)
              .foregroundStyle(theme.ink2)
              .padding(.top, Measure.Templates.groupHeadAbove)
              .padding(.bottom, Measure.Templates.groupHeadBelow)
              .frame(maxWidth: .infinity, alignment: .leading)
              .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
              .accessibilityAddTraits(.isHeader)
          }
          ForEach(group.items, id: \.rkey) { t in
            row(t, usage: usage, canWrite: canWrite, canPost: canPost)
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(anyGroup ? (group.name.isEmpty ? "Other templates" : group.name) : "")
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("templates-list")
  }

  /// `usedLine(entry)`.
  static func usedLine(_ entry: TemplateUseEntry?) -> String {
    guard let entry, entry.count != 0 else { return "Not used here yet" }
    return "Used \(entry.count == 1 ? "once" : "\(AppLocale.formatNumber(entry.count)) times") in this browser"
  }

  private func row(_ t: PostTemplate, usage: TemplateUsageCounts, canWrite: Bool, canPost: Bool) -> some View {
    let facts = PostTemplates.describeTemplate(t, nil)
    let attach = EditorDrafts.templateEmbedKind(t.embed)
    let meta = [
      Self.useWords[t.use] ?? Self.useWords["any"] ?? "",
      facts.questions > 0 ? "Asks \(facts.questions == 1 ? "a question" : "\(facts.questions) questions")" : "",
      attach.flatMap { Self.attachWords[$0] } ?? "",
      t.keywords.isEmpty ? "" : "Suggested for \(t.keywords.prefix(4).joined(separator: ", "))",
      Self.usedLine(usage[t.rkey]),
    ].filter { !$0.isEmpty }
    return VStack(alignment: .leading, spacing: Measure.Templates.rowLineGap) {
      HStack(alignment: .center, spacing: Measure.Templates.rowColumnGap) {
        name(t, canWrite: canWrite)
          .frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: theme.points(ThemeKit.rowActionsGap)) {
          Button("Use") { use(t) }
            .buttonStyle(.virga(size: .small))
            .disabled(!canPost)
            .accessibilityLabel("Use “\(t.name)”")
          if canWrite {
            MoreMenu(
              label: "More for “\(t.name)”",
              entries: [
                .item(MenuItem("Edit", key: "edit", systemImage: Glyph.rename) { editing = Editing(template: t) }),
                .separator,
                .item(MenuItem("Delete", key: "delete", systemImage: Glyph.trash, destructive: true) { deleting = t }),
              ]
            )
            .padding(.trailing, theme.isPhone ? -Measure.Settings.dashMenuOutset : 0)
          }
        }
      }
      TemplateText(text: t.text)
      MetaLine(meta)
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("template-row-\(t.rkey)")
  }

  /// The name, which opens the editor, and its /shortcut.
  @ViewBuilder
  private func name(_ t: PostTemplate, canWrite: Bool) -> some View {
    let shortcut = t.shortcut
    let title = Text(t.name)
      .virgaText(.textMd, weight: VirgaWeight.medium)
      .foregroundStyle(theme.ink)
      .multilineTextAlignment(.leading)
    FlowLayout(spacing: Measure.Templates.nameGap, lineSpacing: 2, alignment: .firstTextBaseline) {
      if canWrite {
        Button {
          editing = Editing(template: t)
        } label: {
          // 44 to press, without looking any bigger.
          title.touchReach(horizontal: 0, vertical: Measure.LinkAction.reachAbove)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("template-name-\(t.rkey)")
      } else {
        title
      }
      if !shortcut.isEmpty {
        Text("/\(shortcut)")
          .font(theme.codeFont(around: theme.textSm))
          .foregroundStyle(theme.muted)
      }
    }
  }

  /// `composer.open({ asDid, templateId })`.
  private func use(_ t: PostTemplate) {
    let intent: JSONValue = ["asDid": did.map(JSONValue.string) ?? .null, "templateId": .string(t.rkey)]
    if let composer { composer.open(intent) } else { navigate("/posting/compose") }
  }
}

/// `TemplateText`: a template's words, each blank a chip named as it is
/// asked, or as it fills itself; nothing at all says so.
struct TemplateText: View {
  @Environment(\.virgaTheme) private var theme
  let text: String

  var body: some View {
    let parts = PostTemplates.splitTemplateText(text)
    if parts.isEmpty {
      Text("No text: it only attaches something.")
        .virgaText(.textBase, lineHeight: Measure.Templates.rowTextLineHeight)
        .foregroundStyle(theme.muted)
    } else {
      words(parts)
        .virgaText(.textBase, lineHeight: Measure.Templates.rowTextLineHeight)
        .foregroundStyle(theme.ink2)
        .lineLimit(2)
        .accessibilityLabel(parts.map(spoken).joined())
    }
  }

  private func label(_ key: String) -> String { PostTemplates.contextLabels[key] ?? key }

  private func spoken(_ part: TemplateSegment) -> String {
    switch part {
    case .text(let value): return value
    case .blank(let key): return "[\(label(key))]"
    }
  }

  private func words(_ parts: [TemplateSegment]) -> Text {
    var out = Text("")
    for part in parts {
      switch part {
      case .text(let value):
        out = out + Text(value)
      case .blank(let key):
        var chip = AttributedString("\u{2009}\(label(key))\u{2009}")
        chip.backgroundColor = theme.tint
        out = out + Text(chip).font(theme.font(size: theme.textSm))
      }
    }
    return out
  }
}
#endif
