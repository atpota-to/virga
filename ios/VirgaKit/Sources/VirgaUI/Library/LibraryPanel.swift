// Ports src/posting/library/LibraryPanel.jsx
// Ports src/posting/library/library.css (.lib-panel, .lib-rail, .lib-shelf, .lib-list, .lib-row, .lib-section-head, .lib-detail, .lib-item, .lib-card, .lib-skeleton)
//
// The library's browsing UI, shared by the dialog the composer opens and
// the Library page: the shelves (a row of words over the list, scrolling
// sideways), a search box that also reads a pasted link, the list in its
// sections, and the chosen item's detail with what using it does. A
// template asks its questions in the detail before it is used. Wider than
// 760 the list and the detail sit side by side; narrower, choosing a row
// opens its detail in the list's place, with Back to the list.
//
// Everything it reads is VirgaPosting's LibraryModel (useLibrary): the
// shelves, their items and sections, the search (local, then Bluesky's),
// a pasted link resolved, an item hydrated, and the plan an item makes.
// Not here: the arrow keys and Enter through the list (a hardware
// keyboard), and ⌘↩ using the chosen item.

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaCore
import VirgaNetwork
import VirgaPosting

/// The library's measures, from library.css.
enum LibraryMeasure {
  /// `.lib-body { grid-template-columns: … minmax(0, 340px) }`, 360 on the page.
  static let detailWidth: CGFloat = 340
  static let pageDetailWidth: CGFloat = 360
  /// `.lib-row { gap: 12px }`, `.lib-row-thumb { 44 × 44 }`
  static let rowGap: CGFloat = 12
  static let thumb: CGFloat = 44
  /// `.lib-section-head { padding: 18px 0 8px }`
  static let sectionTop: CGFloat = 18
  static let sectionBelow: CGFloat = 8
  /// The rule beside the chosen row (`.lib-row[aria-selected]::before`).
  static let chosenRule: CGFloat = 2
  /// `.lib-panel { gap: 16px }`
  static let gap: CGFloat = 16
}

/// The shelves' icons (LibraryPanel's SHELF_ICONS, as SF Symbols).
enum LibraryGlyph {
  static func shelf(_ id: String) -> String {
    switch id {
    case "suggested": return "sparkles"
    case "templates": return "rectangle.3.offgrid"
    case "replies": return "bubble.left"
    case "saved": return "bookmark"
    case "links": return "link"
    case "feeds": return "antenna.radiowaves.left.and.right"
    case "lists": return "list.bullet"
    case "search": return "magnifyingglass"
    default: return "doc.text"
    }
  }
}

/// What the panel is in: the composer's dialog, or the page.
enum LibraryPanelMode {
  case dialog, page
}

/// `errorText(err)`: why an item couldn't be read or used.
func libraryErrorText(_ error: (any Error)?) -> String {
  guard let error else { return "" }
  if let pick = error as? LibraryPickError {
    if pick.code == LibraryPickError.gone { return pick.message.isEmpty ? "That isn’t there any more." : pick.message }
    if pick.code == "QUOTES_OFF" { return pick.message.isEmpty ? "Its author doesn’t allow quotes." : pick.message }
  }
  let message = ComposerController.message(error)
  return message.isEmpty ? "Couldn’t read it. Try again." : "Couldn’t read it: \(message)"
}

struct LibraryPanel: View {
  @Environment(\.virgaTheme) private var theme
  let lib: LibraryModel
  let mode: LibraryPanelMode
  /// The post being written (the composer's state), for the preview.
  var state: JSONValue? = nil
  var postIndex = 0
  var insertion: TextSelection? = nil
  var initialShelf = "templates"
  var focusTemplate: String? = nil
  var verb: String? = nil
  var transport: any HTTPTransport
  var onNewTemplate: (() -> Void)? = nil
  /// Acts on a choice; a thrown error is shown under the button.
  let onUse: (LibraryItem, [String: String]) async throws -> Void

  @State private var shelfId: String?
  @State private var selectedId: String?
  @State private var phoneDetail = false
  @State private var using: String?
  @State private var useError: String?
  @State private var hydrated: [String: LibraryItem] = [:]
  @State private var hydrateErrors: [String: String] = [:]
  @State private var pasted: (text: String, status: String, item: LibraryItem?) = (text: "", status: "idle", item: nil)
  @State private var focused = false

  private var narrow: Bool { theme.windowWidth <= Breakpoint.tablet }
  private var trimmed: String { lib.query.jsTrimmed() }
  private var searching: Bool { !trimmed.isEmpty }

  private var shelf: LibraryShelfSummary? {
    let shelves = lib.shelves
    return shelves.first { $0.id == (shelfId ?? initialShelf) } ?? shelves.first
  }

  /// The list's sections: the search's, or the shelf's.
  private var sections: [LibrarySection] {
    if searching {
      var out: [LibrarySection] = []
      if let item = pasted.item { out.append(LibrarySection(id: "pasted", heading: "From the link", muted: false, items: [item])) }
      if !lib.local.isEmpty { out.append(LibrarySection(id: "local", heading: "In your library", muted: false, items: lib.local)) }
      let remote = lib.remoteSearch
      if !remote.posts.isEmpty {
        out.append(LibrarySection(id: "remote", heading: lib.mine ? "Your posts on Bluesky" : "On Bluesky", muted: false, items: remote.posts))
      }
      return out
    }
    guard let shelf, shelf.id != "search" else { return [] }
    return LibraryUI.sectionsFor(
      shelf.id, lib.items(shelf.id), templateSections: shelf.id == "templates" ? lib.templateSections() : nil)
  }

  private func flat(_ sections: [LibrarySection]) -> [LibraryItem] {
    var seen = Set<JSKey>()
    var out: [LibraryItem] = []
    for section in sections {
      for item in section.items where !seen.contains(JSKey(item.id)) {
        seen.insert(JSKey(item.id))
        out.append(item)
      }
    }
    return out
  }

  var body: some View {
    let sections = self.sections
    let items = flat(sections)
    let selected = items.first { Optional($0.id).jsEquals(selectedId) } ?? (narrow ? nil : items.first)
    let shown = selected.map { hydrated[$0.id] ?? $0 }
    VStack(alignment: .leading, spacing: LibraryMeasure.gap) {
      if !narrow || !phoneDetail {
        SearchField("Search, or paste a link", text: Binding(get: { lib.query }, set: { lib.setQuery($0) }))
          .accessibilityLabel("Search the library or paste a link")
          .accessibilityIdentifier("library-search")
        shelfRow
      }
      if narrow {
        if phoneDetail, let shown {
          Button {
            phoneDetail = false
            selectedId = nil
          } label: {
            Label("Back to the list", systemImage: "arrow.left")
          }
          .buttonStyle(.linkAction)
          detail(shown)
        } else {
          list(sections, items: items, selected: nil)
        }
      } else {
        HStack(alignment: .top, spacing: theme.space5) {
          list(sections, items: items, selected: selected?.id)
            .frame(maxWidth: .infinity, alignment: .topLeading)
          Group {
            if let shown {
              detail(shown)
            } else {
              Text("Choose something on the left to see what it adds.").foregroundStyle(theme.muted)
            }
          }
          .frame(maxWidth: mode == .page ? LibraryMeasure.pageDetailWidth : LibraryMeasure.detailWidth, alignment: .topLeading)
        }
      }
    }
    .task(id: shelf?.id) { if let id = shelf?.id { lib.ensure(id) } }
    .task(id: trimmed) { await readPasted(trimmed) }
    .task(id: shown?.id) { if let shown { await hydrate(shown) } }
    .onChange(of: lib.items("templates").count, initial: true) { _, _ in focusOnTemplate() }
    .onChange(of: selectedId) { _, _ in useError = nil }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("library-panel")
  }

  // MARK: The shelves

  private var shelfRow: some View {
    let shelves = lib.shelves
    return Segmented(
      label: "Shelves",
      options: shelves.map { s in
        let count = s.id != "search" ? s.count.flatMap { $0 > 0 ? " \(AppLocale.formatNumber($0))" : nil } ?? "" : ""
        return SegmentedOption(s.id, "\(s.label)\(count)", systemImage: LibraryGlyph.shelf(s.id))
      },
      selection: Binding(get: { searching ? "" : (shelf?.id ?? "") }, set: { pickShelf($0) }),
      size: .small)
  }

  private func pickShelf(_ id: String) {
    shelfId = id
    selectedId = nil
    phoneDetail = false
    if !lib.query.isEmpty { lib.setQuery("") }
  }

  /// A template asked for by its rkey (the slash menu's "open the library on it").
  private func focusOnTemplate() {
    guard let focusTemplate else { return }
    guard let found = lib.items("templates").first(where: { $0.source?["rkey"]?.stringValue == focusTemplate }) else { return }
    shelfId = "templates"
    selectedId = found.id
    if narrow { phoneDetail = true }
  }

  // MARK: The list

  private var listStatus: String {
    if searching {
      if pasted.status == "loading" { return "loading" }
      let empty = flat(sections).isEmpty
      if lib.localStatus == "loading" && empty { return "loading" }
      if lib.remoteSearch.status == "loading" && empty { return "loading" }
      return "ready"
    }
    guard let shelf, shelf.id != "search" else { return "ready" }
    if flat(sections).isEmpty && (shelf.status == "loading" || shelf.status == "idle") { return "loading" }
    return "ready"
  }

  private var listHint: String {
    if searching { return trimmed.hasPrefix("/") ? "Templates with that shortcut." : "In your library, then on Bluesky." }
    return LibraryUI.shelfHint[shelf?.id ?? ""] ?? ""
  }

  @ViewBuilder
  private func list(_ sections: [LibrarySection], items: [LibraryItem], selected: String?) -> some View {
    VStack(alignment: .leading, spacing: theme.space2) {
      listHead
      if !searching, let shelf, shelf.status == "error" {
        Callout(tone: .danger) {
          VStack(alignment: .leading, spacing: theme.space2) {
            Text(libraryErrorText(shelf.error).isEmpty ? "This shelf couldn’t be read." : libraryErrorText(shelf.error))
            Button("Try again") { lib.retry(shelf.id) }.buttonStyle(.virga(size: .small))
          }
        }
      }
      if listStatus == "loading" {
        LibrarySkeleton()
      } else if items.isEmpty {
        Text(emptyLine).foregroundStyle(theme.muted).accessibilityIdentifier("library-empty")
      } else {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(sections, id: \.id) { section in
            if let heading = section.heading {
              Text(heading)
                .virgaText(.textSm, weight: VirgaWeight.semibold)
                .foregroundStyle(theme.ink2)
                .padding(.top, LibraryMeasure.sectionTop)
                .padding(.bottom, LibraryMeasure.sectionBelow)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
                .accessibilityAddTraits(.isHeader)
            }
            ForEach(section.items, id: \.id) { item in
              LibraryItemRow(item: item, chosen: Optional(item.id).jsEquals(selected), transport: transport) { choose(item) }
                .opacity(section.muted ? 0.7 : 1)
            }
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("library-list")
      }
      listFoot
    }
  }

  private var emptyLine: String {
    if searching {
      if pasted.status == "none" { return "Nothing could be read from that link. Check it and try again." }
      if lib.remoteSearch.status == "error" { return "Search on Bluesky didn’t answer." }
      return "Nothing matches that."
    }
    return LibraryUI.shelfEmpty[shelf?.id ?? ""] ?? "Nothing here yet."
  }

  private var listHead: some View {
    VStack(alignment: .leading, spacing: theme.space2) {
      if !listHint.isEmpty { Text(listHint).virgaText(.textSm).foregroundStyle(theme.muted) }
      if !searching, let id = shelf?.id, id == "posts" || id == "replies" {
        Segmented(
          label: "Order", options: [SegmentedOption("date", "Newest"), SegmentedOption("engagement", "Most engagement")],
          selection: Binding(get: { lib.sort }, set: { lib.setSort($0) }), size: .small)
      }
      if searching && !trimmed.hasPrefix("/") && !LibraryUI.looksLikeLink(trimmed) {
        Toggle("Only my posts", isOn: Binding(get: { lib.mine }, set: { lib.setMine($0) })).toggleStyle(.virgaCheck)
      }
      if !searching, shelf?.id == "templates", let onNewTemplate {
        Button(action: onNewTemplate) { Label("New template", systemImage: Glyph.plus) }
          .buttonStyle(.linkAction)
          .accessibilityIdentifier("library-new-template")
      }
    }
  }

  @ViewBuilder private var listFoot: some View {
    let remote = lib.remoteSearch
    if searching && remote.status == "error" {
      Callout(tone: .danger) {
        VStack(alignment: .leading, spacing: theme.space2) {
          Text("Search on Bluesky didn’t answer.")
          Button("Try again") { lib.retrySearch() }.buttonStyle(.virga(size: .small))
        }
      }
    }
    if searching && remote.status == "loading" && !flat(sections).isEmpty {
      Text("Searching Bluesky…").virgaText(.textSm).foregroundStyle(theme.muted)
    }
    let more = searching ? remote.hasMore : (shelf.map { lib.hasMore($0.id) } ?? false)
    let loadingMore = searching ? remote.loadingMore : (shelf?.loadingMore ?? false)
    if more {
      Button(loadingMore ? "Loading…" : "Show more") {
        if searching { lib.loadMoreSearch() } else if let id = shelf?.id { lib.loadMore(id) }
      }
      .buttonStyle(.virga(.ghost, size: .small))
      .disabled(loadingMore)
    }
  }

  private func choose(_ item: LibraryItem) {
    selectedId = item.id
    if narrow { phoneDetail = true }
  }

  // MARK: Reading

  /// A pasted link is read as the item it names, a moment after typing stops.
  private func readPasted(_ text: String) async {
    guard LibraryUI.looksLikeLink(text) else {
      if pasted.status != "idle" { pasted = (text: "", status: "idle", item: nil) }
      return
    }
    pasted = (text: text, status: "loading", item: nil)
    try? await Task.sleep(nanoseconds: 300_000_000)
    if Task.isCancelled { return }
    let item = try? await lib.resolveLink(text)
    if Task.isCancelled { return }
    if let found = item ?? nil {
      pasted = (text: text, status: "ready", item: found)
    } else {
      pasted = (text: text, status: "none", item: nil)
    }
  }

  /// A post, feed or list is read again when it's shown, for its full text and its card.
  private func hydrate(_ item: LibraryItem) async {
    guard hydrated[item.id] == nil, hydrateErrors[item.id] == nil else { return }
    guard ["post", "feed", "list"].contains(item.kind), item.view == nil || item.cid == nil else { return }
    do {
      var fresh = try await lib.hydrate(item)
      fresh.id = item.id
      hydrated[item.id] = fresh
    } catch {
      hydrateErrors[item.id] = libraryErrorText(error)
    }
  }

  // MARK: The chosen item

  private func detail(_ item: LibraryItem) -> some View {
    LibraryItemDetail(
      lib: lib, item: item, state: state, postIndex: postIndex, insertion: insertion, verb: verb,
      busy: using == item.id, error: useError, hydrateError: hydrateErrors[item.id]
    ) { answers in
      Task { await use(item, answers) }
    }
    .id(item.id)
  }

  private func use(_ item: LibraryItem, _ answers: [String: String]) async {
    guard using == nil else { return }
    using = item.id
    useError = nil
    defer { using = nil }
    do {
      try await onUse(item, answers)
    } catch {
      let text = libraryErrorText(error)
      useError = text.isEmpty ? "That couldn’t be added. Try again." : text
    }
  }
}

/// Rows shaped like the list, while a shelf loads.
struct LibrarySkeleton: View {
  @Environment(\.virgaTheme) private var theme
  var rows = 5
  static let titles: [CGFloat] = [0.72, 0.56, 0.80, 0.48, 0.64]
  static let lines: [CGFloat] = [0.40, 0.32, 0.46, 0.28, 0.36]

  var body: some View {
    GeometryReader { proxy in
      VStack(alignment: .leading, spacing: theme.space4) {
        ForEach(0..<rows, id: \.self) { i in
          VStack(alignment: .leading, spacing: theme.space2) {
            Capsule().fill(theme.surface3).frame(width: proxy.size.width * Self.titles[i % 5], height: 12)
            Capsule().fill(theme.surface3).frame(width: proxy.size.width * Self.lines[i % 5], height: 10)
          }
        }
      }
    }
    .frame(height: CGFloat(rows) * 44)
    .accessibilityHidden(true)
  }
}

/// A thing on the shelf: a row between hairlines, the chosen one with a
/// rule in the accent beside it.
struct LibraryItemRow: View {
  @Environment(\.virgaTheme) private var theme
  let item: LibraryItem
  let chosen: Bool
  let transport: any HTTPTransport
  let onPick: () -> Void

  var body: some View {
    Button(action: onPick) {
      HStack(alignment: .top, spacing: LibraryMeasure.rowGap) {
        if let thumb = item.media?.thumb, !thumb.isEmpty {
          TransportImage(url: thumb, transport: transport)
            .frame(width: LibraryMeasure.thumb, height: LibraryMeasure.thumb)
            .background(theme.surface3)
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusSm))
            .accessibilityHidden(true)
        }
        VStack(alignment: .leading, spacing: 2) {
          HStack(alignment: .firstTextBaseline, spacing: theme.space2) {
            Text(item.title)
              .virgaText(.textBase, weight: chosen ? VirgaWeight.semibold : VirgaWeight.medium)
              .foregroundStyle(theme.ink)
            if !item.shortcut.isEmpty {
              Text(item.shortcut).font(theme.font(size: theme.textSm)).monospaced().foregroundStyle(theme.muted)
            }
          }
          if !item.reason.isEmpty {
            Text(item.reason).virgaText(.textSm).foregroundStyle(theme.muted)
          } else if !item.label.isEmpty {
            MetaLine(item.label.components(separatedBy: " · "))
          }
          if !item.excerpt.isEmpty {
            Text(item.excerpt).virgaText(.textSm).foregroundStyle(theme.ink2).lineLimit(2)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(.vertical, theme.rowPad)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .overlay(alignment: .leading) {
      if chosen { Rectangle().fill(theme.accent).frame(width: LibraryMeasure.chosenRule).offset(x: -theme.space2) }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
    .accessibilityIdentifier("library-row")
  }
}

/// The chosen item: what it is, what using it does, and the button (or a
/// template's questions first).
struct LibraryItemDetail: View {
  @Environment(\.virgaTheme) private var theme
  let lib: LibraryModel
  let item: LibraryItem
  let state: JSONValue?
  let postIndex: Int
  let insertion: TextSelection?
  let verb: String?
  let busy: Bool
  let error: String?
  let hydrateError: String?
  let onUse: ([String: String]) -> Void

  private func preview(_ answers: [String: String]) -> LibraryPreview {
    Library.previewFor(
      item, state: state, postIndex: postIndex, currentText: state == nil ? "" : nil, insertion: insertion,
      answers: .object(answers.mapValues(JSONValue.string)), context: lib.context, quoteSlotLocked: lib.quoteSlotLocked)
  }

  var body: some View {
    let replying = lib.replying
    let label = verb ?? Library.verbFor(item, replying: replying) ?? "Use it"
    let isTemplate = item.kind == "template"
    let template = isTemplate ? PostTemplate(json: item.source ?? .null) : nil
    let asks = template.map { PostTemplates.templateQuestions($0, lib.context).count } ?? 0
    VStack(alignment: .leading, spacing: theme.space4) {
      VStack(alignment: .leading, spacing: theme.space1) {
        Text(item.title)
          .virgaText(.textLg, weight: VirgaWeight.semibold)
          .foregroundStyle(theme.ink)
          .accessibilityAddTraits(.isHeader)
        Text(Library.effectFor(item, lib.context)).virgaText(.textSm).foregroundStyle(theme.muted)
      }
      what
      if let template, asks > 0 {
        TemplateQuestions(
          template: template, context: lib.context, embedView: item.embedView, submitLabel: label, busy: busy,
          preview: { preview($0) }, onDone: { onUse($0) })
      } else {
        use(label: label, isTemplate: isTemplate, replying: replying)
      }
      if let error {
        Callout(tone: .danger) { Text(error) }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("library-detail")
  }

  @ViewBuilder private var what: some View {
    if item.kind == "post" {
      if let view = item.view {
        ComposerPostPreview(view: view, text: nil)
      } else if let hydrateError {
        Callout(tone: .warn) { Text(hydrateError) }
      } else {
        VStack(alignment: .leading, spacing: theme.space2) {
          Capsule().fill(theme.surface3).frame(width: 120, height: 12)
          Capsule().fill(theme.surface3).frame(height: 10)
        }
        .accessibilityHidden(true)
      }
    }
    if item.kind == "feed" || item.kind == "list" || item.kind == "link" {
      VStack(alignment: .leading, spacing: theme.space1) {
        Text(item.title).virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
        if !item.excerpt.isEmpty { Text(item.excerpt).virgaText(.textSm).foregroundStyle(theme.ink2) }
        if let url = item.url, let link = URL(string: url) {
          Link("Open the link", destination: link).virgaText(.textSm).tint(theme.ink)
        }
      }
      .padding(theme.space3)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(RoundedRectangle(cornerRadius: theme.radiusLg).strokeBorder(theme.line))
    }
  }

  @ViewBuilder
  private func use(label: String, isTemplate: Bool, replying: Bool) -> some View {
    let shown = preview([:])
    if isTemplate || state != nil {
      TemplatePreviewView(preview: shown, label: replying ? "Your reply will read" : "Your post will read")
    }
    if !isTemplate && state == nil, let blocked = shown.blocked {
      Text(blocked).virgaText(.textSm).foregroundStyle(theme.warn)
    }
    HStack {
      Spacer(minLength: 0)
      Button(busy ? "Adding…" : label) { onUse([:]) }
        .buttonStyle(.virga(.primary))
        .disabled(busy || !shown.usable || hydrateError != nil)
        .accessibilityIdentifier("library-use")
    }
  }
}
#endif
