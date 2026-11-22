// Ports src/posting/library/LibraryPanel.jsx
// Ports src/posting/library/library.css (.lib-panel, .lib-search, .lib-rail, .lib-shelf, .lib-list, .lib-list-head, .lib-status, .lib-row, .lib-section-head, .lib-empty, .lib-detail, .lib-item, .lib-card, .lib-skeleton, .lib-bone, .lib-bone-card, .lib-questions-actions)
//
// The library's browsing UI, shared by the dialog the composer opens and
// the Library page: the shelves (a row of words over the list, scrolling
// sideways), a search box that also reads a pasted link, the list in its
// sections, and the chosen item's detail with what using it does. A
// template asks its questions in the detail before it is used. Wider than
// 760 the list and the detail sit side by side, their columns chosen by
// the panel's own width (`container: lib`): 340 for the detail (360 on the
// page), 300 from 800 down (and from 960 down on the page), halves from
// 640 down. Narrower, choosing a row opens its detail in the list's place,
// with Back to the list. In the dialog the list and the detail each scroll
// by themselves under the search and the shelves; on the page the page
// scrolls, and the chosen item stays in view beside the list.
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
  /// `.lib-body { grid-template-columns: … minmax(0, 340px); gap: 28px }`,
  /// 360 and 40 on the page.
  static let detailWidth: CGFloat = 340
  static let pageDetailWidth: CGFloat = 360
  static let columnGap: CGFloat = 28
  static let pageColumnGap: CGFloat = 40
  /// `@container lib (max-width: 960px)` (the page's 300), `(max-width:
  /// 800px)` (`1fr | 300`, 28 apart) and `(max-width: 640px)` (halves, 24 apart).
  static let roomyPanel: CGFloat = 960
  static let twoColumnPanel: CGFloat = 800
  static let halvesPanel: CGFloat = 640
  static let narrowDetailWidth: CGFloat = 300
  static let halvesGap: CGFloat = 24
  /// `.lib-panel { gap: 16px }`, `.lib-body`'s rows 16 apart (14 from 760 down).
  static let gap: CGFloat = 16
  static let phoneGap: CGFloat = 14
  /// `.lib-dialog .dialog-body { padding: 4px 24px 20px }`, `0 16px 12px` from 760 down.
  static let dialogBody = EdgeInsets(top: 4, leading: 24, bottom: 20, trailing: 24)
  static let phoneDialogBody = EdgeInsets(top: 0, leading: 16, bottom: 12, trailing: 16)
  /// `.lib-search > .input { padding-right: 36px }`, `.lib-search > .btn { right: 4px }`
  static let searchTrailing: CGFloat = 36
  static let searchClearInset: CGFloat = 4
  /// `.lib-rail ul { gap: 22px }`, `.lib-shelf { gap: 6px }` (its icon 15),
  /// the current one's `inset 0 -2px 0 var(--ink)`.
  static let shelfGap: CGFloat = 22
  static let shelfInnerGap: CGFloat = 6
  static let shelfIcon: CGFloat = 15
  static let shelfLine: CGFloat = 2
  /// `.lib-list-head { gap: 8px 16px; padding-bottom: 12px }`; from 760 down
  /// `min-height: 42px; padding-bottom: 10px`.
  static let headRowGap: CGFloat = 8
  static let headColumnGap: CGFloat = 16
  static let headBelow: CGFloat = 12
  static let phoneHeadBelow: CGFloat = 10
  static let phoneHeadMin: CGFloat = 42
  /// `.lib-status { gap: 10px 16px; margin-top: 12px }`, its words `flex: 1 1 260px`.
  static let statusRowGap: CGFloat = 10
  static let statusColumnGap: CGFloat = 16
  static let statusTop: CGFloat = 12
  static let statusWordsMin: CGFloat = 260
  /// `.lib-row { gap: 12px; padding: var(--row-pad) 8px var(--row-pad) 0 }`,
  /// 48 tall at least from 760 down; `.lib-row-thumb { 40 × 40 }`;
  /// `.lib-row-text { gap: 2px }`.
  static let rowGap: CGFloat = 12
  static let rowTrailing: CGFloat = 8
  static let phoneRowMin: CGFloat = 48
  static let thumb: CGFloat = 40
  static let rowTextGap: CGFloat = 2
  /// `.lib-section-head { padding: 18px 0 8px }`
  static let sectionTop: CGFloat = 18
  static let sectionBelow: CGFloat = 8
  /// The rule beside the chosen row (`.lib-row[aria-selected]::before {
  /// left: -12px; width: 2px }`), and the dialog's list let out to keep it.
  static let chosenRule: CGFloat = 2
  static let chosenRuleOutset: CGFloat = 12
  /// `.lib-detail { gap: 12px }`, `.lib-item { gap: 14px }`,
  /// `.lib-item-head { gap: 4px; padding-bottom: 12px }`.
  static let detailGap: CGFloat = 12
  static let itemGap: CGFloat = 14
  static let itemHeadGap: CGFloat = 4
  static let itemHeadBelow: CGFloat = 12
  /// `.lib-card { gap: 4px; padding: 12px 14px; border-radius: 12px }`
  static let cardGap: CGFloat = 4
  static let cardPadding = EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
  static let cardRadius: CGFloat = 12
  /// `.lib-skeleton-row { gap: 8px; padding: 14px 0 }`; `.lib-bone` 10 tall, a title's 12.
  static let skeletonGap: CGFloat = 8
  static let skeletonPadding: CGFloat = 14
  static let boneHeight: CGFloat = 10
  static let titleBoneHeight: CGFloat = 12
  /// `.lib-panel[data-mode='page'] .lib-detail { position: sticky; top: 24px }`
  static let stickyTop: CGFloat = 24
  /// `.lib-questions-actions { padding: 10px 0 2px }` while held at the sheet's foot.
  static let pinnedActions = EdgeInsets(top: 10, leading: 0, bottom: 2, trailing: 0)
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

/// The list's and the detail's columns, for the panel's width.
struct LibraryColumns {
  var detail: CGFloat
  var gap: CGFloat
}

private struct LibraryPinsActionsKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// Set on the phone's dialog's detail: its use button is held at the
  /// sheet's foot (`.lib-questions-actions { position: sticky; bottom: 0 }`).
  var libraryPinsActions: Bool {
    get { self[LibraryPinsActionsKey.self] }
    set { self[LibraryPinsActionsKey.self] = newValue }
  }
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
  /// Set as a row is chosen on a phone: the detail takes the focus.
  @State private var focusDetail = false
  @State private var using: String?
  @State private var useError: String?
  @State private var hydrated: [String: LibraryItem] = [:]
  @State private var hydrateErrors: [String: String] = [:]
  @State private var pasted: (text: String, status: String, item: LibraryItem?) = (text: "", status: "idle", item: nil)
  /// The panel's own width (`container: lib / inline-size`).
  @State private var panelWidth: CGFloat = 0
  /// The list and the detail's row, on the page, for the detail held beside it.
  @State private var rowHeight: CGFloat = 0
  @FocusState private var searchFocused: Bool

  /// `useIsNarrow('(max-width: 760px)')`: the window's width.
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

  /// The columns `.lib-body` takes in the room the panel has.
  private var columns: LibraryColumns {
    let width = panelWidth > 0 ? panelWidth : theme.windowWidth
    if width <= LibraryMeasure.halvesPanel {
      let gap = LibraryMeasure.halvesGap
      return LibraryColumns(detail: max(0, (width - gap) / 2), gap: gap)
    }
    if width <= LibraryMeasure.twoColumnPanel {
      return LibraryColumns(detail: LibraryMeasure.narrowDetailWidth, gap: LibraryMeasure.columnGap)
    }
    if mode == .page {
      if width <= LibraryMeasure.roomyPanel {
        return LibraryColumns(detail: LibraryMeasure.narrowDetailWidth, gap: LibraryMeasure.columnGap)
      }
      return LibraryColumns(detail: LibraryMeasure.pageDetailWidth, gap: LibraryMeasure.pageColumnGap)
    }
    return LibraryColumns(detail: LibraryMeasure.detailWidth, gap: LibraryMeasure.columnGap)
  }

  var body: some View {
    let sections = self.sections
    let items = flat(sections)
    let selected = items.first { Optional($0.id).jsEquals(selectedId) } ?? (narrow ? nil : items.first)
    let shown = selected.map { hydrated[$0.id] ?? $0 }
    Group {
      if narrow {
        narrowBody(sections, items: items, shown: shown)
      } else {
        wideBody(sections, items: items, selected: selected, shown: shown)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: mode == .dialog ? .infinity : nil, alignment: .topLeading)
    .background {
      GeometryReader { geometry in
        Color.clear
          .onAppear { panelWidth = geometry.size.width }
          .onChange(of: geometry.size.width) { _, width in panelWidth = width }
      }
    }
    .task(id: shelf?.id) { if let id = shelf?.id { lib.ensure(id) } }
    .task(id: trimmed) { await readPasted(trimmed) }
    .task(id: shown?.id) { if let shown { await hydrate(shown) } }
    .onChange(of: lib.items("templates").count, initial: true) { _, _ in focusOnTemplate() }
    .onChange(of: selectedId) { _, _ in useError = nil }
    // `data-autofocus` in the dialog: the search has the keyboard as it opens.
    .onAppear { if mode == .dialog { searchFocused = true } }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("library-panel")
  }

  // MARK: The two layouts

  /// 760 and under: the search, the shelves and the list, or the chosen
  /// item in their place.
  @ViewBuilder
  private func narrowBody(_ sections: [LibrarySection], items: [LibraryItem], shown: LibraryItem?) -> some View {
    if phoneDetail, let shown {
      column(pinsActions: mode == .dialog) {
        VStack(alignment: .leading, spacing: LibraryMeasure.detailGap) {
          Button {
            phoneDetail = false
            selectedId = nil
            focusDetail = false
          } label: {
            Label("Back to the list", systemImage: "arrow.left")
          }
          .buttonStyle(.linkAction)
          detail(shown)
        }
      }
    } else {
      VStack(alignment: .leading, spacing: 0) {
        searchBox
          .padding(.bottom, mode == .dialog ? LibraryMeasure.gap : LibraryMeasure.phoneGap)
        shelfRow
          .padding(.bottom, LibraryMeasure.phoneGap)
        column(letOut: false) {
          list(sections, items: items, selected: nil)
        }
      }
    }
  }

  /// Wider than 760: the search and the shelves over the list and the
  /// chosen item side by side.
  private func wideBody(_ sections: [LibrarySection], items: [LibraryItem], selected: LibraryItem?, shown: LibraryItem?) -> some View {
    let columns = self.columns
    return VStack(alignment: .leading, spacing: LibraryMeasure.gap) {
      searchBox
      shelfRow
      HStack(alignment: .top, spacing: columns.gap) {
        column(letOut: true) {
          list(sections, items: items, selected: selected?.id)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        detailColumn(shown)
          .frame(width: columns.detail, alignment: .topLeading)
      }
      .frame(maxHeight: mode == .dialog ? .infinity : nil, alignment: .top)
      .background {
        GeometryReader { geometry in
          Color.clear
            .onAppear { rowHeight = geometry.size.height }
            .onChange(of: geometry.size.height) { _, height in rowHeight = height }
        }
      }
    }
  }

  /// A column that scrolls by itself in the dialog (`.lib-list, .lib-detail
  /// { overflow-y: auto }`); on the page the page scrolls. The dialog's
  /// list is let out 12 at its start, so the chosen row's rule isn't
  /// clipped by its scrolling.
  @ViewBuilder
  private func column<Content: View>(letOut: Bool = false, pinsActions: Bool = false, @ViewBuilder _ content: () -> Content) -> some View {
    if mode == .dialog {
      let outset = letOut ? LibraryMeasure.chosenRuleOutset : 0
      ScrollView {
        content()
          .frame(maxWidth: .infinity, alignment: .topLeading)
          .padding(.leading, outset)
      }
      .scrollBounceBehavior(.basedOnSize)
      .scrollDismissesKeyboard(.interactively)
      .padding(.leading, -outset)
      .environment(\.libraryPinsActions, pinsActions)
    } else {
      content()
    }
  }

  @ViewBuilder
  private func detailColumn(_ shown: LibraryItem?) -> some View {
    let inner = Group {
      if let shown {
        detail(shown)
      } else {
        Text("Choose something on the left to see what it adds.")
          .virgaText(.textBase)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    if mode == .dialog {
      column { inner }
    } else {
      inner.modifier(LibraryStickyTop(rowHeight: rowHeight))
    }
  }

  // MARK: The search and the shelves

  /// `.lib-search`: the glass inside its start, and Clear the search inside
  /// its end while there's a query. A first Escape clears the search; the
  /// next one is the dialog's.
  private var searchBox: some View {
    let query = Binding(get: { lib.query }, set: { lib.setQuery($0) })
    return VirgaTextField("Search, or paste a link", text: query)
      .padding(.trailing, LibraryMeasure.searchTrailing - theme.points(ThemeKit.inputPadding.right))
      .virgaField(leading: theme.points(ThemeKit.searchInputLeading))
      .focused($searchFocused)
      .submitLabel(.search)
      .onKeyPress(.escape) {
        guard !lib.query.isEmpty else { return .ignored }
        lib.setQuery("")
        return .handled
      }
      .accessibilityLabel("Search the library or paste a link")
      .accessibilityIdentifier("library-search")
      .overlay(alignment: .leading) {
        Image(systemName: Glyph.search)
          .virgaGlyph(Measure.Field.searchIcon, beside: theme.points(ThemeKit.touchInputFontSize))
          .foregroundStyle(theme.muted)
          .padding(.leading, theme.points(ThemeKit.searchIconInset))
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      .overlay(alignment: .trailing) {
        if !lib.query.isEmpty {
          Button {
            lib.setQuery("")
          } label: {
            Image(systemName: Glyph.close)
          }
          .buttonStyle(.virga(.ghost, size: .small, icon: true))
          .accessibilityLabel("Clear the search")
          .help("Clear the search")
          .padding(.trailing, LibraryMeasure.searchClearInset)
        }
      }
  }

  private var shelfRow: some View {
    LibraryShelfRow(
      shelves: lib.shelves, current: searching ? nil : shelf?.id,
      runsOut: narrow ? (mode == .dialog ? LibraryMeasure.phoneDialogBody.leading : theme.pagePad) : 0
    ) { pickShelf($0) }
  }

  private func pickShelf(_ id: String) {
    shelfId = id
    selectedId = nil
    phoneDetail = false
    focusDetail = false
    if !lib.query.isEmpty { lib.setQuery("") }
    if id == "search" {
      DispatchQueue.main.async { searchFocused = true }
    }
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

  private func list(_ sections: [LibrarySection], items: [LibraryItem], selected: String?) -> some View {
    let remote = lib.remoteSearch
    let searchingLine = searching && remote.status == "loading" && !items.isEmpty ? "Searching Bluesky…" : nil
    return VStack(alignment: .leading, spacing: 0) {
      listHead
      if !searching, let shelf, shelf.status == "error" {
        let words = libraryErrorText(shelf.error).isEmpty ? "This shelf couldn’t be read." : libraryErrorText(shelf.error)
        LibraryStatus(words: words) { lib.retry(shelf.id) }
      }
      if listStatus == "loading" {
        LibrarySkeleton()
      } else if items.isEmpty {
        Text(emptyLine)
          .virgaText(.textBase)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.vertical, theme.space5)
          .accessibilityIdentifier("library-empty")
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
            // The other kind of post's templates are set apart by their
            // heading, not faded: fading takes their small words under 4.5:1.
            ForEach(section.items, id: \.id) { item in
              LibraryItemRow(item: item, chosen: Optional(item.id).jsEquals(selected), transport: transport) { choose(item) }
            }
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("library-list")
      }
      listFoot(items: items)
    }
    // `role="status"`: Searching Bluesky… is read out as it comes.
    .toolAnnounces(searchingLine)
  }

  private var emptyLine: String {
    if searching {
      if pasted.status == "none" { return "Nothing could be read from that link. Check it and try again." }
      if lib.remoteSearch.status == "error" { return "Search on Bluesky didn’t answer." }
      return "Nothing matches that."
    }
    return LibraryUI.shelfEmpty[shelf?.id ?? ""] ?? "Nothing here yet."
  }

  /// `.lib-list-head`: what the shelf is at the start and its own control
  /// at the end, the control under the words where both don't fit, over
  /// the rule in ink that opens the list. Beside the chosen item it is as
  /// tall as that item's head, its words on the line nearest the rule.
  private var listHead: some View {
    let hint = Text(listHint)
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
    let minHeight = narrow ? LibraryMeasure.phoneHeadMin : itemHeadHeight
    return ViewThatFits(in: .horizontal) {
      HStack(alignment: .center, spacing: 0) {
        if !listHint.isEmpty { hint.fixedSize() }
        Spacer(minLength: LibraryMeasure.headColumnGap)
        listControl
      }
      VStack(alignment: .leading, spacing: LibraryMeasure.headRowGap) {
        if !listHint.isEmpty { hint.fixedSize(horizontal: false, vertical: true) }
        listControl
      }
    }
    .padding(.bottom, narrow ? LibraryMeasure.phoneHeadBelow : LibraryMeasure.headBelow)
    .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .bottomLeading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.rule).frame(height: 1) }
  }

  /// `min-height: calc(var(--text-md) * 1.25 + 4px + var(--text-sm) * 1.45 +
  /// 13px)`: the chosen item's head (its title, the line under it, 12 below
  /// and its rule), so the two rules in ink are one line across.
  private var itemHeadHeight: CGFloat {
    let title: CGFloat = theme.textMd * CGFloat(ThemeKit.headingLineHeight)
    let effect: CGFloat = theme.textSm * CGFloat(ThemeKit.bodyLineHeight)
    let rule: CGFloat = 1
    return title + LibraryMeasure.itemHeadGap + effect + LibraryMeasure.itemHeadBelow + rule
  }

  /// The order for posts and replies, Only my posts while searching, New
  /// template on the templates' shelf.
  @ViewBuilder private var listControl: some View {
    if !searching, let id = shelf?.id, id == "posts" || id == "replies" {
      Segmented(
        label: "Order", options: [SegmentedOption("date", "Newest"), SegmentedOption("engagement", "Most engagement")],
        selection: Binding(get: { lib.sort }, set: { lib.setSort($0) }), size: .small)
    } else if searching && !trimmed.hasPrefix("/") && !LibraryUI.looksLikeLink(trimmed) {
      Toggle("Only my posts", isOn: Binding(get: { lib.mine }, set: { lib.setMine($0) }))
        .toggleStyle(.virgaCheck)
        .virgaText(.textSm)
    } else if !searching, shelf?.id == "templates", let onNewTemplate {
      Button(action: onNewTemplate) { Label("New template", systemImage: Glyph.plus) }
        .buttonStyle(.linkAction)
        .accessibilityIdentifier("library-new-template")
    }
  }

  @ViewBuilder
  private func listFoot(items: [LibraryItem]) -> some View {
    let remote = lib.remoteSearch
    if searching && remote.status == "error" {
      LibraryStatus(words: "Search on Bluesky didn’t answer.") { lib.retrySearch() }
    }
    if searching && remote.status == "loading" && !items.isEmpty {
      Text("Searching Bluesky…")
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .padding(.top, LibraryMeasure.statusTop)
    }
    let more = searching ? remote.hasMore : (shelf.map { lib.hasMore($0.id) } ?? false)
    let loadingMore = searching ? remote.loadingMore : (shelf?.loadingMore ?? false)
    if more {
      Button(loadingMore ? "Loading…" : "Show more") {
        if searching { lib.loadMoreSearch() } else if let id = shelf?.id { lib.loadMore(id) }
      }
      .buttonStyle(.virga(.ghost, size: .small))
      .disabled(loadingMore)
      .padding(.top, theme.points(ThemeKit.cardFootSpaceAbove))
      .padding(.bottom, theme.space2)
    }
  }

  private func choose(_ item: LibraryItem) {
    selectedId = item.id
    if narrow {
      phoneDetail = true
      // The row pressed is gone: the focus goes into what took its place.
      focusDetail = true
    }
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

  /// A post, feed or list is read again when it's shown, for its full text
  /// and its card: unless it has a view (a post read already) and a cid.
  private func hydrate(_ item: LibraryItem) async {
    guard hydrated[item.id] == nil, hydrateErrors[item.id] == nil else { return }
    let read = item.view?.isTruthy == true && !(item.cid ?? "").isEmpty
    guard ["post", "feed", "list"].contains(item.kind), !read else { return }
    do {
      var fresh = try await lib.hydrate(item)
      if Task.isCancelled { return }
      fresh.id = item.id
      hydrated[item.id] = fresh
    } catch {
      // Another row chosen before it answered: its read is called off, not failed.
      if Task.isCancelled || error is CancellationError { return }
      hydrateErrors[item.id] = libraryErrorText(error)
    }
  }

  // MARK: The chosen item

  private func detail(_ item: LibraryItem) -> some View {
    LibraryItemDetail(
      lib: lib, item: item, state: state, postIndex: postIndex, insertion: insertion, verb: verb,
      busy: using == item.id, error: useError, hydrateError: hydrateErrors[item.id], transport: transport,
      takesFocus: focusDetail
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

/// `ShelfRail` as its row of words (`.lib-rail` from 800 down, which the
/// app draws at every width): each shelf's icon, its name and its count
/// (muted, small, 400), the current one in ink, 600, with a 2-point line
/// in ink under it. It scrolls sideways where it doesn't fit, and from 760
/// down runs out to the sheet's or the screen's edges (`runsOut`), its
/// first shelf on the page's margin.
struct LibraryShelfRow: View {
  @Environment(\.virgaTheme) private var theme
  let shelves: [LibraryShelfSummary]
  let current: String?
  var runsOut: CGFloat = 0
  let onPick: (String) -> Void

  var body: some View {
    ScrollRow(focus: current.map { AnyHashable($0) }) {
      HStack(spacing: LibraryMeasure.shelfGap) {
        ForEach(shelves, id: \.id) { shelf in
          LibraryShelfKey(shelf: shelf, isOn: shelf.id == current) { onPick(shelf.id) }
            .id(AnyHashable(shelf.id))
        }
      }
      .padding(.horizontal, runsOut)
    }
    .padding(.horizontal, -runsOut)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Shelves")
  }
}

/// `.lib-shelf`: a shelf's icon, its name (text-base, muted; the current
/// one ink, 600) and its count.
struct LibraryShelfKey: View {
  @Environment(\.virgaTheme) private var theme
  let shelf: LibraryShelfSummary
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    let count: String? = shelf.id == "search" ? nil : shelf.count.flatMap { n in n > 0 ? AppLocale.formatNumber(n) : nil }
    Button(action: action) {
      HStack(spacing: LibraryMeasure.shelfInnerGap) {
        Image(systemName: LibraryGlyph.shelf(shelf.id))
          .virgaGlyph(LibraryMeasure.shelfIcon, beside: theme.textBase)
        Text(shelf.label)
          .virgaText(.textBase, weight: isOn ? VirgaWeight.semibold : VirgaWeight.regular)
        if let count {
          Text(count)
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
        }
      }
      .lineLimit(1)
      .foregroundStyle(isOn ? theme.ink : theme.muted)
      .frame(minHeight: Measure.Touch.target)
      .overlay(alignment: .bottom) {
        if isOn { Rectangle().fill(theme.ink).frame(height: LibraryMeasure.shelfLine) }
      }
      .contentShape(Rectangle())
      .animation(theme.motion.control, value: isOn)
      .scrollRowFocus(isOn)
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm), placement: .inside)
    .accessibilityLabel(count.map { "\(shelf.label) \($0)" } ?? shelf.label)
    .accessibilityAddTraits(isOn ? [.isSelected] : [])
  }
}

/// `.lib-status`: a shelf or a search that didn't answer, and Try again:
/// beside the words where both fit, under them where they don't. A
/// failure, read out as it appears (`role="alert"`).
struct LibraryStatus: View {
  @Environment(\.virgaTheme) private var theme
  let words: String
  let onRetry: () -> Void

  var body: some View {
    Callout(tone: .danger, alert: words) {
      BesideOrUnder(
        minLead: LibraryMeasure.statusWordsMin, columnGap: LibraryMeasure.statusColumnGap, rowGap: LibraryMeasure.statusRowGap,
        baseline: true
      ) {
        Text(words)
        Button("Try again", action: onRetry).buttonStyle(.virga(size: .small))
      }
    }
    .padding(.top, LibraryMeasure.statusTop)
  }
}

/// A bone: a line of words still to come, `share` of the width it's given.
struct LibraryBone: View {
  @Environment(\.virgaTheme) private var theme
  let share: CGFloat
  var height = LibraryMeasure.boneHeight

  var body: some View {
    GeometryReader { geometry in
      RoundedRectangle(cornerRadius: theme.radiusSm)
        .fill(theme.line)
        .frame(width: geometry.size.width * share, height: height)
    }
    .frame(height: height)
  }
}

/// Rows shaped like the list, while a shelf loads: a title and a line
/// each, between hairlines, pulsing (still under Reduce Motion).
struct LibrarySkeleton: View {
  @Environment(\.virgaTheme) private var theme
  var rows = 5
  @State private var dim = false
  static let titles: [CGFloat] = [0.72, 0.56, 0.80, 0.48, 0.64]
  static let lines: [CGFloat] = [0.40, 0.32, 0.46, 0.28, 0.36]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(0..<rows, id: \.self) { i in
        VStack(alignment: .leading, spacing: LibraryMeasure.skeletonGap) {
          LibraryBone(share: Self.titles[i % 5], height: LibraryMeasure.titleBoneHeight)
          LibraryBone(share: Self.lines[i % 5])
        }
        .padding(.vertical, LibraryMeasure.skeletonPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
      }
    }
    .opacity(dim ? Measure.Templates.pulseLow : 1)
    .onAppear {
      guard !theme.reduceMotion else { return }
      withAnimation(.easeInOut(duration: Measure.Templates.pulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
    }
    .accessibilityHidden(true)
  }
}

/// A thing on the shelf: a row between hairlines, its words on the list's
/// own edge, the chosen one with a rule in the accent just outside it.
struct LibraryItemRow: View {
  @Environment(\.virgaTheme) private var theme
  let item: LibraryItem
  let chosen: Bool
  let transport: any HTTPTransport
  let onPick: () -> Void

  var body: some View {
    let narrow = theme.windowWidth <= Breakpoint.tablet
    Button(action: onPick) {
      HStack(alignment: .top, spacing: LibraryMeasure.rowGap) {
        if let thumb = item.media?.thumb, !thumb.isEmpty {
          TransportImage(url: thumb, transport: transport)
            .frame(width: LibraryMeasure.thumb, height: LibraryMeasure.thumb)
            .background(theme.tint)
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusSm))
            .accessibilityHidden(true)
        }
        VStack(alignment: .leading, spacing: LibraryMeasure.rowTextGap) {
          title
          if !item.reason.isEmpty {
            Text(item.reason)
              .virgaText(.textSm, weight: VirgaWeight.medium)
              .foregroundStyle(theme.ink2)
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
      .padding(.trailing, LibraryMeasure.rowTrailing)
      .frame(minHeight: narrow ? LibraryMeasure.phoneRowMin : nil, alignment: .topLeading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .overlay(alignment: .leading) {
      if chosen {
        Rectangle().fill(theme.accent).frame(width: LibraryMeasure.chosenRule).offset(x: -LibraryMeasure.chosenRuleOutset)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
    .accessibilityIdentifier("library-row")
  }

  /// `.lib-row-title`: text-md, 500 (600 when chosen), two lines at most
  /// (a post's title is its first line, which may be the whole post), a
  /// template's /shortcut after its name on the same line.
  private var title: some View {
    let weight = chosen ? VirgaWeight.semibold : VirgaWeight.medium
    var words = Text(item.title).font(theme.font(size: theme.textMd, weight: weight)).foregroundColor(theme.ink)
    if !item.shortcut.isEmpty {
      words = words + Text("\u{2002}\(item.shortcut)").font(theme.font(size: theme.textSm).monospaced()).foregroundColor(theme.muted)
    }
    return words
      .virgaText(.textMd, weight: weight)
      .lineLimit(2)
      .multilineTextAlignment(.leading)
  }
}

/// The chosen item: what it is, what using it does, and the button (or a
/// template's questions first).
struct LibraryItemDetail: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let lib: LibraryModel
  let item: LibraryItem
  let state: JSONValue?
  let postIndex: Int
  let insertion: TextSelection?
  let verb: String?
  let busy: Bool
  let error: String?
  let hydrateError: String?
  let transport: any HTTPTransport
  /// Chosen on a phone, where the row pressed has gone: the focus comes here.
  var takesFocus = false
  let onUse: ([String: String]) -> Void
  @AccessibilityFocusState private var titleFocused: Bool

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
    VStack(alignment: .leading, spacing: LibraryMeasure.itemGap) {
      head
      what
      if let template, asks > 0 {
        TemplateQuestions(
          template: template, context: lib.context, embedView: item.embedView, submitLabel: label, busy: busy,
          autoFocus: takesFocus, preview: { preview($0) }, onDone: { onUse($0) })
      } else {
        use(label: label, isTemplate: isTemplate, replying: replying)
      }
      if let error {
        // role="alert": read out as it appears.
        Callout(tone: .danger, error)
      }
    }
    .onAppear {
      guard takesFocus else { return }
      DispatchQueue.main.async { titleFocused = true }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("library-detail")
  }

  /// `.lib-item-head`: the title on one line (text-md, 600), what using it
  /// does under it (ink-2), and the rule in ink that closes them.
  private var head: some View {
    VStack(alignment: .leading, spacing: LibraryMeasure.itemHeadGap) {
      Text(item.title)
        .virgaText(.textMd, weight: VirgaWeight.semibold, lineHeight: ThemeKit.headingLineHeight, lineBox: true)
        .foregroundStyle(theme.ink)
        .lineLimit(1)
        .truncationMode(.tail)
        .accessibilityAddTraits(.isHeader)
        .accessibilityFocused($titleFocused)
      Text(Library.effectFor(item, lib.context))
        .virgaText(.textSm, lineHeight: ThemeKit.bodyLineHeight, lineBox: true)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.bottom, LibraryMeasure.itemHeadBelow)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.rule).frame(height: 1) }
  }

  @ViewBuilder private var what: some View {
    if item.kind == "post" {
      // A post not read yet has a null view, which is no view at all.
      if let view = item.view, view.isTruthy {
        PostPreviewCard(view: view)
      } else if let hydrateError {
        Callout(tone: .warn, hydrateError)
      } else {
        TemplateBones(shares: [0.4, 0.9, 0.7], titleFirst: true)
      }
    }
    if item.kind == "feed" || item.kind == "list" || item.kind == "link" {
      card
    }
  }

  /// `.lib-card`: a link, a feed or a list as it will be attached, a
  /// hairline round it.
  private var card: some View {
    VStack(alignment: .leading, spacing: LibraryMeasure.cardGap) {
      Text(item.title)
        .virgaText(.textSm, weight: VirgaWeight.semibold)
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
      if !item.excerpt.isEmpty {
        Text(item.excerpt)
          .virgaText(.textSm)
          .foregroundStyle(theme.ink2)
          .fixedSize(horizontal: false, vertical: true)
      }
      if let url = item.url, let link = URL(string: url) {
        // `.lib-card-link`: ink words with a line under them, a link.
        Button {
          openURL(link)
        } label: {
          Text("Open the link")
            .modifier(LinkUnderline())
            .virgaText(.textSm, lineHeight: Measure.LinkAction.lineHeight, lineBox: true)
            .foregroundStyle(theme.ink)
            .touchReach(horizontal: Measure.LinkAction.reachSides, vertical: Measure.LinkAction.reachAbove)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        .accessibilityRemoveTraits(.isButton)
      }
    }
    .padding(LibraryMeasure.cardPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: LibraryMeasure.cardRadius).strokeBorder(theme.line))
  }

  @ViewBuilder
  private func use(label: String, isTemplate: Bool, replying: Bool) -> some View {
    let shown = preview([:])
    let narrow = theme.windowWidth <= Breakpoint.tablet
    if isTemplate || state != nil {
      TemplatePreviewView(preview: shown, label: replying ? "Your reply will read" : "Your post will read")
    }
    if !isTemplate && state == nil, let blocked = shown.blocked {
      Text(blocked)
        .virgaText(.textSm)
        .foregroundStyle(theme.warn)
        .fixedSize(horizontal: false, vertical: true)
    }
    // `.lib-questions-actions`: at the end; from 760 down the column's
    // width, held at the sheet's foot in the dialog.
    HStack(spacing: Measure.Templates.questionsActionsGap) {
      if !narrow { Spacer(minLength: 0) }
      Button(busy ? "Adding…" : label) { onUse([:]) }
        .buttonStyle(.virga(.primary))
        .environment(\.virgaFillsWidth, narrow)
        .disabled(busy || !shown.usable || hydrateError != nil)
        .accessibilityIdentifier("library-use")
    }
    .modifier(LibraryPinnedActions())
  }
}

/// `.lib-panel[data-mode='page'] .lib-detail { position: sticky; top: 24px }`:
/// beside the list as the page scrolls, held 24 under the page's top until
/// the list beside it ends.
struct LibraryStickyTop: ViewModifier {
  let rowHeight: CGFloat
  @State private var lift: CGFloat = 0

  func body(content: Content) -> some View {
    content
      .offset(y: lift)
      // Where it would be, unmoved (a background isn't moved by the offset).
      .background {
        GeometryReader { geometry in
          Color.clear.onChange(of: Self.lift(geometry, rowHeight: rowHeight), initial: true) { _, next in lift = next }
        }
      }
  }

  static func lift(_ geometry: GeometryProxy, rowHeight: CGFloat) -> CGFloat {
    let top = geometry.frame(in: .scrollView).minY
    return max(0, min(LibraryMeasure.stickyTop - top, rowHeight - geometry.size.height))
  }
}

/// `.lib-questions-actions { position: sticky; bottom: 0; padding: 10px 0
/// 2px; background: var(--surface) }` in the phone's dialog: the actions
/// held at the sheet's foot on its ground while the detail runs on under
/// them. Anywhere else they stay where they are.
struct LibraryPinnedActions: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.libraryPinsActions) private var pins
  @State private var lift: CGFloat = 0

  func body(content: Content) -> some View {
    if pins {
      content
        .padding(LibraryMeasure.pinnedActions)
        .background(theme.surface)
        .offset(y: lift)
        .background {
          GeometryReader { geometry in
            Color.clear.onChange(of: Self.lift(geometry), initial: true) { _, next in lift = next }
          }
        }
        .zIndex(1)
    } else {
      content
    }
  }

  /// How far up to draw it: to the scroll view's visible foot, when it
  /// would be under it.
  static func lift(_ geometry: GeometryProxy) -> CGFloat {
    guard let visible = geometry.bounds(of: .scrollView) else { return 0 }
    return min(0, visible.maxY - geometry.size.height)
  }
}
#endif
