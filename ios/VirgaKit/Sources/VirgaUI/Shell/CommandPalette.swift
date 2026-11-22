// Ports src/shell/CommandPalette.jsx
// Ports src/shell/commandPalette.css
//
// The command palette: one field that goes to any page and does the few
// things done from everywhere (a new post, a sync, the period, the sky,
// another account). The sidebar's "Search or jump to…", the phone's app bar
// and ⌘K on a hardware keyboard open it. The list and the matching are
// VirgaInsights' Commands (commands.js); this is the sheet around them.
//
// The field says what the palette is for, so the sheet's name is only read
// out, and Close shares the field's line. The field has no box: the words
// typed on a line in ink, two points deep. Under it the groups, each
// option its icon, its title and a hint (on a phone the hint goes under
// the title, and waits for a search), and a tick on what is in use now.
// With a hardware keyboard the arrows (and Home and End) move the
// highlighted option, Return runs it and Escape closes; the foot says so
// beside the sidebar, where there is a keyboard to press.
//
// Run: a command with an address goes there through the navigator; New
// post opens the composer in place, over the page, once the palette's
// sheet has gone (ComposerHost; its address where there is no host); Sync
// runs the archive's sync; the period and the sky set the preference (the
// period says, in a toast, what the charts show now); another account
// opens as the account menu opens it; New dashboard opens the shell's
// dialog, and Customize this dashboard (on a dashboard) opens it for
// customizing (ShellActions). What was used last is kept under the web's
// key (virga:palette-recent).

#if canImport(UIKit)
import Observation
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaSession

/// Whether the palette is open, held by the shell.
@MainActor
@Observable
final class PaletteState {
  var isOpen = false
  /// Run once the sheet has gone (New dashboard's dialog opens then, as a
  /// sheet can't open while another is going).
  var afterClose: (@MainActor () -> Void)?
}

/// `PALETTE_RECENT_KEY`, and the list kept under it.
enum PaletteRecent {
  static let key = "virga:palette-recent"

  static func read(_ store: (any KeyValueStore)?) -> [String] {
    Commands.parseRecent(store?.getItem(key))
  }

  /// Remembered for this visit only when the store refuses.
  static func write(_ list: [String], to store: (any KeyValueStore)?) {
    try? store?.setItem(key, JSONValue.array(list.map(JSONValue.string)).jsonString())
  }
}

struct CommandPalette: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(\.dismiss) private var dismiss
  @Environment(AppModel.self) private var app
  @Environment(SessionModel.self) private var session
  @Environment(PreferencesModel.self) private var preferences
  @Environment(ShellNavigator.self) private var navigator
  @Environment(ShellDashboards.self) private var dashboards
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  @Environment(ShellActions.self) private var actions: ShellActions?
  @Environment(PaletteState.self) private var paletteState: PaletteState?
  @Environment(ComposerHost.self) private var composer: ComposerHost?

  @State private var query = ""
  @State private var active = 0
  @State private var recent: [String] = []
  @FocusState private var fieldFocused: Bool

  private var commands: [Command] {
    let route = navigator.route
    let posts = archive?.data.meta.posts
    var context = CommandContext.app(
      dashboards: dashboards.dashboards,
      accounts: session.accounts.map {
        CommandContext.Account(did: $0.did, handle: $0.handle, displayName: $0.displayName, status: $0.status.rawValue)
      },
      activeDid: session.did,
      periods: Analytics.analyticsPeriods.map { CommandContext.Period(key: $0.key, days: $0.days.map(Double.init), label: $0.label) },
      period: preferences.period().key,
      sky: preferences.prefs.sky.rawValue,
      route: route,
      archive: CommandContext.Archive(
        built: posts != nil, complete: posts.map { $0.complete == true }, syncing: archive?.sync != nil),
      defenseEnabled: app.flags.defenseEnabled)
    // The dashboard the shell shows: the one the address names, if any.
    context.route = CommandContext.Route(
      section: route.section.rawValue, dashboard: route.section == .dashboard ? dashboards.dashboard(route.dashboard)?.id : nil)
    return Commands.buildCommands(context)
  }

  var body: some View {
    let groups = Commands.paletteGroups(commands, query, recent: recent)
    let flat = groups.flatMap(\.items)
    let current = min(active, flat.count - 1)
    VStack(spacing: 0) {
      field(flat: flat, current: current)
      list(groups: groups, flat: flat, current: current)
      if theme.windowWidth > Breakpoint.tablet {
        foot
      }
    }
    .background(theme.surface)
    .onAppear {
      // Each opening starts empty, with what was used last read afresh.
      query = ""
      active = 0
      recent = PaletteRecent.read(app.stores.keyValue)
      fieldFocused = true
    }
    .onChange(of: query) { _, next in
      active = 0
      let searching = !next.jsTrimmed().isEmpty
      guard searching else { return }
      let count = Commands.paletteGroups(commands, next, recent: recent).reduce(0) { $0 + $1.items.count }
      AccessibilityNotification.Announcement(count == 1 ? "1 result" : "\(AppLocale.formatNumber(count)) results").post()
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Search or jump to")
    .accessibilityIdentifier("command-palette")
  }

  // MARK: The field

  private func field(flat: [Command], current: Int) -> some View {
    let size = theme.windowWidth <= Breakpoint.tabRing ? Measure.Palette.narrowFieldSize : theme.textLg
    return HStack(spacing: 0) {
      HStack(spacing: Measure.Palette.fieldIconGap) {
        Image(systemName: Glyph.search)
          .font(.system(size: Measure.Palette.fieldIcon))
          .foregroundStyle(theme.ink2)
          .frame(width: Measure.Palette.fieldIcon)
          .accessibilityHidden(true)
        VirgaTextField("A page, a report, a tool, a setting…", text: $query)
          .virgaText(size: size)
          .foregroundStyle(theme.ink)
          .lineLimit(1)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.go)
          .focused($fieldFocused)
          .onSubmit { run(flat.indices.contains(current) ? flat[current] : nil) }
          .onKeyPress(keys: [.upArrow, .downArrow, .home, .end]) { press in
            let key: String
            switch press.key {
            case .upArrow: key = "ArrowUp"
            case .downArrow: key = "ArrowDown"
            case .home: key = "Home"
            default: key = "End"
            }
            guard let to = Commands.moveActive(key, current, flat.count) else { return .ignored }
            active = to
            return .handled
          }
          .onKeyPress(.escape) {
            dismiss()
            return .handled
          }
          .accessibilityLabel("Search pages and commands")
          .accessibilityIdentifier("palette-field")
      }
      .frame(minHeight: Measure.Palette.fieldHeight)
      .overlay(alignment: .bottom) { Rectangle().fill(theme.ink).frame(height: Measure.Palette.fieldRule) }
      .padding(.leading, Measure.Palette.fieldLeading)
      Button {
        dismiss()
      } label: {
        Image(systemName: Glyph.close)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .frame(width: Measure.Palette.fieldTrailing)
      .accessibilityLabel("Close")
      .accessibilityIdentifier("dialog-close")
    }
    .padding(.top, Measure.Palette.fieldSpaceAbove)
  }

  // MARK: The list

  private func list(groups: [PaletteGroup], flat: [Command], current: Int) -> some View {
    let phone = theme.windowWidth <= Breakpoint.tablet
    let searching = !query.jsTrimmed().isEmpty
    return ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: Measure.Palette.groupGap) {
          ForEach(groups, id: \.group) { group in
            VStack(alignment: .leading, spacing: 0) {
              Text(group.group)
                .virgaText(.textXs, weight: VirgaWeight.medium)
                .foregroundStyle(theme.muted)
                .padding(Measure.Palette.groupHead)
                .accessibilityAddTraits(.isHeader)
              ForEach(group.items) { command in
                let at = flat.firstIndex { $0.id.jsEquals(command.id) } ?? -1
                option(command, highlighted: at == current, phone: phone, showsHint: !phone || searching)
                  // The option under the iPad's pointer is the one Return runs.
                  .onContinuousHover { phase in
                    if case .active = phase, at >= 0, at != current { active = at }
                  }
                  .id(command.id)
              }
            }
            .accessibilityElement(children: .contain)
          }
          if flat.isEmpty {
            Text("Nothing matches “\(query.jsTrimmed())”.")
              .virgaText(.textBase)
              .foregroundStyle(theme.muted)
              .multilineTextAlignment(.center)
              .frame(maxWidth: .infinity)
              .padding(Measure.Palette.empty)
              .accessibilityIdentifier("palette-empty")
          }
        }
        .padding(Measure.Palette.list)
      }
      .scrollDismissesKeyboard(.never)
      .onChange(of: current) { _, at in
        guard flat.indices.contains(at) else { return }
        proxy.scrollTo(flat[at].id)
      }
      .accessibilityLabel("Pages and commands")
    }
  }

  private func option(_ command: Command, highlighted: Bool, phone: Bool, showsHint: Bool) -> some View {
    Button {
      run(command)
    } label: {
      HStack(spacing: Measure.Palette.optionGap) {
        icon(command)
          .foregroundStyle(highlighted ? theme.ink : theme.ink2)
          .frame(width: Measure.Palette.optionIcon)
          .accessibilityHidden(true)
        Group {
          if phone {
            VStack(alignment: .leading, spacing: Measure.Palette.phoneHintGap) {
              title(command)
              if showsHint, let hint = command.hint { self.hint(hint) }
            }
          } else {
            // The title keeps its words; only the hint gives way.
            HStack(alignment: .firstTextBaseline, spacing: Measure.Palette.optionGap) {
              title(command)
                .layoutPriority(1)
              if let hint = command.hint { self.hint(hint) }
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if command.current == true {
          Image(systemName: Glyph.check)
            .font(.system(size: Measure.Palette.mark))
            .foregroundStyle(theme.ink)
        }
        if !phone, let shortcut = command.shortcut {
          KeyCap(shortcut)
        }
      }
      .padding(Measure.Palette.optionPadding)
      .frame(minHeight: phone ? Measure.Palette.phoneOptionHeight : Measure.Palette.optionHeight)
      .background(RoundedRectangle(cornerRadius: theme.radius).fill(highlighted ? theme.hover : Color.clear))
      .contentShape(RoundedRectangle(cornerRadius: theme.radius))
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(command.title + (command.current == true ? ", in use" : ""))
    .accessibilityHint(command.hint ?? "")
    .accessibilityAddTraits(.isButton)
    .accessibilityIdentifier("palette-\(command.id)")
  }

  private func title(_ command: Command) -> some View {
    Text(command.title)
      .virgaText(.textMd, weight: VirgaWeight.medium)
      .foregroundStyle(theme.ink)
      .lineLimit(1)
      .truncationMode(.tail)
  }

  private func hint(_ text: String) -> some View {
    Text(text)
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .lineLimit(1)
      .truncationMode(.tail)
  }

  /// `CommandIcon`: the account's picture for another account; else the
  /// command's own icon, its kind's, its sky's, or its group's.
  @ViewBuilder
  private func icon(_ command: Command) -> some View {
    if command.do == "switchAccount" {
      let account = command.arg.flatMap { arg in session.accounts.first { $0.did.jsEquals(arg) } }
      Avatar(src: account?.avatar, name: account?.displayName ?? account?.handle ?? "", size: .small)
    } else {
      Image(systemName: Self.glyph(command))
        .font(.system(size: Measure.Palette.optionGlyph))
    }
  }

  static func glyph(_ command: Command) -> String {
    if let own = command.sfSymbol, command.icon.map(Icons.hasSymbol(lucide:)) == true { return own }
    if command.do == "sky", let sky = command.arg {
      switch sky {
      case "clock": return Glyph.clock
      case "dawn": return Glyph.dawn
      case "day": return Glyph.day
      case "dusk": return Glyph.dusk
      case "night": return Glyph.night
      default: break
      }
    }
    switch command.do ?? "" {
    case "newPost": return Glyph.newPost
    case "sync": return Glyph.refresh
    case "customize": return Glyph.customize
    case "newDashboard": return Glyph.plus
    case "period": return Glyph.calendarRange
    default: break
    }
    switch command.group {
    case "Dashboards": return Glyph.dashboards
    case "Reports": return Glyph.reports
    case "Tools": return Glyph.tools
    case "Settings": return Glyph.settings
    case "Posting": return Glyph.posting
    case "Defense": return Glyph.defense
    default: return Glyph.search
    }
  }

  // MARK: The foot

  private var foot: some View {
    HStack(spacing: Measure.Palette.footGap) {
      HStack(spacing: Measure.Palette.footKeyGap) {
        KeyCap("↑")
        KeyCap("↓")
        Text("to move")
      }
      HStack(spacing: Measure.Palette.footKeyGap) {
        KeyCap("Enter")
        Text("to go")
      }
      HStack(spacing: Measure.Palette.footKeyGap) {
        KeyCap("Esc")
        Text("to close")
      }
      Spacer(minLength: 0)
    }
    .virgaText(.textXs)
    .foregroundStyle(theme.muted)
    .padding(Measure.Palette.foot)
    .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityHidden(true)
  }

  // MARK: Running a command

  private func run(_ command: Command?) {
    guard let command else { return }
    let next = Commands.rememberRecent(recent, command.id)
    recent = next
    PaletteRecent.write(next, to: app.stores.keyValue)
    // Closed first, so nothing opens over it.
    dismiss()
    if let go = command.go {
      navigate(go)
      return
    }
    switch command.do ?? "" {
    case "newPost":
      // The composer is a sheet of its own: it opens once this one has gone.
      guard let composer else {
        navigate("/posting/compose")
        return
      }
      let open: @MainActor () -> Void = { composer.open() }
      if let paletteState { paletteState.afterClose = open } else { open() }
    case "sync":
      if let archive, archive.sync == nil {
        let mode = SyncStatus.mode(archive)
        Task { await archive.runSync(mode) }
      }
    case "period":
      guard let key = command.arg else { return }
      let built = archive?.isBuilt ?? false
      preferences.setPeriod(key)
      // Off the dashboards nothing on screen changes, so it says so.
      if let chosen = Analytics.analyticsPeriods.first(where: { $0.key.jsEquals(key) }) {
        let phrase = Periods.periodPhrase(chosen)
        toasts?.push(built ? "Charts now show \(phrase)." : "Charts will show \(phrase).")
      }
    case "sky":
      if let sky = command.arg.flatMap(SkyChoice.init(rawValue:)) { preferences.setPref(\.sky, sky) }
    case "customize":
      let route = navigator.route
      if route.section == .dashboard, let id = dashboards.dashboard(route.dashboard)?.id {
        actions?.customize(id, navigator: navigator)
      }
    case "newDashboard":
      let open: @MainActor () -> Void = { [actions] in actions?.creatingDashboard = true }
      if let paletteState { paletteState.afterClose = open } else { open() }
    case "switchAccount":
      if let arg = command.arg, let account = session.accounts.first(where: { $0.did.jsEquals(arg) }) {
        AccountActions.open(account, session: session)
      }
    default:
      break
    }
  }
}

/// `.kbd`: a key, as it is printed on one.
struct KeyCap: View {
  @Environment(\.virgaTheme) private var theme
  private let text: String

  init(_ text: String) {
    self.text = text
  }

  var body: some View {
    Text(text)
      .virgaText(.textXs, weight: VirgaWeight.medium, lineHeight: 1)
      .foregroundStyle(theme.muted)
      .lineLimit(1)
      .padding(.horizontal, Measure.Palette.keyPadding)
      .frame(minWidth: Measure.Palette.keySize, minHeight: Measure.Palette.keySize)
      .background(RoundedRectangle(cornerRadius: Measure.Palette.keyRadius).fill(theme.surface))
      .overlay(RoundedRectangle(cornerRadius: Measure.Palette.keyRadius).strokeBorder(theme.line2, lineWidth: 1))
  }
}

extension View {
  /// The palette over this view, while `state.isOpen`: a full-height sheet.
  func commandPalette(_ state: PaletteState) -> some View {
    modifier(CommandPaletteSheet(state: state))
  }
}

struct CommandPaletteSheet: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Bindable var state: PaletteState

  func body(content: Content) -> some View {
    content
      .sheet(isPresented: $state.isOpen, onDismiss: {
        let next = state.afterClose
        state.afterClose = nil
        next?()
      }) {
        CommandPalette()
          .presentationDetents([.large])
          .presentationBackground(theme.surface)
          .presentationCornerRadius(Measure.Dialog.radius)
      }
  }
}

/// "Search or jump to": the button that opens the palette, as a ghost icon
/// (the app bar's, the rail's).
struct PaletteButton: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PaletteState.self) private var palette: PaletteState?
  var size: KitSize = .medium
  /// The glass: 20 in the app bar, 18 on the rail.
  var glyph: CGFloat = Measure.AppBar.icon

  var body: some View {
    Button {
      palette?.isOpen = true
    } label: {
      // In ink, where a ghost button's own is --ink-2 (`.appbar .btn--icon`,
      // `.sidebar[data-collapsed] .sidebar-search-icon`).
      Image(systemName: Glyph.search)
        .font(.system(size: glyph))
        .foregroundStyle(theme.ink)
    }
    .buttonStyle(.virga(.ghost, size: size, icon: true))
    .accessibilityLabel("Search or jump to")
    .accessibilityIdentifier("palette-open")
  }
}

extension Measure.Palette {
  /// The rail's Search: `<Search size={18}>`.
  static let railIcon: CGFloat = 18
}

/// `.sidebar-search`: the open sidebar's row that opens the palette, with
/// its shortcut written down.
struct SidebarSearch: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PaletteState.self) private var palette: PaletteState?

  var body: some View {
    Button {
      palette?.isOpen = true
    } label: {
      HStack(spacing: Measure.Sidebar.doGap) {
        Image(systemName: Glyph.search)
          .font(.system(size: Measure.Palette.sidebarIcon))
        Text("Search or jump to…")
          .virgaText(.textBase)
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
        Text(Shortcuts.paletteShortcutLabel(true))
          .virgaText(.textXs, weight: VirgaWeight.medium)
      }
      .foregroundStyle(theme.muted)
      .padding(.leading, Measure.Sidebar.searchPaddingLeading)
      .padding(.trailing, Measure.Sidebar.searchPaddingTrailing)
      .frame(minHeight: max(theme.controlH, Measure.Touch.target))
      .background(
        RoundedRectangle(cornerRadius: theme.radius).fill(theme.surface.opacity(Measure.Sidebar.searchFillShare))
      )
      .overlay(RoundedRectangle(cornerRadius: theme.radius).strokeBorder(theme.line, lineWidth: 1))
      .contentShape(RoundedRectangle(cornerRadius: theme.radius))
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radius))
    .accessibilityLabel("Search or jump to…")
    .accessibilityIdentifier("palette-open")
  }
}
#endif
