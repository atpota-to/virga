# ui (VirgaUI): porting notes

What the agent that built the SwiftUI layer's foundation handed on, in four rounds
(November 2026), each compiled and run by CI's `iOS app` job on an iPhone and an iPad.
The code and ios/parity/modules/ui-*.json are the truth; read this for orientation, the
API a new screen uses, and what was left out.

Status: the foundation is built and passes CI (compile, the app's unit tests, the UI tests
on an iPhone and an iPad). Not yet audited against the web's components as a whole. Round 5
added the charts, the dashboards and the first reports (below); round 6 the tools, Post this
chart (the share dialog) and Defense, then New dashboard, Customize from the palette,
Settings › Dashboards and the handle field's arrows. Then the composer, Settings › Posting, the
adviser, scheduling, the posting pages and the composer's timer (each section below); the last three
wait on CI's first compile.

## How the layer is checked

SwiftUI can't be compiled on Linux. An agent writes VirgaUI in a worktree and checks
syntax with `swiftc -parse`; the main session merges and pushes; CI's `iOS app` job is
the compiler (Xcode 26.6, iOS 26.5 SDK, an iPhone and an iPad simulator); the UI tests
(ios/AppUITests) drive demo mode and keep a screenshot of each screen worth seeing
(XCTAttachment, kept always), which CI exports to the `screenshots-iphone` and
`screenshots-ipad` artifacts (the iPad's tests run in a job of their own, `iOS app on an
iPad`, beside the iPhone's, on a 13-inch iPad upright, over 900 wide). Every test that
builds the demo archive takes two to three minutes per device, so keep their number
down: add screenshots to an existing built-archive test rather than a new one. Every VirgaUI file is wrapped in
`#if canImport(UIKit)`. VirgaUI builds in Swift 5 language mode.

The UI test classes (ScheduleUITests, below, needs no archive build), each one built-archive test per device: VirgaUITests (the shell, the
dashboards, the reports, the palette, Settings, the sign-in); ToolsUITests
(`testTheToolsOnTheBuiltArchive`: `tools-built`, `tool-identity`, `tool-best-time`,
`tool-follow-cleanup` and `-checked` after the activity check, `tool-interaction-lookup`,
`-search`, `-chosen` and `-totals` with a handle looked up, and `share-dialog` from a
dashboard card); DefenseUITests (`testDefenseOnTheBuiltArchive`, launched with
`-VirgaDefense on` and `-VirgaDemoFlags "latency=0&defense=on"`: `defense-before-scan`,
`defense-scanning`, `defense-scan` or `defense-scan-failed`, `defense-radar`,
`defense-scan-table`, `defense-near`, `defense-add-to-list`, `defense-lists`,
`defense-history`; a screen the demo can't reach is skipped, not failed); LiveSkyUITests (no
archive build: `front-page-live-sky-day` and `-night`, `front-page-live-sky-put-away`,
`settings-live-sky`, `live-sky-dashboard-day` and `-night`, `live-sky-five-taps`). The tools' and
Defense's views carry `accessibilityIdentifier`s (`cleanup-table`, `lists-table`,
`lookup-field`, `lookup-option-<n>`, `defense-progress`, …) for these tests to find.

Things CI's compiler has refused so far, worth avoiding: comparing an optional
`String?` with `String.jsEquals` (use the `Optional<String>.jsEquals` overload or unwrap);
reading a `@MainActor` model's properties from a static helper on a nonisolated enum
(mark the helper `@MainActor`, or put it on a View); calling a helper another module keeps
`internal` (VirgaNetwork's and VirgaDefense's `jsStartsWith`: use `utf16.starts(with:)`).
Others `swiftc -parse` doesn't see, met while writing: `JSONValue` is
`ExpressibleByNilLiteral`, so `value == nil` on a `JSONValue?` compares with `.null`
(use `.isPresent`); a modifier on a `GridRow` makes it one cell (put it on the cells); a
`let` that shadows a name used above it in the same scope.

Identifiers and containers, which only the UI tests show: an `.accessibilityIdentifier`
on anything that isn't an accessibility element of its own (a stack, a `Group`, a custom
view's body, a `Layout`) is given to each element directly inside it and replaces their
own; the outermost wins, and an element that is itself a `.contain` container (a widget
card) loses its identifier too, though what's inside it keeps theirs. A `ScrollView` is an
element, so an identifier right on it stays on it (the template editor's fields kept
theirs inside its dialog's ScrollView). So a container with identified elements in it is
`.accessibilityElement(children: .contain)` before its identifier, as the tools' and
Defense's always were. A failed test's `App UI hierarchy` attachment shows a missed one
as the same identifier on several elements and none of theirs. The containers fixed
together: `composer-bar` (it had taken the phone composer's Close, title and send
button), `library-dialog`, `library-panel`, `library-list`, `template-editor`,
`templates-page`, `templates-list`, Settings › Posting's `posting-settings`,
`posting-new-posts`, `posting-queue`, `posting-default-timer` and `posting-adviser`,
`style-dialog`, `alt-dialog`, `adviser-sheet`, `dash-grid` (which had hidden every
`widget-<type>`, so `dashboard-heatmap` was never taken) and the phone's `sync-banner`
(which had hidden its `sync-cancel`).

## API for the screens that build on it

All under ios/VirgaKit/Sources/VirgaUI/.

THEME (Theme/)
- `VirgaThemeRoot` resolves `ThemeTokens.resolve(prefs.rootAttributes, viewportWidth:)` at
  the window's width, cached by both (`ThemeCache`), and feeds the system's dark mode,
  Increase Contrast and Reduce Motion to PreferencesModel. Views read
  `@Environment(\.virgaTheme) var theme`.
- Colours and lengths: `theme.ink`, `theme.space4`, … (every token, generated in
  `VirgaTheme+Tokens.swift`); `theme.points(ThemeKit.x)`, `theme.color(ThemeKit.x)`,
  `theme.insets(box)`, `theme.shadow(...)`.
- Type: `theme.font(.textBase, weight:)`, `.virgaText(.textSm, weight:, lineHeight:,
  tracking:, lineBox:)`, `theme.measure`, `theme.characters(n)`. A text's line height is
  the body's 1.45 between lines unless it says otherwise: a heading passes
  `ThemeKit.headingLineHeight` (1.25), a button or a segmented key `Measure.Lines` (1). SwiftUI
  adds it between lines only, so a single line keeps the face's own 1.22; `lineBox: true` adds
  the half-leading above and below too, for a line whose box lays it out (a link action, a more
  link, a meta line, a table's cell). A line-height under 1.22 (the page title's 1.1, a figure's
  1) is `.padding(.vertical, theme.overflowingLeading(size:lineHeight:weight:))`, the glyphs
  reaching past the box. A glyph beside words is `.virgaGlyph(size, beside: wordsSize)`, grown
  with Dynamic Type as they are; `theme.font(points:)` is a face at points already scaled.
  Instrument Sans is bundled
  (Resources/Fonts, OFL) and registered from `Bundle.module`; the font is built from a
  CoreText descriptor with the wght axis (400/500/600) and tabular figures, scaled by
  UIFontMetrics; the system font if registration fails.
- Motion: `theme.motion.control`, `.knob`, `.indeterminate`, … (nil under Reduce Motion).
- Layout: `theme.isPhone`, `.hasSidebar`, `.isTablet`; `Breakpoint` holds 900/760/640/560/
  429/374.
- The sky: one wash drawn behind the scroll view from the very top of the window and moved
  by the page's scroll (`SkyScroll`, `PageSky`), so the strip under the status bar is the
  same wash; `.skyNavigationBar()` keeps the bar clear over it.
- `Measures.swift` names the measures from shell.css, legal.css, signin.css, accounts.css
  and settings.css that ThemeKit doesn't read yet, each citing its rule. They should move
  into `_themeKit.js` later.

COMPONENTS (Components/), each with `// Ports` headers and a `#Preview`
- Buttons: `.buttonStyle(.virga(.primary, size: .large, icon:, isOn:, destructive:))` for the
  quiet, primary, ghost and danger tiers in small, medium and large (danger keeps the deep
  red at night; a button keeps its words, `fixedSize`; a destructive ghost keeps its words red); `.linkAction` (its own 1-point line
  at a 3-point offset, 2 while open or pressed; a Label's title is underlined, not its icon);
  `MoreLink(_, to:)`. The kit's sizes are `KitSize`.
- `Segmented(label:options:selection:size:)` (scrolls with faded edges, the pressed key
  brought clear of the fade only when it is under it, keys held at their bold width; an
  option's web `title` is `SegmentedOption(hint:)`, and `minWidth:` a key's least width, as a
  kind filter's glyph-only keys have, 32 at 760 and under), `ChipStyle(isOn:wraps:disabledOpacity:)`
  (`wraps`: a long answer wraps in its chip, from its start; `disabledOpacity`: a button's 45% while
  disabled unless its rule says otherwise), `TokenView`/`TokenRow`,
  `Badge`, `MetaLine`/`MetaPiece` (the dot 6 after its word), `StateDot`, `Avatar`,
  `AccessLine`.
- `.toggleStyle(.virgaSwitch)` draws the capsule and its knob and no words, as the web's
  `.switch` (its label is VoiceOver's name for it, the web's aria-label; the row beside it
  says what it is, as `SettingsSwitch`'s and the timer editor's rows do: a ToggleStyle
  can't see `.labelsHidden()`, so it once drew its label beside it, "Require alt text"
  twice); `.virgaCheck` draws its words beside the box (16, 8 from them, centred), and
  `.virgaTermsCheck` is the terms page's (18, 12, top). `.virgaField(invalid:size:)` round
  `VirgaTextField(prompt, text:)` (a TextField whose placeholder is --muted; a plain
  `TextField(prompt, text:)` gets the system's pale grey), `.virgaTextArea()` round a
  TextEditor (its padding less the editor's own insets) or `.virgaTextArea(editor: false)`
  round a `TextField(axis: .vertical)`, which has none, `FieldStack`,
  `FieldHint(_, isOver:)`, `SearchField`, `VirgaSelect(label, selection:, options:
  [SelectChoice])` for select.input (a Picker in virgaField draws its value in the accent,
  centred, on two lines; disabled, a select's value is --muted on --surface-2, as
  `.input:disabled`, and `.keepingFillWhenDisabled()` keeps the field's own ground, the timer
  editor's `.lse-op:disabled`).
- Menus: `MoreMenu`/`VirgaMenu` over `[MenuEntry]` (`.item(MenuItem(...))`, `.separator`),
  a native Menu; each item's icon comes coloured (--ink-2, or the system red of a destructive
  item's words), since a native menu tints a plain image with the window's accent.
- `.virgaDialog(isPresented:title:size:width:stackActions:autofocus:) { } actions: { }` (a sheet
  at its detents on a phone; wider, on iOS 18, the web's modal: `width` wide, 520 by default,
  and as tall as its content, through `.dialogSheetSizing`;
  `stackActions` puts a phone's buttons one under the other, the last given first;
  `autofocus: true` focuses, when it opens, the field marked `.dialogAutofocus()`, the web's
  `[data-autofocus]`: the focus state is the dialog's, inside the sheet, since a caller's
  `@FocusState` outside the sheet doesn't reach a field inside it), `DialogFrame` (the same),
  `ChoiceRow(_, description:, isOn:, kind: .radio | .check)` (rows share one hairline),
  `InfoTip` (laid out 20 × 16, pressed through 44), `FollowerCountTip`, `Callout(tone:)` (a failure
  of words alone, `Callout(tone: .danger, words)`, is role="alert": read out as it appears and
  as its words change; built round its own content it takes `alert:` words, or leaves it to the caller),
  `EmptyState` (16 under a flush section's rule), `NoteText`, `ProgressLine(value:)`,
  `Disclosure(_, settingsRow:, keepsContent:)` (its arrow drawn, not read; `settingsRow` a
  disclosure that is a row of its own in Settings: the arrow on the sentence's first line,
  the sentence pressed through 44 points that reach into the row's air; `keepsContent` keeps
  what it opens in place, hidden and out of reach, while closed, as a closed `<details>` does).
- Data: `FiguresView([FigureItem])` (a line of cells shares its label, number and note rows;
  `FigureItem(unit:)` puts a unit after the number, small and muted, reports.css's `.fig-unit`),
  `FigureNote(delta:deltaTitle:words:)` (a note's change, faint dot and words as one line;
  `FigureNote(deltaText:parts:)` a dashboard card's, its words in parts, a dot after each but the last),
  `DeltaView(pct:)` (ChartFormat.deltaText), `DataTable(columns:rows:selected:part:chart:)` (a row
  is one VoiceOver element; `part:` .head or .rows for a held head, `chart:` the
  `.an-tableview .table` look), `TableScroll(maxHeight:) { DataTable }` (a chart's table: at least
  the column or 28rem, at its start) or `TableScroll(maxHeight:head:) { rows }` (its head held
  over the rows as they scroll).
- Page structure: `PageHeader(PageHeaderModel(title:sub:access:crumbs:), titleTools:,
  period:, actions:, extra:)` (pass the period picker as `period:` and the rest as `actions:`:
  a phone puts the period first and the rest at the far end; a lone primary action sits beside
  the title), `VirgaPage` (a tap on the page itself, off its controls, ends editing, as a
  field's blur), `PageColumn`, `VirgaSection(title:sub:trailing:flush:caption:captions:)` (a
  small Segmented as `trailing` says so, and goes under the line on a phone; `captions` more
  `.card-caption`s, each 12 under what is above it), `SectionFoot(count:
  letOut:)` (`letOut:` the size of a ghost button that starts it), `VirgaRow(roomy:time:) { }
  actions: { }`, `RowWords`.
- Helpers: `FlowLayout`, `ScrollRow` (`.scrollRowFocus(_:)` marks the item to bring into
  view), `BesideOrUnder` (a wrapping flex row of two), `.touchReach`, `.touchTarget`,
  `.virgaFocusOutline` (put on the Button or Menu itself, or inside a ButtonStyle's body: it
  binds its own FocusState and also reads `isFocused`).
- Toasts: `ToastCenter` and `ToastStack`. The app has one center, `ComposerHost.toasts`
  (App.jsx's ToastProvider, above the account): `.composerHost(_:)` puts it in the environment of
  everything under it and draws it, so every page's toasts and the composer's share one column, at
  most three, and outlive a switch of account; ShellView draws its own only with no host round it
  (a preview). `push(_:danger:seconds:link:)`: a `ToastLink(label, url:)` follows the words, 600
  and underlined, the one thing in the stack that takes a press (the posted toast's View it on
  Bluesky).

SHELL (Shell/)
- From 900 wide: Virga's own layout, an HStack of the sidebar (272, or the 72 rail when
  folded; no ground, on the sky) and the page, held to `--shell-max` and centred; no
  NavigationSplitView (iOS 26 gives its sidebar a floating panel). Below 900: a
  NavigationStack, the app bar drawn in the page's content on a top-level page
  (`AppBarRow`, the navigation bar hidden), and on inner pages `AppBarBack` (‹ and the
  page above, parentOf's label, in the bar's leading place: iOS 26's own back button is a
  bare chevron) with the system's button hidden and its edge swipe kept by
  `SwipeBackKeeper`; Virga's own TabBar in `.safeAreaInset`.
- `ShellNavigator`: `path`/`search`/`hash`, `navigate()` on Router.hrefFor, `route` from
  ShellRoutes.parseRoute, `title()`. From any view: `@Environment(\.navigate) var navigate;
  navigate("/reports/followers")`. On a phone the stack path is the parentOf chain.
- `ShellDashboards` reads the stored layout (`virga:dashboards:<did>`) and remembers the
  last dashboard.
- **A new page plugs in** as a case in `RoutedPage.page(_:)`, drawn with `VirgaPage`. Every
  route resolves already: an unported page is `UnportedPage(header)` (its real header and
  "This page isn't in the iOS app yet.").
- `FirstRun.swift` (the first build's page, where a route needs the archive and it isn't
  built), `SyncStatus.swift` (the sidebar's sync card, the phone's strip, Sync now in the
  account menu), the period picker and its custom range (`PeriodPicker`, `usePeriod` as
  PreferencesModel extensions), and the command palette (Search in the app bar and the
  sidebar, ⌘K, which also closes it; recent commands under `virga:palette-recent`). ⌘K is held
  back while the composer is open (the hidden button that carries it is disabled) and while
  another sheet is up (`KeyTargets.isPresenting()`), except to close the palette, as the web's
  is while another dialog is open. A sync that fails is read out once by ShellView, in the
  words of the page's role="alert" line.
- Settings rows: `SettingsRow(label:hint:block:compactControl:kind:)`, where `kind`
  (`SettingsControlKind`: `.button`, `.segmented`, `.toggle`, `.state`, `.prose`; a switch
  by default where `compactControl` is set, else a button) says how far the control is
  drawn up to centre it on the name's first line, as settings.css does on a touch screen
  (a switch by its 24-point capsule: it is laid out 40 × 24, its 44-point reach only its
  content shape). `.pressingName { … }` is a `<label htmlFor>`: a press on the name presses
  the control (pass the switch's flip), and the name isn't read twice. `SettingsRow(block:)
  { … }` is a block row with no label, the control alone with a row's air and hairline.
  A select is `SettingsSelect` (the kit's VirgaSelect over a preference), laid out by
  `SettingsSelects`; the sky's and the accent's grids are `ChoiceGrid` (auto-fill columns
  from the grid's own width), radio groups on a hardware keyboard.

CHARTS (Charts/), in Swift Charts over bucket indices
- `SeriesChart(series: [ChartPoint], seriesLabel:, secondary: ChartSecondary?, stacked:, trend:,
  mode: .bars|.line, unit:, zeroBase:, ghost: ChartGhost?, format:, marks: [SeriesMark]?, height:,
  accessibilityLabel:)`; `ChartPoint.of(...)` takes SeriesPoint, TrendPoint or RatePoint arrays.
  A press is the hover (`chartXSelection`), with the readout on its own ground. VoiceOver reads
  the chart as one element (`.accessibilityElement(children: .ignore)`, as Heatmap is) labelled
  with the web's summary, as the web's one `<svg role="img">` is; Show as table has the values.
- `ChartTable(series:secondary:trend:unit:valueHead:secondaryHead:format:trailing:) { actions }` and
  `ShowAsTable(actions:trailing:table:)`: the line under every chart (44 points a line, `trailing` a
  phone's ⋯ at its end) and its table, `ChartTableView(columns:rows:)` (the kit's TableScroll with
  its head held over the rows: two DataTables, head and rows, that each hold every cell, the
  other's at no height). `BarList(rows: [BarListRow])`,
  `Heatmap(rows:columns:summary:)`, `Sparkline(values:height:)`.
- More of charts.css', dashboards.css' and reports.css' measures are in Reports/InsightMeasures.swift
  (extensions of Measure.Chart, .Dashboard and .Reports), which Theme/Measures.swift no longer
  repeats.

DASHBOARDS AND REPORTS (Dashboards/, Reports/)
- `ShellDashboards` is DashboardsContext's provider now: every action over Layouts, written back
  under `virga:dashboards:<did>` at once.
- `DashboardPage(dashboard:)`: header with ⋯, Customize (move up/down, size, Remove, the library
  in a dialog, its search VirgaInsights' `Catalog.libraryMatches(query:category:)`: the web's
  lower-cased substring of the name or of the description, each on its own, nothing folded), the
  period picker; `CardGrid` (twelve columns, dashboards.css's 860/620 rules);
  `WidgetBody` draws the ported cards (four figures, six charts, Best time); the rest show their
  title and `Unported.card`. The posting cards (MoreWidgets.swift: `PostingStatScheduled`,
  `PostingStatTimers`, `PostingNextCard`, `PostingDraftsCard`) read what the overview reads, through
  THE POSTING PAGES' `PostingLoad`, for the dashboard's account; without a long session they say so.
- `ReportsIndex`, `ReportPage(report:)`: every report (Followers, Posts, Engagement, Content,
  Blocks, People, Atmosphere), with `PersonRow`, `PersonList` (measures a list for its rows' meta
  line) and `PostRowView` (Reports/People.swift); `ChartNotes` and `ChartNotesModels.marks` (one
  AnnotationsModel per account, read again by `ChartNotesModels.reload(did)` each time a shell
  opens for the account, as useAnnotations reads on mount, so notes deleted with the account's
  data don't come back) put the notes and the follower milestones on the charts; every
  dashboard card (`MoreWidget`), and the card settings dialog (`CardSettings`) from Customize.
- A report's actions (`ReportActionWords`, or the ⋯ on a phone) are passed to its report view as
  `actions:`/`more:` and end up on its lead ChartTable's line; Export is `ReportExport.file` through
  `.toolExporter`, Post this chart `.shareDialog`. The engagement report's direction is
  `?direction=given` (`ReportQuery.replace`, the web's replaceState; DashboardPage drops `?edit=1`
  the same way). `ReportCard`'s small Segmented goes under the title on a phone (the kit's
  SectionHead does it); `ReportSplit` is `.report-split` over the tools' ToolSplit;
  `ReportParts.fig` (a number, or `text:` words, each taking `unit:`; `note:` for a note that is
  markup) draws its change and words as the kit's `FigureNote`. A report's header passes the
  period picker as PageHeader's `period:`, as the dashboard's does.
- Dialogs whose foot acts on what is typed in them draw their own `DialogFrame` and are presented
  with `.dashboardDialog(isPresented:size:)`: RenameDashboard, NewDashboardDialog (also from
  Settings › Dashboards and the shell), CardSettings, AddToDashboard, and the report library (its
  own `DialogHead`, the search held over the list). A card's width is `\.widgetWidth` (the web's
  `@container widget`), and `\.statValueOnly` draws a figure down to its number.

TOOLS (Tools/)
- `RoutedPage` sends `/tools` to `ToolsIndex` and `/tools/<key>` to `ToolPage(toolKey:)`, which
  draws the tool's own view (it takes its `ToolEntry`) or the page of one that isn't built.
  Every tool page starts `VirgaPage(header: ToolHeader.header(tool, sub:, actions:))`.
- The tools: Best time, Follow back, Unfollow tracker, Lists you're on, Archive search,
  Identity, Follow cleanup and the Interaction lookup, each over VirgaInsights' model of the
  same name. Anything fetched (the activity check, a handle looked up, a PDS read) goes
  through the session's network, `app.archiveEnvironment.transport` (the made-up world's in
  the demo). The lookup's chosen account is `?who=<did>` on the navigator.
- What more than one tool draws (ToolParts.swift), named `Tool…` so it can't meet the
  reports' `PersonRow`/`PostRowView`: `ToolPeople` (cardFor, displayName, profileUrl),
  `.wantActors(archive, dids)` (useWantActors), `FollowWriter` and `ToolFollowButton` (a
  follow per row, busy and its error), `ToolPersonRow`, `ToolPostRow`/`ToolPostMeta`,
  `ToolStatement`, `FilterCards`/`FilterChoice` (figures that are the filter, their counts
  sized from the row as the web's clamp()s are), `KVList` (it measures itself, and its
  rows choose their layout by its width, as the `.kv` container query does),
  `TimelineList`, `ToolMoreFoot` ("Show 30 more"), `ToolSelect` (`hidesLabel` over a list
  on a phone), `ToolSplit` (`shares`, and `mins` for a `minmax(300px, 1fr)` column),
  `ToolSpreadRow` (flex-wrap with space-between: the line over a table, the activity
  check), `ToolEmptyLine` (a bare `.empty`, 24 above and below), `ToolCaption`,
  `.toolAnnounces(text, onAppear:)` (what the web marks `role="status"` or `role="alert"`,
  posted to VoiceOver), and `.toolExporter($file)` with `archive.exportRows(name, rows)`
  for Export. A person row's meta (`ToolPersonMeta`) is one line ending in an ellipsis that
  drops "follows you" under 600 and the handle under 480 when the row has a fact, by the
  list's width.
- From 641 wide Follow cleanup and Lists are tables (`CleanupTable`, `ListsTable`, a Grid;
  the cleanup table's account is 36% of its width, as `.cleanup-table td.col-main` is, the
  other columns sharing the rest, and the lists table's name takes what the rest leave);
  narrower, rows as the web's phone sets them. `Measure.Tools` (ToolMeasures.swift) names
  tools.css's measures.

SHARING (Share/)
- The hook, for a card or a report: `PostChartButton(type:name:options:period:)` (a card's
  ghost icon), or `@State var share: ShareRequest?` with `.shareDialog($share, period:)` (a
  report's Post this chart and its ⋯). Each draws nothing for a type ShareSpec can't picture.
- The picture is `ShareImage.render(spec, theme:)`: VirgaInsights' ShareSpec drawn by
  ChartImage onto `GraphicsShareCanvas` (its `ShareCanvas` over a SwiftUI GraphicsContext)
  in an ImageRenderer at scale 1, 1200 × 675, under the sky on screen.
- Write a post with it calls `@Environment(\.shareComposer)` (a `ShareComposer` taking a
  `ShareDraft`: whose post, its first line, the PNG and its description) once the dialog's sheet
  has gone; ComposerHost's modifier sets it, writing the PNG as a temporary file and opening the
  composer with `images: [{ file, alt }]`. Where nothing sets it (a preview) the picture and the
  first line go out through ShareLink as virga-chart.png. Save the picture asks Photos for
  add-only access (NSPhotoLibraryAddUsageDescription in project.yml) and says how it went in a
  toast.

DEFENSE (Defense/)
- `RoutedPage` sends `/defense/<page>` to `DefensePage(pageKey:)` (scan, lists, history)
  while `app.flags.defenseEnabled`, else NotFound. The scan (DefenseScanPage, ScanResultView,
  RadarView as a SwiftUI Canvas, AddToListCard), the lists (DefenseListsPage, read again
  while anything is being written; ModeratorCard while `defenseModeratorEnabled`) and the
  history (DefenseHistoryPage, every 15 seconds while anything waits) run over VirgaDefense's
  models with the session's transport and agent. `Measure.Defense` names defense.css's
  measures.
- In the demo, Defense and its moderator are on whatever the build says, as the web's harness
  has them (vite.harness.config.js); `-VirgaDefense off` (or `-VirgaDefenseModerator off`)
  turns one off (`AppModel.demoFlags`), and `-VirgaDemoFlags "defense=on"` (the scan) or `"defense=lists"`
  (the lists' permission too) has the demo grant it. The demo's server answers every Defense
  route (VirgaDemo's DemoDefense), and `AppModel.demo` starts its workers
  (`DemoSession.startCron()`, every `cron=` seconds, 20 by default), so a plan's adds and
  removes are written as on the real server and a link code lands ten seconds after it is
  made. DefenseUITests runs with `defense=lists&cron=2` and `-VirgaDefenseModerator on`, and adds
  `defense-add-confirm`, `defense-add-done`, `defense-moderator-code`, `defense-moderator-linked`,
  `defense-history-undo` and `defense-history-undone` to its screenshots.

TEMPLATES AND POSTING (Templates/, Posting/, Settings/PostingSettingsSection.swift)
- `TemplatesPage(session:did:id:)` from RoutedPage's posting case (`/posting/templates`, and the
  iOS-only `/posting/templates/new` and `/posting/templates/<rkey>`, which open the editor). Each
  view that the web gives `useTemplates(did)` makes its own `TemplatesModel(session:did:)`, with
  `start()` in `.task` and `stop()` on disappear; the app sets `TemplateService.shared` with its
  key-value store at launch (AppModel).
- `.templateEditor(isPresented:did:template:seed:onSaved:onDeleting:)` is TemplateEditor.jsx, a
  full-height sheet over `DialogFrame` (no dialog foot) with the editor's own, `TemplateEditorFoot`
  (`.tpl-actions`: a hairline over it on the dialog's ground, Delete apart at its start, the buttons at
  their own widths, the prompts in their place), in its bottom safe area. `.templateEditor(item:did:
  template:onDismiss:)` opens it on an Identifiable's template and keeps that template while the
  sheet goes down (the Templates page). Its reads (recent posts, a quote's view, a pasted link) go
  through LibrarySources (fetchOwnPosts, hydrateEmbedViews, resolveRecordLink, resolveExternalLink);
  a web page's link card is `LinkCard.fetchLinkCard(transport:)`. The recent posts are read in a task
  of their own: a `.task(id:)` keyed on the status it sets cancels its own read.
- The name's `maxLength={200}` only refuses growth past 200 UTF-16 units: a longer name the template
  already has is kept as it opens (so no false Discard your changes?), and a paste that runs over is
  cut on a character boundary (`TemplateEditor.fitting`). Each field's problem is its accessibility
  hint (aria-describedby), and when Save is refused the first problem is read out as the focus moves
  to its field.
- `TemplateQuestions(template:context:…autoFocus:preview:onDone:)`, `ChoiceGroup` (its answers
  `ChipStyle(isOn:wraps: true)`, wrapping in their chips) and `TemplatePreviewView` are for the
  composer's library, which passes `preview:` from `Library.previewFor` within the post under way; on
  its own a template previews through `TemplateQuestions.defaultPreview` (previewFor of
  itemFromTemplate). `TemplateBones(shares:titleFirst:)` is `.lib-bone-card`.
- Posting/PostingParts.swift: `PostingHeader.model(key)`, `RowSkeleton` (each row as tall as its
  bones, the action bones under them on a phone), `.hubBonePulse()` (the bones' pulse), `LoadError`
  (role="alert", its triangle centred with the sentence and Try again) and
  `.postingConfirm(isPresented:title:onConfirm:message:)` (hubParts' ConfirmDialog: it opens on Cancel,
  `data-autofocus`; no swipe away while it works, a refusal read out; the Drafts, Posted and Templates
  pages' deletes). A count in words is VirgaPosting's `HubModel.countPhrase`. Use opens the
  composer through `ComposerHost`.
- Settings › Posting is `PostingSettingsSection` over `PostingSettingsModel`, with the composer's
  `LanguagePicker` (`bare: true`: the row names it) and `GatesEditor`, stacked 12 apart and held to
  420 (`Measure.SettingsPosting`); Account and Main button are `SettingsSelect`s
  (`PostingSettingsSelectWidth`: 220 to 320, the whole line from 760 down); each switch row's name
  presses its switch (`pressingName`); a refused change is `PostingSettingsRefusal` (the words-alone
  danger Callout, read out, 16 above and 4 below). Its weekly queue reads VirgaPosting's
  `ScheduleModel` (the week's count and summary, the zone's name, moveToZone) and draws scheduleParts'
  `TimezoneSelect` (`fill` from 760 down); Edit the week is read as a link. The Post adviser's card is
  `AdviserSettingsCard` when the account can use the server (else `NeedsBackendNotice`), its text
  areas with their example placeholders over the TextEditor, and the Default timer's editor is
  `LifespanRuleEditor` (no exact time, no toggle of its own, `settingsLegends: true`, held to 640; the
  switch above it, `default-timer-on`, keeps `enabled`). Both cards' disclosures are
  `Disclosure(settingsRow: true)`, the default timer's rule kept while closed (`keepsContent`).
- `Measure.Templates` (Templates/TemplateMeasures.swift) names library.css's and hub.css's measures.
- PostingUITests (`testTemplatesAndPostingSettings`, no archive build): `posting-templates`,
  `template-editor`, `template-editor-questions`, `posting-template-use` (Use on Event reminder: the
  composer, its questions in the library), `settings-posting`, `settings-posting-timer`.

ADVISER (Adviser/, Composer/ComposerController+Adviser.swift, Posting/)
- The views are over VirgaPosting/Adviser's logic, unchanged: `AdviserGateModel` (the composer's
  `controller.adviser`, made in its init over the session's store and transport and configured
  by `configureAdviser(open:)` when the sheet appears, closes or the account changes),
  `StyleSession` (one per opening of the style dialog), AltTextModel and AltTextFollowUp over
  `AIService.generateAltTextForFile`, BackendAccess and PostPreview. `Measure.Adviser`
  (Adviser/AdviserMeasures.swift) names adviser.css's measures; `Measure.Posting` the
  needs-backend notice's and the post preview's; `Measure.Lifespan` the rule editor's.
- `AdviserBusyLine(busy:onPublishAnyway:onKeepEditing:)` is AdviserBusy.jsx (`adviser-busy`; slow
  after `AdviserContext.slowReadAfterMs`); `AdviserGlyph` the adviser's symbols.
- `.adviserSheet(adviser)` presents AdviserSheet.jsx while `adviser.sheetOpen` (`adviser-sheet`,
  `adviser-verdict`, `adviser-fix-all`, `adviser-sheet-keep-editing`, `adviser-sheet-publish`).
  The marked draft is one `Text` of runs: a fix is a link (`adviser-fix:<key>`) the sheet's
  `openURL` action takes, a span is underlined in its tone, and a numbered note lights its passage.
  VoiceOver reads each post through a label in the web's hidden words (Post 1/2, Change “x” to “y”,
  Fixed:, note 1), each fix still to take an accessibility action of its own. adviser.css's phone
  rules (640 and under: the busy line's equal shares, the alt picture's 180, the revise column,
  Forget my style's own line) follow `theme.composerNarrow`.
- `.adviserStyleDialog(isPresented:did:model:)` is StyleDialog.jsx (`style-dialog`, `style-read`,
  `style-summary`, `style-keep`); `AdviserSettingsCard(did:model:)` AdviserSettings.jsx
  (`posting-adviser`, `adviser-enabled`, `adviser-learn-style`), saving `["adviser": json]`
  through PostingSettingsModel.
- `AltTextDialog(image:requester:did:context:store:onSave:onClose:)` is AltTextDialog.jsx with its
  describing and revising (`alt-dialog`, `alt-describe`, `alt-revise`; the writer's field is the
  composer's `describe-text` and `describe-save`). The composer shows it for an image when the
  account can use the server, and the plain DescribeDialog otherwise
  (`DescribeDialog.altText(image:transport:onSave:onClose:)`, given `controller.transport`). The AI
  dialog takes its transport from AppModel in the environment (`app.archiveEnvironment.transport`,
  the one the composer has), so a draft's image kept only as a posted blob (a CDN preview) is drawn
  in both dialogs through `LocalPicture.picture(_:transport:)`; to describe it, the AI dialog fetches
  the bytes as the web's fileFromPreview does (15 s; a refusal or an empty answer is "There’s no
  image to describe."), typed by the answer's content-type, else image/jpeg.
- In the composer (marked `ADVISER` in ComposerController, +Actions, ComposerSheet and
  ComposerOptions): `submitPost(skipAdviser:)` runs `adviserGate` first (`check(s, mode: gate)`,
  the busy line in the status, then "Getting it ready"; Save as draft from the sheet saves the
  draft, Publish anyway goes on); Check this post in the settings (`option-adviser`, its usage line
  its hint, as the web's title) is `askAdviser()`, and Keep editing puts the caret back; while a read runs the post is held still (`adviserReading` disables
  the editors and the actions) and the busy line sits over it.
- `NeedsBackendNotice(did:)` is NeedsBackend.jsx (`needs-backend`: Reconnect lengthens the
  session, Sign back in asks for reauth); `PostPreviewCard(view:record:uri:compact:)` is
  PostPreview.jsx; `LifespanRuleEditor(value:onChange:…)` is LifespanEditor.jsx (`lifespan-editor`,
  `lifespan-sentence`, `lifespan-add-condition`). `PostingHeader.header(...)` is PostingHeader.jsx,
  and RoutedPage's posting pages that need the server show NeedsBackend as PostingPage.jsx does.
- AdviserUITests (`testTheAdviserOnTheDemo`, no archive build, over the demo server's AI routes):
  `settings-posting-adviser`, `settings-posting-timer-editor`, `adviser-style`, `adviser-busy`,
  `adviser-check`, `adviser-gate-busy`, `adviser-gate` (or `adviser-gate-passed`) and
  `alt-text-described`.

SCHEDULING (Posting/Schedule*.swift, Posting/ScheduledPage*.swift, Posting/WeeklySchedulePage.swift,
Posting/WhenPicker.swift, Composer/ComposerController+Schedule.swift, Composer/ComposerWhenPanel.swift)
- Over VirgaPosting's Schedule and Pages ports, unchanged (notes/scheduling.md): the rows, the week and
  the picker's words are ScheduleModel's, the reorder QueueReorder's, the calendar QueueCalendar's, the
  calls ScheduleService's over the account's `VirgaBackend` (`app.session.backendFor(did)`).
- `Measure.Schedule` (Posting/ScheduleMeasures.swift) names schedule.css's measures (and the few of
  hub.css's the rows use, and the toasts' and clocks' durations from the JSX).
- Posting/ScheduleParts.swift, what more than one page draws: `TimezoneSelect(value:identifier:onChange:)` (the kit's
  VirgaSelect), `ScheduleSwitch` (the web's Switch), `QueueCalendarView(schedule:rows:now:onPick:occupancy:highlight:
  caption:lead:after:)` (a SwiftUI Grid; VoiceOver reads it day by day through sort priorities),
  `.scheduleActionDialog(isPresented:title:confirmLabel:busyLabel:cancelLabel:danger:onConfirm:message:)`
  (ActionDialog, which the Timers page asks too, its quoted post a `HubQuote`: it opens on Keep it, can't be closed or
  swiped away while its action runs, and reads a refusal out as a danger Callout of words), `ScheduleLinkedText`
  (words with links the navigator follows, through
  `InternalLink`), `ScheduledListLoad` (hubParts' useLoad over listScheduled, with the limits when asked,
  read again on `virga:scheduled-changed` / `virga:timers-changed` for the account), and the small
  helpers `ScheduleIds` (lists of ids; two ids are `===` as THE POSTING PAGES' `PostingPages.sameValue`, which is
  the main actor's, so `contains`, `index` and `sameOrder` are `@MainActor` too),
  `ScheduleText` (the clock; a thrown error's `err.message` is `PostingPages.message`), `ScheduleSaid` (a sentence
  as an error, a `ScheduleErrorObject`), `ScheduleGlyph` (the glyphs the posting pages draw too are `HubGlyph`'s).
  `Measure.Schedule.confirmGap` stays beside `Measure.Hub.confirmGap`: they are two rules (`.sched-confirm`,
  `.hub-confirm`) in two stylesheets.
- `ScheduledPage(app:did:)` (RoutedPage's `/posting/scheduled`) over `ScheduledPageModel`
  (ScheduledPage+Model.swift: the clock, busy rows, the message, the optimistic redraw while an order
  saves, the drag, the lit row, the announcements, the question up; its posting settings are made in `start()`, since
  SwiftUI makes the page's model again on each redraw and a PostingSettingsModel listens from the moment it is made).
  The page's message is a `role="alert"` Callout (the same words again go through `announce`). Rows are `ScheduledRowView`
  (ScheduledPage+Rows.swift) in one flat `ForEach` of `ScheduleListEntry` (day names and rows) so a row
  keeps its view, and its drag, as it changes day. Reordering: wider than a phone the `QueueHandle`
  (inline below 900, in the page's margin from 900) takes a drag over the rows' frames
  (`QueueRowFrames`; a drag the system cancels, which calls no onEnded, is seen through a `@GestureState` and puts
  the row back), the keys (Space or Return, the arrows, Escape) and VoiceOver's adjust (its value the row's place,
  each step said, `adjust`); a phone has Move earlier and Move later (`step`, which says only that the order is saved,
  as the web's arrows do). A taken time pressed in the week gives its row's first
  button (the handle, else Retry or Edit) the focus, a keyboard's and VoiceOver's (`ScheduleRowFocus`). On a phone
  the ⋯ (and a timer note's ✕) is out of the row's flow, centred 9.5 into it (`Measure.Schedule.cornerMenuCentre`),
  and the time line's dot is `WhenDot`. A question keeps the row it asked about while its sheet slides away
  (`ScheduledDialogs.asked`). Identifiers: `scheduled-page`, `sched-notes`, `sched-failed`, `sched-queue`,
  `sched-queue-list`, `sched-timed`, `sched-row-<id>`, `sched-note-<id>`, `sched-edit`, `sched-retry`,
  `sched-handle`, `sched-move-earlier`/`-later`, `sched-note-set-timer`, `sched-note-dismiss`,
  `sched-add-to-queue`, `sched-schedule-a-post`,
  `queue-calendar`, `calendar-pick`, `schedule-dialog` (`-keep`, `-confirm`, `-error`), `sched-limits`.
- `WeeklySchedulePage(app:did:)` (`/posting/schedule`): `DayRow` per weekday in the reader's week
  (`ScheduleWeek.orderedWeekdays()`; its + takes the focus to the new time and gets it back as the form closes; Copy
  to other days… is the kit's `.virgaDialog`), `ScheduleSuggestions.read(archive:…)` over the archive's best times
  through `ScheduleSuggestionsMemo` (the web's useMemo: worked out again only when the archive's data, the week or the
  switch change), `ScheduleSplit` (two columns from 1181) of `WeekSection`s, whose headings share the taller one's
  height side by side (`WeekHeadHeight`) so their rules line up. Its settings are made in `.task`. Identifiers: `weekly-schedule-page`,
  `week-times`, `week-day-<key>`, `week-add-<key>`, `week-add-time`, `week-add-confirm`, `copy-day-<key>`,
  `copy-days-confirm`, `week-reset`, `week-ahead`, `week-off`, `week-repack`, `week-suggestions`.
- `WhenPicker(schedule:value:onChange:queue:requester:onQueue:min:max:repeatRule:onRepeatChange:
  repeatBlock:occurrence:)`: the caller passes the account's weekly schedule (its settings' `queue`) and
  its `VirgaBackend` (nil without a long session), where the web reads them from the did. Its fields stack by its own
  width (measured, `@container when`), its selects are VirgaSelect, a problem is read out through `CalloutAlert` as it
  changes, and the queue's row is `QueueLine` (flex-wrap: Use this time under words that would get less than 200). Drafts'
  "Schedule this draft" dialog (`ScheduleDraftDialog`) takes it as DraftsPage.jsx does: no queue, no
  repeat, the account's `settings.queue` and `backendFor(did)` when it can schedule. Identifiers: `when-picker`, `when-date`, `when-time`,
  `when-pick-<key>`, `when-zone`, `when-problem`, `when-repeat`, `when-ends`, `when-until`, `when-count`,
  `when-repeat-note`, `when-queue`, `when-queue-slot`, `when-use-queue`.
- The composer (marked `SCHEDULE` in ComposerController, +Actions, ComposerSheet, ComposerParts):
  `controller.scheduling` (`ComposerScheduling`: whenOpen, the queue preview, the limits, the source
  warning, the row opened from) and ComposerController+Schedule.swift (`runSchedule`, `openWhen`,
  `submitSchedule`, `refreshLimits`, `applyScheduleRoom`, `readQueuePreview`, `loadScheduled`,
  `finishScheduledSource`, `retryCancelSource`, `nextHour`). `ComposerWhenPanel` (`when-panel`,
  `when-post-now`, `when-queue-preview`, `when-queue-note`, `when-change`) sits under the post's settings
  and `ComposerSourceWarning` (`composer-source-warning`) over the post; PublishButton takes the usage
  line as its `footnote`; the foot's Schedule is `composer-schedule`.
- ScheduleUITests (`testSchedulingOnTheDemo`, no archive build, over the demo server's seeded rows):
  `scheduled-posts`, `scheduled-timer-dialog`, `scheduled-timer-set`, `scheduled-queue`, `scheduled-picked`, `scheduled-timed`, `composer-queue`,
  `composer-when-queue`, `composer-queued`, `scheduled-reorder`, `scheduled-reordered`, `composer-when`,
  `composer-when-picked`, `composer-scheduled`, `composer-scheduled-edit`, `scheduled-skip-dialog`,
  `scheduled-post-now-dialog`, `scheduled-remove-dialog`, `weekly-schedule`, `weekly-schedule-changed`,
  `weekly-schedule-add`, `weekly-schedule-copy`, `weekly-schedule-reset`, `weekly-schedule-ahead`,
  `settings-posting-queue` (each `-ipad` on the iPad). A step the demo can't reach is skipped.
- Coming back to a page: on a phone the weekly schedule is pushed over Scheduled posts, and a page that
  goes stops its PostingSettingsModel (it no longer hears changes). Both pages make a new one when they
  appear again (`ScheduledPageModel.start()`, WeeklySchedulePage's `.task`), so a week changed on the
  pushed page is the one drawn after Back. The week ahead's day heads put the name beside the date from
  520 wide, measured on the calendar itself (in the weekly schedule's side column it is narrower than
  the page). The composer brings its when panel into view as it opens (a ScrollViewReader round the
  sheet's ScrollView, `ComposerWhenPanel.anchor`), as the web's scrollIntoView does.
- A timer note's Set a timer (`ScheduledPageModel.setTimer(arm)`) opens THE POSTING PAGES'
  `.postTimerDialog` over `PostTimerTarget(arm)`; once it's set (`timerArmed`) the page toasts "The
  timer is set. Posting › Timers shows it." and dismisses the note (`acknowledge`). The timers' page's
  and the timer and when dialogs' rules of schedule.css are THE POSTING PAGES' (Measure.Hub).
  Deliberate differences:
  useFocusAfterRemoval is the system's; the date, the time and a new weekly time are the system's
  pickers (no 5-minute step, always a whole time, no danger edge for aria-invalid: the hint says the problem); the
  picker's and a repeat's fields share their row evenly; forced colours have no counterpart. On a phone a pick from
  the week focuses Retry or Edit (the web's querySelector finds the hidden handle there and focuses nothing).

THE POSTING PAGES (Posting/: HubPage, DraftsPage, PostedPage, TimersPage, TimerDialog, LifespanDefaults)
- RoutedPage's posting case is PostingPage.jsx: a `needsBackend` page (Scheduled, the weekly schedule,
  Timers) shows NeedsBackend under its header, without its access line, for an account that can't
  schedule; otherwise the page, `.id(did)` so a switch never shows one account's state under another's:
  `HubPage(session:did:)` (/posting), `DraftsPage(session:did:id:)` (/posting/drafts and
  /posting/drafts/<id>, which opens that draft in the composer), `PostedPage(did:)`, `TimersPage(did:)`,
  Templates and the Library; Scheduled posts and the weekly schedule are `ScheduledPage` and
  `WeeklySchedulePage` (SCHEDULING above).
- `PostingLoad<Value>` (HubParts.swift) is hubParts.jsx's useLoad: `follow(key:did:events:enabled:_:)`
  from the view's `.task(id:)` (the same key keeps what's on screen, a new one starts over, `enabled:
  false` is `.idle`), read again on each posting event for the account (`PostingEvents.*ChangedEvent`);
  `phase` (.idle, .loading, .ready, .failed; a failed reload stays .ready with its `error`), `data`,
  `stamp` (moves on with every answer, for what the web runs in an effect on `data`: Timers' drop-off check
  and Posted's older pages), `reload()`, and `stop()` on disappear. Drafts has its own `DraftsPageList` (useDraftList, a page at a
  time).
- `PostingPages` (HubParts.swift) holds what the web reaches through its window and stores:
  `deviceId(app)`, `settings(app, did)` (a one-off read of PostingSettings), `archivePosts(archive, did)`,
  `authorFeed(did, limit:cursor:transport:)` (getAuthorFeed's rows through rowFromPostView, reposts left
  out), `media(app)` (PublishMedia over TemporaryComposerFiles, ImageIO and the session's network),
  `draftMedia(app, did)`, `target(app, did)` (a PublishTarget), `asDid(did)` and `draftIntent(id, did)` (the
  composer's intents, built outside the menus' closures, which the compiler checks with the whole item),
  and `message`/`code` (a thrown error's
  `err.message` and `err.code`, through ScheduledPostError.errorObject). Post now and Schedule on a draft
  run DraftActions with `DraftActionDeps.live` over these; Posted's actions run PostedModel.
- Rows: `HubRowText` (two lines, a draft's three, or its muted stand-in), `HubRowWhy` (muted, warn or
  danger), `HubPostMeta` (PostRow.jsx's PostMeta and postWhen, with an `extra` piece),
  `HubPostWords`/`HubPostedRow` (a post's words as the way to it on Bluesky, and its line), `HubTimedRow`
  (a row led by its day over its hour in `--time-col`; on a phone its first line of meta),
  `HubCornerRow(words:button:menu:)` (`.has-corner-menu`: on a phone the ⋯ in the row's top corner and the
  button under the words; wider, the ⋯ reaching 6 past the actions group above and below, so the group is
  the small button's 32 centred on the first line), `DraftsRowMenu` (the ⋯, one labelled menu throughout,
  its dots a `HubSpinner` while the row works), `HubQuote`, and
  `PostingPagesError` (a sentence a page throws to its dialog, which shows it).
- `.postTimerDialog($post, did:onArmed:)` is TimerDialog.jsx (`PostTimerDialog`, beside the
  composer's own `LifespanDialog`, COMPOSER TIMER below), over a `PostTimerTarget` (uri, cid, extraUris, text,
  postedAt, reply; nil reply or postedAt is the web's undefined and is read from Bluesky).
  `PostTimerTarget(arm)` takes a scheduled post's timer note (ScheduleModel.TimerNoteArm), for the
  Scheduled page's "Set a timer" (SCHEDULING above). `onArmed` hears the armed row after the sheet has
  closed.
- `LifespanDefaultsCard(did:model:)` (Posting/LifespanDefaults.swift, from Settings › Posting) reads
  getLimits with a long session, so its editor checks the free timers and its caption starts with
  timerLimitsLine; the caption's See posts on a timer is `ScheduleLinkedText` (underlined, through the
  navigator to `postingPath("timers")`).
- `LifespanRuleEditor`'s parts: a legend 8 over what it names (`settingsLegends` draws it at
  --text-md, 500, as Settings' rows); the sentence at 0.875rem, posted to VoiceOver as a queued
  announcement when it changes (`LifespanPoliteStatus`, the web's aria-live="polite"), and the pin
  and room notes as they arrive (role="status"); from 560 down a condition is
  `LifespanPhoneCondition`, the web's two-line grid; Or a set time without a pin is an empty field,
  whose press sets the earliest allowed time at the next whole minute for the system's pickers to
  change.
- The Timers page's question is `TimersCancelDialog`: TimersPage.jsx's words over SCHEDULING's
  `.scheduleActionDialog` (Keep it, the action in ink, the busy label, a refusal's words kept; its
  identifiers `schedule-dialog`, `-keep`, `-confirm`, `-error`). A dialog's quoted post on every
  posting page, Scheduled posts' included, is `HubQuote`. `Measure.Hub` (HubMeasures.swift) names the
  measures of hub.css and of schedule.css's Timers and timer-dialog rules that these pages use.
- Identifiers: `posting-hub`, `posting-nav` (`posting-nav-<key>`), `hub-next`, `hub-retry`, `hub-drafts`,
  `hub-draft-open`, `hub-posted`; `drafts-page`, `drafts-list`, `draft-row-<id>`, `draft-open`, `row-menu`,
  `drafts-notice`, `drafts-new-post`, `schedule-draft-dialog`, `when-picker`, `schedule-draft-queue`,
  `schedule-draft-confirm`; `posted-page`, `posted-search`, `posted-list`, `posted-row`, `posted-more`,
  `posted-error`, `posted-gates-dialog`, `posted-gates-save`; `timer-dialog`, `timer-dialog-start`,
  `timer-dialog-set`, `timer-dialog-acts`, `timer-dialog-error`; `timers-page`, `timers-live`,
  `timers-waiting`, `timers-failed`, `timer-row`, `timer-cancel`, `schedule-dialog-confirm`,
  `timer-waiting-row`, `timers-settled`, `timers-limits`, `timers-empty`; `default-timer-caption`.
- PostingPagesUITests (`testThePostingPagesOnTheDemo`, no archive build, over the demo server's seeded
  rows): `posting-hub`, `posting-hub-posted`, `posting-drafts` (or `-empty`), `posting-drafts-menu`,
  `posting-drafts-schedule`, `posting-posted`, `posting-posted-menu`, `posting-timer-dialog`,
  `posting-timer-set` (or `posting-timer-dialog-refused`), `posting-timers` (or `-empty`),
  `posting-timers-settled`.
- Schedule this draft's time is the scheduling pages' `WhenPicker` (SCHEDULING above), on the queue's
  clock, an ISO string or nil as the web's `when`. Its body is spaced as `.hub-confirm` (12), and its foot
  is DialogFrame's `stackActions` (on a phone Schedule, Add to queue, Cancel, one under another).
- What the web reads out: a role="alert" line is the words-alone `Callout(tone: .danger, words)` (LoadError
  passes `alert:`), a role="status" or aria-live one `.toolAnnounces(words)` (Drafts' warning and the room
  line as they arrive, the timer dialog's first-acts time as it changes).
- The row of posting pages (`HubPostingNav`) is `.scroll-row--bleed`: let out by the page's margin and
  padded back, so it scrolls out to the screen's edges, its keys SegmentedKey's measures with a count.
- Deliberate differences: the focus after a row goes (posted, deleted, called off) is the system's to
  place, not useFocusAfterRemoval's; a timer row whose model throws (a corrupt `acted` step, a web bug
  in timerRowModel) is left out where the web's page would fail. The web shows
  no PostPreview on the posted or scheduled rows (only in the composer's dialogs, a quote's card, the
  reply's context and the library), so neither does the app. Retry and "see what happened" are pressed
  through at least 44 points (DESIGN.md › Touch), where the web's `inset: -12px -6px` gives 42.85.
- Still hand-built: Drafts' and Timers' empty blocks (the kit's EmptyState takes neither a button with
  an icon nor a sentence with a link), and the kit's VirgaRow doesn't yet let a ⋯ reach past its actions
  group as HubCornerRow does (VirgaRow has no callers outside its previews, so no screen shows it yet).

COMPOSER TIMER (Composer/ComposerController+Timer.swift, Composer/LifespanDialog.swift)
- The post's timer is the state's `lifespan`; `model.lifespanTouched` (ComposerStateModel) says the writer
  chose it. Every line that reaches the timer from the composer's other files is marked `TIMER`.
- `timerFit` is composerTimerFit (a reply can't limit replies; without a long session there's no timer).
  `defaultTimer` is ComposerDefaults.defaultTimerFor over the settings' `lifespan`, `caps.canSchedule`, the
  limits as `controller.limits` has them (loading until read for the account) and the fit's `available`.
- The web's effect on `[defaultTimer, generation]` is ComposerBody's
  `.onChange(of: controller.defaultTimerKey, initial: true)` (`ComposerDefaultTimerKey`): `applyDefaultTimer()`
  puts the default on a post whose timer the writer hasn't chosen, whenever the default changes (the limits
  read, the account, a reply, the session) or a state is loaded (`generation`). The limits are read again when
  the account or whether it can schedule changes (the web's effect on `[open, asDid, caps.canSchedule]`). It runs while the sheet is up,
  which is the only time the post is seen; a state loaded while it's down takes the default as it opens.
- `timerNote` (why the default is off; once chosen, timerNeedsServer or timerRoomProblem with the scheduled
  row's `holds`) is a FieldHint under the post's settings while the post has no timer
  (`composer-timer-note`), and the Timer button's `.help` and VoiceOver hint (the web's `title`).
- `LifespanDialog(value:fit:publishAt:limits:did:holds:note:transport:onSave:onClose:)` is ComposerDialogs.jsx's
  LifespanDialog over THE POSTING PAGES' `LifespanRuleEditor`: the rule is a `@State` set from the post's as
  the sheet is presented (useResetOnOpen: the composer redrawing underneath doesn't reset it), the note a warn
  Callout over the editor, Cancel, and Done (`saveTimer`, below). The sheet takes the whole
  height (`ComposerDialog.timer.isTall`). Identifiers: `lifespan-dialog`, `lifespan-dialog-note`,
  `lifespan-dialog-cancel`, `lifespan-dialog-done`, and the editor's own (`lifespan-editor`,
  `lifespan-sentence`); the editor's switch is found by its label, "Put a timer on this post".
- Posting now (submitPost): validateComposer's lifespanProblem is immediateTimerProblem where a timer can be
  set; `askNoFreeTimer` reads the limits again and asks "No free timer" (`ask-edit`, `ask-without`: Post
  without it turns the timer off and marks it chosen); after the adviser, `timerChecked` throws a passed set
  time's sentence (a `JSError`, said under the post) and turns the timer off without a server. Once the post is
  out, `armAfterPublish(s, result)` arms it through TimerService.armAfterPublish over the root post's account's
  `VirgaBackend`, with the fit as it is then, the first post's snippet and the first record's `createdAt`; it
  isn't waited for: an adjustment's note is a toast, a failure "Your post went out, but without its timer."
  with the error's message (danger, `Measure.Schedule.warningToastSeconds`), and the limits are read again.
- Save as draft's toast starts its notes with draftTimerNote (the default as the save began). A scheduled
  post's timer is submitSchedule's (SCHEDULING above: its own No free timer, scheduledTimerProblem,
  serializeForSchedule's fit), unchanged; a scheduled post opened to edit loads touched, so the default never
  replaces its timer.
- ComposerTimerUITests (`testATimerOnAPostFromTheComposer`, no archive build): a new post's Timer, the dialog,
  the switch on and 6 hours, Done, the post sent, and Posting › Timers listing it (`composer-timer-none`,
  `composer-timer-dialog`, `composer-timer-editor`, `composer-timer-set`, `composer-timer-posted`,
  `composer-timer-on-timers`; `composer-timer-no-free-timer` and `composer-timer-not-armed` if the demo says
  so), each `-ipad` on the iPad.
- Done is ComposerStateModel's `chooseLifespan(rule)`: touched, the rule set, and the post kept at once even
  when the rule is the one it had, as the web's reducer hands its autosave a new state either way.

SHELL, ROUND 6
- `ShellActions` (in the shell's environment): `creatingDashboard` opens the shell's
  NewDashboardDialog (the sidebar's New dashboard, the palette's), and
  `customize(id, navigator:)` is the palette's Customize this dashboard (?edit=1 in the
  address, and `customizing` bumped: RoutedPage keys the dashboard's page by it, so it is
  made again and opens customizing). `PaletteState.afterClose` runs once the palette's sheet
  has gone, for a command that opens another sheet.
- Settings › Dashboards is `DashboardsSection` (Settings/DashboardsSection.swift), over
  ShellDashboards and the dashboards' own `RenameDashboard` and `NewDashboardDialog`.
- `HandleField` is a combobox on a hardware keyboard (`.onKeyPress`, SignInSuggest's
  moveActive), as the palette and the lookup's search are; toasts are posted to VoiceOver
  as announcements.

APP (App/, Pages/, Legal/, SignIn/, Accounts/, Settings/, Platform/)
- `AppModel` builds the stores and models once per process. `ArchiveHost(did:)`
  (ArchiveProvider's role) makes one ArchiveModel per shell (`AppModel.makeArchive`, the first
  time the host is drawn, kept in its `@State`), starts it in `.task` and stops only that one
  when it goes, so each window has its own, as each web tab mounts its own provider; they share
  the account's one store handle. Pages read `@Environment(ArchiveModel.self)`. The host calls
  `ChartNotesModels.reload(did)` as the shell appears. The session's `deleteDatabase`
  (`AppModel.deleteDatabase(files:)`) sends `virga-posting:<did>` to VirgaPosting's
  `DraftMedia.deleteDatabase` (the drafts' kept pictures and videos) and every other name to
  VirgaArchive's `AnalyticsStore.deleteDatabase`. Its `resetAnalyticsStore`
  (`AppModel.resetArchiveStores`) does nothing: deleteDatabase has already forgotten and closed
  the deleted account's archive handle, and a second handle over a folder another still holds
  would write over its segments. The
  archive's handle is `AppModel.archiveHandle(for:)`: the profile's once ProfileModel's
  `did` is that account's (a view drawn right after a switch still sees the last
  profile), else the remembered row's; ArchiveHost sets `archive.handle` again when the
  fresh read arrives, as the web hook takes it on every render.
- `AppRoot` ports App.jsx's states. `onOpenURL` and `onContinueUserActivity` both try
  `openCompose` first: virga://compose?… and the universal link https://<virga>/intent/compose?…
  (the only applinks path the AASA claims; `ComposeIntent.composeLinkSearch`) open the composer
  filled in when an account is signed in with the terms accepted, and are otherwise kept with
  `rememberPendingCompose` for after the sign-in. Anything else goes to `finishReturn`, which
  passes an /oauth/return address to `completeSignIn(callbackURL:)`. It keeps Defense's scans
  only for the accounts signed in (`ScanStore.keepScansFor`), runs the composer's
  `forgetGoneAccounts()` on every change of the accounts or the open one, and makes the shell
  again when the number and date formats or the device's zone change
  (`ShellView.id("<formats>|<zone identifier>")`, App.jsx's `<Shell key={formats}>`). The zone
  is read again (`PreferencesModel.deviceZoneChanged`, after `NSTimeZone.resetSystemTimeZone()`)
  on NSSystemTimeZoneDidChange, on UIApplication.significantTimeChangeNotification and whenever
  the scene becomes active. A rebuilt shell closes a sheet open inside it (the palette, a
  dialog); the web doesn't remount on a change of zone. A legal page is keyed by its document
  (`LegalPageView(docKey:).id(document)`): Terms to Privacy starts the new page at its top and
  then goes to the address's section, as the web's navigate and LegalPage's [docKey] effect do;
  an anchor within one document still scrolls in place. `SystemWebAuthenticator` is ASWebAuthenticationSession
  with the `.https(host:path:)` callback. "Signing you in…" while `session.returning`
  (a sign-in that came back is being finished). An account the agreement model hasn't
  been told of yet (the first pass after a switch or an Add an account) is decided
  in AppRoot's `termsStatus(for:)` from its stored note, as useTermsAcceptance decides
  in the same render, so no shell or archive is made for it on the last account's answer.
  A compose link kept while signed out lives in `stores.tab` (sessionStorage), and
  `\.signInComposing` puts the front page's callout up; OpenComposerPage spends it from the
  same store.
- A sign-in called off on the system's sheet (`SignInTrip.calledOff`: code CANCELLED,
  AbortError, the flow's tripFailureNotice rule) shows no notice anywhere: the account
  menu's Reconnect, Settings, the session notices' hand-off, Sign in again and Sign in.
- The sign-in flow: VoiceOver gets the web's live regions as announcements (Looking you
  up, Found, the notices, Still here, the session notices, the agreement's failure) and
  focus where the web puts it (the way on while an account is looked up and found; the
  field as Add an account opens). The handle field is named by its label (the TextField's
  title, the placeholder its prompt) with the field's notice as its hint. On the front page
  its suggestions float over what follows it (`zIndex` at every level of the column down to
  LandingFrame's main), and on a phone the page brings the field's label to the top when
  they come up (`SignInScrolling`, a ScrollViewReader round LandingView, put on by AppRoot).
  "Continue anyway" and "Still here? Open <host>" are links in their sentences
  (`SignInInlineLink`, `virga-signin:`). "Still here?" covers only the wait for Virga's server
  to give the host's address, never the system's sheet: `SignInOptions.onAuthorizing`, called
  just before the sheet opens (and not for a trip already called off), cancels the stall, for
  every sign-in and for signUpAt. Going again cancels and awaits the trip under way;
  closing Add an account calls the trip off, but not once the sign-in has come back
  (`session.returning`): "Signing you in…" takes the page down then, and cancelling would
  cancel the account's opening reads with it. A card, the account arriving and the
  leaving title rise or fade in with `SignInArriving` (0.28 s and 0.32 s on --ease,
  `Measure.SignIn.stepIn`/`identityIn`), the card they replace going at once.
- LegalDialog's "Open as a page" is `LegalPageCover`, a full-screen cover over the dialog
  (the web's new tab), whose Back to Virga closes it; links to either document change it
  in place. The front page's foot and a legal page's are `LandingFootLayout` (wrapping,
  on first baselines, spread to the ends), their links 44 to press.
- Landing, SignInReturn, TermsGate, LegalPage/LegalDialog/LegalDocument, SignInFlowView,
  AccountMenu, AccountsSettings, SessionNotices, SettingsPage (Account, Appearance,
  Permissions, Data and sync with exports through `.fileExporter`, Dashboards, About).
- The pending-work warnings before a long session's sign-out, Sign out of all and Remove …
  from this browser read through `AppModel.pendingWork`: `PendingWorkServices.posting()`
  (VirgaPosting/Wiring.swift), scheduleService's listScheduled and timerService's listTimers
  over the account's VirgaBackend, so the dialogs say what is scheduled or on a timer (in the
  demo, the demo server's rows).
- `Platform/AppStores.swift`: UserDefaults in `<bundle>.localStorage`, DiskFileStore in
  `Application Support/Virga`, KeychainSecretStore under `<bundle>.session`; tests in
  ios/VirgaKit/Tests/VirgaUITests (run by package-test on the simulator).
- Demo mode: `-VirgaDemo YES` runs on VirgaDemo's DemoSession (the demo network in front
  of the fake server), so the first build reads Mira's whole archive. Harness flags come as
  `-VirgaDemoFlags "<query>"` in the web's address form (accounts=1, signedout,
  expired=<handle>, scope=read, defense=on, terms=ask, latency=<ms>, now=…, appview=…);
  `-VirgaDemoTerms YES` and `-VirgaDemoSignedOut YES` are terms=ask and signedout;
  Defense and its moderator are on, as in the web's harness, unless `-VirgaDefense off` or
  `-VirgaDefenseModerator off` says otherwise. The
  app's own SessionModel runs over the demo session's environment, with the archive's
  reset and delete hooks wired as on a device.

COMPOSER (Composer/)
- `ComposerHost` (ComposerContext's role) is AppRoot's, above the per-account identity, put in the
  environment by `.composerHost(_:)`, which also presents the sheet, shows the composer's toasts
  and flushes the autosave when the scene goes to the background. `host.open(intent)` (the web's
  intent JSON), `host.openLink(_:)` (virga://compose?… or https://<virga>/intent/compose?…);
  RoutedPage's `.intent` and `/posting/compose` are `OpenComposerPage`, which opens it and moves to
  /posting, as Shell.jsx's OpenComposer does. A compose link that AppRoot opens while signed in goes
  straight to `openLink`: unlike the web's OpenComposer, it neither spends a kept link nor moves to
  /posting.
- `ComposerController` holds Composer.jsx's state beside the post (ComposerStateModel holds the
  post): startFromIntent, restoreFor, changeAsDid, addFiles, detected, submitPost, startOver.
- `ComposerPublisher` (Composer/ComposerServices.swift) is publish.js's seam: `publish(state,
  target:requireAltText:onProgress:)` → `ComposerPublishResult`. The app's is `PostingPublisher`
  (VirgaPosting's Publish over `TemporaryComposerFiles`, ImageIO and the session's transport), built
  when the host makes its controller unless `ComposerHost(publisher:)` gave another;
  `UnavailablePublisher` is for previews. `ComposerLinkCards.fetchLinkCard` reads LinkCard's card as a
  ComposerCard; the library and the template editor take `LinkCard.fetchLinkCard(transport:)`.
- Drafts (Composer/ComposerController+Drafts.swift): Save as draft, an intent's `draftId`, a kept
  post's media, a posted draft deleted; a draft's media live in `DraftMedia` over `app.stores.files`.
- `TemporaryComposerFiles` (Platform/) is VirgaPosting's `ComposerFiles`: picked, pasted and fetched
  bytes as temporary files, `ref` the path. VirgaPosting has a protocol of that name, so nothing in
  VirgaUI may be called ComposerFiles. Every composer file is in one folder,
  `TemporaryComposerFiles.folder` (tmp/composer), emptied the first time it is used in each run
  (nothing kept across launches names these files); `TemporaryComposerFiles.write`, ImageIOEncoder
  and PickedMovie all write there, and `remove` deletes only files directly inside it. Where the web
  revokes a preview, the composer deletes the file (`letGo`, ComposerController+Files.swift), and only
  when `Autosave.fileRefIsHeld` says nothing on screen, kept or set aside holds it: an image removed,
  `removeVideo`, `resetAfterSend`, Start over and `forgetGoneAccounts`; the originals handed to
  `addFiles` and `addDescribedImages` go once they are prepared (a video taken stays, held by the
  state). Nothing goes on `removePost`, as the web revokes nothing there and the thread's undo can
  bring the post back. Left until the next launch: the card thumbnail picker's original, and its
  prepared copy once the card is removed or its picture replaced (EmbedCards); the card thumbnail
  a send fetches or prepares again (`LinkCard.uploadCardThumb`); the copy of a draft's kept image
  that submitSchedule reads to schedule it; a removed post's files; a render
  prepareImage refuses as over budget; the files of a gone account's kept or set-aside posts (the
  web doesn't revoke those either); the copies the Drafts, Posted and Scheduled posts pages make
  for themselves; and files earlier builds left at tmp's root.
- The phone's composer (640 and under) sends from `ComposerBar` at the top; the foot keeps the
  tools (760 and under, the medium size with 20-point pictures, on the dialog's edge), why the
  button is off (on a phone a line of its own over the rest, only when it has to be read), Save as
  draft and Schedule (`ComposerAlso`, each saying why it's off). No rule over the foot.
- The send button (`PublishButton`) is one ink pill: `PublishHalfStyle` for the main half and
  `PublishCaret` for the caret's Menu label, with a seam between; a half that can't run fades its
  words, both off dim the pill as one.
- Intents: a `templateId` (Templates › Use) is `loadTemplate` (TemplateService.load over the
  session's agent, setSource, applyTemplate; `loads["template"]`'s failure a warn callout over the
  post); `reseedToken`/`reseedIfDue()` take the seed again once a template's or an attachment's
  words are on screen. `forgetGoneAccounts()` runs from AppRoot's body on every change of the
  accounts or the open one, whether or not the sheet is up, and first in `startFromIntent`. With
  the last account gone it loads `baseState("")`, so a late video patch finds nobody to save for.
- Sending: `commitTagDraft()` (the tags field's word, `tagDraft`) first; the duplicate guard
  (`Publish.defaultDuplicateGuard`) before anything is asked; `afterPublished` runs in a task of its
  own and is awaited, so busy holds until the scheduled copy or the draft is settled, and a Cancel
  tapped while the post was written doesn't stop the draft's delete, the scheduled copy's cancel or
  finishSource's 1.5 s retry (the web's afterPublished takes no signal). `cancelPublish` does
  nothing unless the busy line offers Cancel (`busy?.cancellable`). Each send holds background time
  while it runs (`BackgroundSend`, ended in the same defer that ends busy): submitPost,
  submitSchedule, saveDraft and each video's upload, and also Drafts' Post now and Schedule and
  Scheduled posts' Post now. The default reply settings go through the controller's
  `BlueskyGatesCache` (`resolveGatesFor(did)`: a good read kept 5 minutes, a failed one 30 seconds,
  per account) for both the Replies row (`resolveGates`) and the post that goes out
  (`ensureGates`), so a post goes out with the gates the row showed. The autosave's debounced write
  runs on the main actor (`Autosaver.mainActorTimers()`), so it can't land between
  resetAfterSend's `cancel()` and `clearKept`, or during a set-aside. ComposerBody's `onChange` on
  `videoUploadKey` starts any idle video's upload while the sheet is up.
- Picked images count as processing as soon as they are chosen (PostTools bumps
  `controller.processing` by their number, and takes it off before `addFiles` bumps for itself), so
  their placeholder tiles and Preparing… show while they load. A pick that can't be read adds "An
  image couldn’t be added." or "The video couldn’t be added." to the media note, after addFiles' own
  notes (the video's words are iOS-only: the web's picker has no load failure).
- Focus and the caret: `focusPostId` takes the first post 40 ms after the sheet appears or a
  state loads, on a wide screen only (`controller.narrow`, set by the sheet); splits and their undo
  refocus off a phone; `refocusAfterAdviser()`. `editingPostId` is the post with the caret (its
  line in the focus ring's colour), `selections[postId]` each editor's last selection
  (`selectionOf`, where the library inserts). The error is scrolled into view
  (`ComposerStatus.errorAnchor`).
- Read out: `ComposerAnnounce.post` and `.composerAnnounces(text)` for what the web marks
  role="status" or aria-live; role="alert" callouts pass `Callout(alert:)`. `ComposerCalloutLine`
  is a callout's words with its buttons at the right.
- Layouts: `ComposerImageGridLayout` (the image grid by count), `ComposerAspectBox` (a video at its
  own shape up to 320), `ComposerVideoPreview` (one AVPlayer per file). Posts shown small are
  `PostPreviewCard(compact: true)`, and the library's detail draws the full card, as
  LibraryPanel.jsx's `<PostPreview view />` does. `.suggestPop()`/`.suggestRow()`
  are `.suggest-pop` and `.suggest-item`, for the mention, "/" and language lists.
- Posting as: one line; its list a popover (`presentationCompactAdaptation(.popover)`), closed by a
  press outside it. ComposerUITests closes it on the system's dismiss region
  (`PopoverDismissRegion`, pressed low down, clear of the popover), else on `post-as` again, and
  waits for `post-as-list` to go.
- The wide row's ⋯ (`option-more`) is an overlay on the row from the rule's foot, offset
  (7, 11) as `.composer-more`'s `right: -7px; top: 11px` are; the tags field under the row keeps
  the row's 40 of room at the right. The send button's seam is the caret's own left edge, inside
  its 40.
- Deliberate differences: the editor's selection is ink, as its caret is (a text view's selection
  follows its tint; the web's is the accent at 28%); Posting as's popover has the system's arrow; a
  phone's Save as draft and Schedule are the kit's 40, pressed through 44.

LIBRARY (Library/)
- `LibraryPanel(lib:mode:state:postIndex:insertion:initialShelf:focusTemplate:verb:transport:onNewTemplate:onUse:)`
  over VirgaPosting's `LibraryModel`; `onUse(item, answers)` may throw, and its error shows under the
  button until the chosen row (`selectedId`) or the item shown (`shown?.id`: a shelf or a search can
  put another first in the wide layout) changes, as the web's effect on [selectedId, activeId]
  clears it. `LibraryDialog` is the composer's (a `ComposerDialog.library(LibraryRequest)`; the plan
  goes back through `ComposerController.applyPlan`), `LibraryScreen` the /posting/library page (Use
  in a new post opens the composer with `attach: plan.json`). VirgaPosting has a `LibraryPage` (a
  shelf's read), hence the page's name.
- `LibraryWiring.environment(app)` builds `LibraryEnvironment` (the session's transport, the
  account's archive, LinkCard's fetcher, the usage store). Each dialog and page makes its own
  `LibraryModel` and its own `TemplatesModel` (the model's `stop()` stops its templates model).
- The template editor and questions read through `LibrarySources` and preview with
  `Library.previewFor`; `TemplateAttachSummary` lives in Templates/TemplateQuestions.swift.
- The panel's columns come from its own width (`LibraryColumns`, measured by a GeometryReader: the
  web's `container: lib`); narrow (760 and under, the detail in the list's place) is the window's.
  In `.dialog` mode it fills its sheet (LibraryDialog: the kit's `DialogHead`, then the panel, no
  outer ScrollView): the list and the detail each scroll by themselves, and on a phone the use
  button is held at the sheet's foot (`\.libraryPinsActions` on the detail's ScrollView, read by
  `LibraryPinnedActions`, which TemplateQuestions' actions take too). In `.page` mode the page
  scrolls and the detail is held 24 under its top beside the list (`LibraryStickyTop`, over the
  `.scrollView` coordinate space). The shelves are `LibraryShelfRow` (`.lib-shelf`: a ScrollRow of
  words with their counts), the search the panel's own (its clear button, Escape, the dialog's
  autofocus), a shelf's or a search's failure `LibraryStatus`.
- The panel's body is a VStack round its narrow or wide layout, not a Group: a Group gives its
  modifiers to the view inside it, so its tasks and `onChange(initial:)` would start again at each
  switch between the list and the chosen item on a phone (the asked-for template chosen again over
  Back to the list). For the same reason a view whose `.task` reads what it shows (AltTextPreview)
  is a ZStack: a Group with nothing in it yet runs nothing.
- A post not read yet has `view: .null`: the detail tests `view.isTruthy` (bones, then
  `PostPreviewCard(view:)` in full, or why it couldn't be read), and hydrates unless it has a truthy
  view and a cid. A read called off by choosing another row isn't a failure.
- The dialog puts its plan in from its `.onDisappear`, once its sheet has gone: what applyPlan asks
  (Replace the link card?, Replace what this post quotes?) is a sheet of the composer's, which
  can't come up while the library's is still going down. A pick read after the library was closed
  (swiped down or ✕ while it says Adding…) still goes into the post it was chosen for:
  `LibraryDialogPick` (by reference, so the use's closure still holds it) keeps the plan and
  whether the sheet is up, and once the sheet has gone the closure applies the plan itself, as the
  web's onPick does. Closing after a pick closes only the library (`onClose` only while
  `controller.dialog == .library(request)`), so a dialog opened since stays up; if the plan then
  asks something, the question comes once that dialog closes (not yet seen on a device).
- Identifiers: `library-dialog`, `library-panel`, `library-search`, `library-list`, `library-row`,
  `library-empty`, `library-detail`, `library-use`, `library-new-template`, `template-questions`,
  `template-question-<n>`, `template-questions-use`, `template-preview`; the dialog's Close is
  DialogHead's `dialog-close`.

LIVE SKY (Sky/, and VirgaCore/Hillside/ for everything that isn't drawing)
- The pure parts are VirgaCore's, held to the web's own code by hillside.scene, hillside.clouds,
  hillside.land and hillside.style: `HillsideScene` (the palettes, phaseOf, TURN, the sky's dome),
  `HillsideSceneState` (createHillside's closure: `resize(width:height:crest:)`, `setPhase`,
  `setActive`, `intro()`, `setShown`, `pointerMoved`, and `frame(now:)` for each display frame while
  `framesQueued`; a picture is due whenever `drawCount` moves), `HillsideCloudBatch` (the clouds'
  drift and their puffs staged back to front), `HillsideClouds` (the kinds, generators, makeCloud,
  layout, makeNoise), `HillsideLand`, `HillsideStyle` (hillside.css's numbers, and the flat picture
  laid out as a browser lays a gradient out), `SkyTaps` (useSkyTaps' count and toasts). scene.js and
  clouds.js keep these to themselves, so ios/parity/cases/_moduleScope.js reads a module's top-level
  declarations from its source with acorn and runs them in a vm context, and hillside.scene runs
  createHillside itself over a recording stand-in for WebGL and requestAnimationFrame.
- The shaders are `HillsideShaders.source` (VirgaCore, MSL, compiled at run time: the package has
  no .metal file), with `HillsideUniforms` and `HillsideBandUniforms` packing the structs it
  declares (a Linux test holds the packing to the source). VirgaUITests' HillsideMetalTests compiles
  them on the simulator, makes every pipeline and reads back a drawn band and hill.
- `HillsideGPU` is made once, off the main thread (`HillsideGPULoader`); without a device, or when
  the shaders don't compile, the reason is logged after "[Virga hillside]" and the flat picture
  stays. `HillsideDriver` is Hillside.jsx's effect over the state, on a CADisplayLink at 30 frames a
  second (60 while the view moves), paused with no frame queued, no canvas in a window, or no active
  scene. `HillsideCanvas` (a UIViewRepresentable over an MTKView that draws only when told) and
  `HillsideCanvasRenderer` (`.hill`: sky, land and clouds into the drawable; `.band`: sky and clouds
  into a texture, then laid on the wash) draw it.
- Views: `LiveSky(inView:)` is LiveSky.jsx; PageSky draws it over the wash while `prefs.liveSky`
  (every page of the shell; on the iPad once, behind the sidebar and the page), and the front page
  through `LandingFrame(liveSky:)` and `skyBackground(live:)`. Every page's band shares one scene
  (`LiveSkyDrivers`), so the clouds drift on across pages. `HillsideView(phase:day:active:intro:depth:
  soft:crest:blur:)` is Hillside.jsx, the whole hill with its intro and soft focus; no page draws it,
  as no web page does now. `SkyTapsButton { Brand() }` is the mark in the app bar, the sidebar (open
  and folded) and the front page (`brand`); Settings › Appearance ends with "Live sky" (`live-sky`).
- Memory while it is on: the dome (about 15 KB), the noise (64 KB and its mipmaps), a buffer of
  puffs per canvas (183 KB; one picture in flight at most), and the band's scene texture and two
  drawables at 1.5 pixels a point; the land's mesh (about 2.2 MB) only once a hill is drawn. A
  picture that comes while the last is still on the GPU is skipped, so the pace check, which times
  the display link as the web's times requestAnimationFrame, doesn't see a GPU that falls behind.
- Demo mode: `-VirgaDemoSky <sky>` and `-VirgaDemoLiveSky YES` start it with those preferences
  stored (the front page has no Settings to pick night from).
- Deliberate differences: the pointer's lean comes from a hovering pointer (an iPad's trackpad or
  mouse), never a finger or a pencil; a scene starts once the GPU is ready, where Hillside.jsx waits
  for the page to be idle when it starts covered; WebGL's context loss has no Metal counterpart; on a
  phone's front page of a part the strip over the status bar is clear at rest over the live sky and
  comes in as the page scrolls (`LiveSky.stripFade`), as the web has no status bar.

## The screenshot review against the web harness (2026-11-22)

CI run 77's screenshots (121 on the iPhone, 135 on the iPad) were set beside the web harness at
the same sizes (440x956 and 1032x1376), area by area; 51 differences held up under a second
reader, and the fixes went in on the visual-fix merges after cc3083d. What changed:

- Sheets on a wider window (iOS 18) are sized as the web's modals: `.dialogSheetSizing` drops
  the detents and fits the sheet to its content at the dialog's width (520; 600 for How signing
  in works; 640 for the timer dialog, the adviser, alt text and the template editor; the
  library 980 by 720), held inside the window (`100vw - 32`, `100svh - 48`). The composer is 640
  wide and as tall as its post. Its toasts are the window's one stack beside it, and under the
  sheet where the two meet, as the web's `.toasts` are under its modal `<dialog>` (the top layer)
  and its scrim; a stack above the sheet would cover its foot. On a phone the sheet draws its
  own over the post area. Pressing Posting as ends the post's editing first, so
  the list stays under the byline. On iOS 17 a wider window keeps the detents.
- The phone's back link reports its whole width to the navigation bar (it was cut to one
  letter during a push); the tab bar's gaps are the web's 4 with the space between; the front
  page's title is set a line every 1.02em (LandingTitleLines); the front page holds the sky
  over the status bar, and its foot sits at the screen's foot.
- Posting: menu hints in --muted; Posted's search beside the filter; template rows, the weekly
  schedule's add row and the row actions at the web's measures; the six-dot grip drawn
  (`GripVerticalGlyph`: no SF Symbol has it); MessageSquareLock is `lock.square`.
- The composer: the "@" and "/" lists bring themselves into view (`ComposerReveals`); the
  language suggestions float over Adult content in the composer's dialog (not yet in Settings,
  whose row hairline is drawn over its content); the queue line's time is semibold.
- Defense: a chart's and a held table's columns are at least their words' width and share
  the rest (`TableGridWidth`), so the head lines up with the rows; the scan's actions beside
  Who engaged in full; the moderator's link underlined; the radar's legend within the radar.
- Dashboards, reports and tools: the dashboard's gutter narrows below 1180 as the web's
  `clamp(24px, 4cqi, …)`; a card 400 wide or less drops the way to your history; a face's letter
  comes from the display name, else the handle (`Avatar.named`); bar labels fill before the bar
  grows; a phone card's tools sit over the title's line; a tool's statement balances its lines
  (`BalancedLines`); the lookup's account head wraps as `.lookup-person-top` does.

Still open from the review: the demo's people show the plain letter disc where the harness
draws its SVG initials (AsyncImage can't decode a `data:image/svg+xml` avatar; real avatars are
JPEGs, so only the demo shows it); a tablet card head's `margin-top: -5px` on its tools; wrapped
page titles under 1.22 line height (Text's lineSpacing can't go below the face's own); Posted's
menu hints, whose screenshot the test now takes once the menu has opened. The fixes compiled
and passed the UI tests on both devices in CI run 82 (628657a).

## CI's screenshots against each other (2026-11-23)

Runs 82 (628657a) and 84 (69d274e) were compared pair by pair over every screen that changed
(56 on the iPhone, 36 on the iPad), to see whether the final review's fixes moved anything they
shouldn't have. None did. Of 20 suspect pairs, each checked again against the code, 17 differed
only by when the test took its shot (a toast still fading in, a menu still opening, a scroll
still coasting, a press that landed while the page moved). The follower chart's shot lost its
top under the bar because SeriesChart became one VoiceOver element, so the test's scroll
stopped once its foot showed. The UI tests now wait for the state each shot is meant to show.

Two pairs showed a letter lost while the test typed into a post editor ("@lab.example.or",
"garden-nots"), on both runs and different devices, a different letter each time. Whether
the simulator or the editor drops it isn't known. HighlightedTextView used to rewrite every
attribute and set the selection again on each of several redraws a keystroke, and could put
the post's text back over a letter UIKit was still inserting; it now changes the field only
where something changed and leaves it alone mid-edit (`Coordinator.drawn`, `synced`,
`editing`). ComposerUITests prints `VIRGA-TYPED-MISMATCH` lines in CI's log when a letter
still goes missing, without failing, so later runs can say whether that helped.

Run 87, the first after that change, lost one letter on the iPad ("#grdening") and none on
the iPhone. To see where such a letter goes, `-VirgaTypingProbe YES` (TypingProbe.swift, on
for every ComposerUITests launch) records in the app what reached each post editor (its key
presses, insertText, the insertions its delegate approved, the gaps between keys) and what
the app did to it meanwhile (an updateUIView while UIKit was mid-edit, the post's text put
back, a selection set, the "@" list coming and going, the field moving in the window, growing
a line at a wrap, or scrolling with the composer). The tests read the record from a hidden
element ("typing-probe") and print it after a mismatch (`VIRGA-TYPED-TRACE`).
`-VirgaTypingBench YES` adds testTypingBench's two other fields, a bare UITextView above the
composer's scroll and the second post without the typeahead, each emptied as it loses focus.
testTypingBench types the first post's words six times into each of the three and prints one
`VIRGA-TYPED-COUNT` line per field. Neither switch changes anything for someone using the
app, and neither fails a test. The bench is for one run; the probe is cheap enough to keep.

Run 88 (fb3e9ea) answered it. On the iPhone the composer lost a letter in 2 of the bench's 6
typings and once in testTheComposer; the post without the typeahead and the bare text view lost
none in 6 each, and the iPad none at all. All three losses had the same record: every key
reached the field and its delegate, and then an update put the post's text back while the
field was one key ahead of the text the update had through its binding ("R63>62", not mid-edit,
always while the "@" list was up). Every key reaches the post at once in textViewDidChange, so
the post can't have been behind (inferred; the probe measured the field against the binding).
updateUIView now decides from the post itself (`HighlightedTextView.current`), shows the
highlights only for the text they were found for (`segmentsText`), and keeps the binding for
handing text on; the probe
notes a "B" event whenever the two disagree, so the next run can show whether a stale binding
was the reason. Why the "@" list makes it likelier isn't shown; it adds updates while typing.

Run 85 failed once on the iPhone, Defense's palette step: swiping back up until Search showed
left it 51 points short of the top, under the status bar, where taps don't reach it. The seven
palette steps now swipe until a swipe no longer moves Search.

## Known gaps and deliberate differences

- Left for later steps: dragging cards; "Keep it when space runs low" (iOS has nothing to ask).
- Files dropped on the composer (ComposerDrop.swift: Composer.jsx's dropProps and dropFiles,
  `.composer-drop`) go to the post being written (the active one, else the first) through
  addFiles with allowVideo false: pictures are added, and a video, sound or PDF is left out with
  the web's note. Nothing is taken while it is busy. While a drag of files is over the composer,
  "Drop images to add them to the post" lies over the post area in a dashed accent line, the head
  or bar and the foot left clear. Every picture's load starts inside the drop's action, as the
  dropped payload is readable only until it returns. Dragged text and links are the post's text
  view's. No UI test drags one in: XCUITest can't bring a drag from another app, so it is checked
  by CI's compile and by hand.
- Copy is the web's word for word, including words that only fit a browser ("This
  browser's region", "Forget X on this browser", "Saving the repo to this browser"). Worth
  raising on the web side rather than changing on one side.
- New copy the web has no counterpart for: "This page isn't in the iOS app yet.", "This
  section isn't in the iOS app yet." and "This card isn't in the iOS app yet."; the share dialog's toasts after
  Save the picture ("Saved to Photos." and "The picture couldn’t be saved.") and Photos'
  permission line ("Virga saves a chart's picture to your photos when you ask it to."),
  since the web downloads the file instead.
- Hover is the pointer's on an iPad: a lookup suggestion or a handle suggestion under it is
  shaded or marked; underlines on hover are left to the system's pointer effect. The
  Interaction lookup's and the handle field's suggestions don't scroll (at most eight and
  five rows).
- Every window shares one session, so the web's "another tab switched accounts" notice
  has no case; TermsGate's Reload can't fetch newer documents (they are bundled).
- Post this chart's Write a post with it opens the composer with the picture and its
  description, once the share sheet has gone (one sheet at a time). New post (the sidebar's,
  the tab bar's round button) opens the composer in place, over the page it was pressed on, as
  Shell.jsx's does; VirgaUITests' `testNewPostOpensTheComposer` checks it opens and that Close
  shuts it. The palette's New post opens it the same way, once the palette's sheet has gone.
  N on a hardware keyboard opens a new post too (Shell/NewPostShortcut.swift, useNewPostShortcut):
  a hidden shortcut with no modifier, off while the composer or the palette is open, that reads
  where the key is going as it comes in: nothing when a sheet or dialog is presented over the
  window (the web's `dialog[open]`), and the letter typed into the field when a field has the caret
  (UIKit should give a field the bare letter first; this is the guard if it doesn't).
  ShortcutUITests checks both on the iPad: N on a page opens the composer, N in the Library's
  search is typed there and opens nothing.
- Customize is the web's phone path at every width (each card a line, opened by its name to its
  size, Settings and Remove); the wide screen's grid with the chosen card's floating tools and
  the library beside it isn't drawn. VirgaUITests opens the first line (`arrange-open-<type>`)
  before it presses `card-settings-<type>`.
- The sidebar's fold button is the system's one sidebar glyph, open and folded, where the
  web draws PanelLeftClose and PanelLeftOpen.
