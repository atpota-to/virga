# ui (VirgaUI): porting notes

What the agent that built the SwiftUI layer's foundation handed on, in four rounds
(November 2026), each compiled and run by CI's `iOS app` job on an iPhone and an iPad.
The code and ios/parity/modules/ui-*.json are the truth; read this for orientation, the
API a new screen uses, and what was left out.

Status: the foundation is built and passes CI (compile, the app's unit tests, the UI tests
on an iPhone and an iPad). Not yet audited against the web's components as a whole. Round 5
added the charts, the dashboards and the first reports (below); round 6 the tools, Post this
chart (the share dialog) and Defense, then New dashboard, Customize from the palette,
Settings › Dashboards and the handle field's arrows; posting is still to come.

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

The UI test classes, each one built-archive test per device: VirgaUITests (the shell, the
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
  red at night; a button keeps its words, `fixedSize`); `.linkAction` (its own 1-point line
  at a 3-point offset, 2 while open or pressed; a Label's title is underlined, not its icon);
  `MoreLink(_, to:)`. The kit's sizes are `KitSize`.
- `Segmented(label:options:selection:size:)` (scrolls with faded edges, the pressed key
  brought clear of the fade only when it is under it, keys held at their bold width; an
  option's web `title` is `SegmentedOption(hint:)`, and `minWidth:` a key's least width, as a
  kind filter's glyph-only keys have, 32 at 760 and under), `ChipStyle`, `TokenView`/`TokenRow`,
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
  centred, on two lines).
- Menus: `MoreMenu`/`VirgaMenu` over `[MenuEntry]` (`.item(MenuItem(...))`, `.separator`),
  a native Menu; each item's icon comes coloured (--ink-2, or the system red of a destructive
  item's words), since a native menu tints a plain image with the window's accent.
- `.virgaDialog(isPresented:title:size:stackActions:autofocus:) { } actions: { }` (a sheet;
  `stackActions` puts a phone's buttons one under the other, the last given first;
  `autofocus: true` focuses, when it opens, the field marked `.dialogAutofocus()`, the web's
  `[data-autofocus]`: the focus state is the dialog's, inside the sheet, since a caller's
  `@FocusState` outside the sheet doesn't reach a field inside it), `DialogFrame` (the same),
  `ChoiceRow(_, description:, isOn:, kind: .radio | .check)` (rows share one hairline),
  `InfoTip` (laid out 20 × 16, pressed through 44), `FollowerCountTip`, `Callout(tone:)` (a failure
  of words alone, `Callout(tone: .danger, words)`, is role="alert": read out as it appears and
  as its words change; built round its own content it takes `alert:` words, or leaves it to the caller),
  `EmptyState` (16 under a flush section's rule), `NoteText`, `ProgressLine(value:)`,
  `Disclosure`.
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
  field's blur), `PageColumn`, `VirgaSection(title:sub:trailing:flush:caption:)` (a
  small Segmented as `trailing` says so, and goes under the line on a phone), `SectionFoot(count:
  letOut:)` (`letOut:` the size of a ghost button that starts it), `VirgaRow(roomy:time:) { }
  actions: { }`, `RowWords`.
- Helpers: `FlowLayout`, `ScrollRow` (`.scrollRowFocus(_:)` marks the item to bring into
  view), `BesideOrUnder` (a wrapping flex row of two), `.touchReach`, `.touchTarget`,
  `.virgaFocusOutline` (put on the Button or Menu itself, or inside a ButtonStyle's body: it
  binds its own FocusState and also reads `isFocused`).
- Toasts: `ToastCenter` and `ToastStack`. The app has one center, `ComposerHost.toasts`
  (App.jsx's ToastProvider, above the account): `.composerHost(_:)` draws it and ShellView puts
  it in the shell's environment, so every page's toasts and the composer's share one column, at
  most three, and outlive a switch of account.

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
  sidebar, ⌘K; recent commands under `virga:palette-recent`). A sync that fails is read out
  once by ShellView, in the words of the page's role="alert" line.
- Settings rows: `SettingsRow(label:hint:block:compactControl:kind:)`, where `kind`
  (`SettingsControlKind`: `.button`, `.segmented`, `.toggle`, `.state`, `.prose`; a switch
  by default where `compactControl` is set, else a button) says how far the control is
  drawn up to centre it on the name's first line, as settings.css does on a touch screen.
  A select is `SettingsSelect` (the kit's VirgaSelect over a preference), laid out by
  `SettingsSelects`; the sky's and the accent's grids are `ChoiceGrid` (auto-fill columns
  from the grid's own width), radio groups on a hardware keyboard.

CHARTS (Charts/), in Swift Charts over bucket indices
- `SeriesChart(series: [ChartPoint], seriesLabel:, secondary: ChartSecondary?, stacked:, trend:,
  mode: .bars|.line, unit:, zeroBase:, ghost: ChartGhost?, format:, marks: [SeriesMark]?, height:,
  accessibilityLabel:)`; `ChartPoint.of(...)` takes SeriesPoint, TrendPoint or RatePoint arrays.
  A press is the hover (`chartXSelection`), with the readout on its own ground.
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
  in a dialog), the period picker; `CardGrid` (twelve columns, dashboards.css's 860/620 rules);
  `WidgetBody` draws the ported cards (four figures, six charts, Best time); the rest show their
  title and `Unported.card` (posting cards: `Unported.postingCard`).
- `ReportsIndex`, `ReportPage(report:)`: every report (Followers, Posts, Engagement, Content,
  Blocks, People, Atmosphere), with `PersonRow`, `PersonList` (measures a list for its rows' meta
  line) and `PostRowView` (Reports/People.swift); `ChartNotes` and `ChartNotesModels.marks` (one
  AnnotationsModel per account) put the notes and the follower milestones on the charts; every
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
- In the demo: `-VirgaDefense on` (and `-VirgaDefenseModerator on`) turn the build's flags on
  (`AppModel.demoFlags`), and `-VirgaDemoFlags "defense=on"` (the scan) or `"defense=lists"`
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
  full-height sheet over `DialogFrame` whose foot holds the prompts. Its reads (recent posts, a
  quote's view, a pasted link) are `TemplateEditorSources`, written over PublicAppView until
  library/sources.js is ported; a web page's link card waits for linkCard.js (`linkCard`).
- `TemplateQuestions(template:context:…onDone:)`, `ChoiceGroup` and `TemplatePreviewView` are
  for the composer's library: it passes `preview:` from previewFor once library/model.js is
  ported; until then `LibraryPreview.forTemplate` works out a template on its own.
- Posting/PostingParts.swift: `PostingHeader.model(key)`, `RowSkeleton`, `LoadError`,
  `.postingConfirm(isPresented:title:onConfirm:message:)` (hubParts' ConfirmDialog) and
  `PostingWords.countPhrase`. Use opens the composer through `ComposerHost`.
- Settings › Posting is `PostingSettingsSection` over `PostingSettingsModel`, with the composer's
  `LanguagePicker` and `GatesEditor`; `ScheduleWords` holds scheduleModel.js's week sentences and
  `TimezonePicker` scheduleParts' TimezoneSelect until the scheduling pages are ported. The
  Post adviser's card is `AdviserSettingsCard` when the account can use the server (else
  `NeedsBackendNotice`), and the Default timer's editor is `LifespanRuleEditor` (no exact time,
  no toggle of its own; the switch above it, `default-timer-on`, keeps `enabled`).
- `Measure.Templates` (Templates/TemplateMeasures.swift) names library.css's and hub.css's measures.
- PostingUITests (`testTemplatesAndPostingSettings`, no archive build): `posting-templates`,
  `template-editor`, `template-editor-questions`, `settings-posting`, `settings-posting-timer`.

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
- `.adviserStyleDialog(isPresented:did:model:)` is StyleDialog.jsx (`style-dialog`, `style-read`,
  `style-summary`, `style-keep`); `AdviserSettingsCard(did:model:)` AdviserSettings.jsx
  (`posting-adviser`, `adviser-enabled`, `adviser-learn-style`), saving `["adviser": json]`
  through PostingSettingsModel.
- `AltTextDialog(image:requester:did:context:store:onSave:onClose:)` is AltTextDialog.jsx with its
  describing and revising (`alt-dialog`, `alt-describe`, `alt-revise`; the writer's field is the
  composer's `describe-text` and `describe-save`). The composer shows it for an image when the
  account can use the server, and the plain DescribeDialog otherwise.
- In the composer (marked `ADVISER` in ComposerController, +Actions, ComposerSheet and
  ComposerOptions): `submitPost(skipAdviser:)` runs `adviserGate` first (`check(s, mode: gate)`,
  the busy line in the status, then "Getting it ready"; Save as draft from the sheet saves the
  draft, Publish anyway goes on); Check this post in the tools (`option-adviser`, with its usage
  line) is `askAdviser()`; while a read runs the post is held still (`adviserReading` disables
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
- `AppModel` builds the stores and models once per process; `AppModel.archive(for:)` makes
  one ArchiveModel per signed-in account, and `ArchiveHost` (ArchiveProvider's role)
  starts and stops it; pages read `@Environment(ArchiveModel.self)`. The session's
  `resetAnalyticsStore` and `deleteDatabase` go to VirgaArchive's AnalyticsStore. The
  archive's handle is `AppModel.archiveHandle(for:)`: the profile's once ProfileModel's
  `did` is that account's (a view drawn right after a switch still sees the last
  profile), else the remembered row's; ArchiveHost sets `archive.handle` again when the
  fresh read arrives, as the web hook takes it on every render.
- `AppRoot` ports App.jsx's states; `onOpenURL` and universal links go to
  `completeSignIn(callbackURL:)`. `SystemWebAuthenticator` is ASWebAuthenticationSession
  with the `.https(host:path:)` callback. "Signing you in…" while `session.returning`
  (a sign-in that came back is being finished). An account the agreement model hasn't
  been told of yet (the first pass after a switch or an Add an account) is decided
  in AppRoot's `termsStatus(for:)` from its stored note, as useTermsAcceptance decides
  in the same render, so no shell or archive is made for it on the last account's answer.
  A compose link kept while signed out lives in `stores.tab` (sessionStorage), and
  `\.signInComposing` puts the front page's callout up.
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
  (`SignInInlineLink`, `virga-signin:`). Going again cancels and awaits the trip under way;
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
- `Platform/AppStores.swift`: UserDefaults in `<bundle>.localStorage`, DiskFileStore in
  `Application Support/Virga`, KeychainSecretStore under `<bundle>.session`; tests in
  ios/VirgaKit/Tests/VirgaUITests (run by package-test on the simulator).
- Demo mode: `-VirgaDemo YES` runs on VirgaDemo's DemoSession (the demo network in front
  of the fake server), so the first build reads Mira's whole archive. Harness flags come as
  `-VirgaDemoFlags "<query>"` in the web's address form (accounts=1, signedout,
  expired=<handle>, scope=read, defense=on, terms=ask, latency=<ms>, now=…, appview=…);
  `-VirgaDemoTerms YES` and `-VirgaDemoSignedOut YES` are terms=ask and signedout;
  `-VirgaDefense on` and `-VirgaDefenseModerator on` turn Defense's build flags on. The
  app's own SessionModel runs over the demo session's environment, with the archive's
  reset and delete hooks wired as on a device.

COMPOSER (Composer/)
- `ComposerHost` (ComposerContext's role) is AppRoot's, above the per-account identity, put in the
  environment by `.composerHost(_:)`, which also presents the sheet, shows the composer's toasts
  and flushes the autosave when the scene goes to the background. `host.open(intent)` (the web's
  intent JSON), `host.openLink(virga://compose?…)`; RoutedPage's `.intent` and `/posting/compose`
  are `OpenComposerPage`, which opens it and moves to /posting, as Shell.jsx's OpenComposer does.
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
  VirgaUI may be called ComposerFiles.
- The phone's composer (640 and under) sends from `ComposerBar` at the top; the foot keeps the
  tools (760 and under), why the button is off, Save as draft and Schedule.

LIBRARY (Library/)
- `LibraryPanel(lib:mode:state:postIndex:insertion:initialShelf:focusTemplate:verb:transport:onNewTemplate:onUse:)`
  over VirgaPosting's `LibraryModel`; `onUse(item, answers)` may throw, and its error shows under the
  button. `LibraryDialog` is the composer's (a `ComposerDialog.library(LibraryRequest)`; the plan
  goes back through `ComposerController.applyPlan`), `LibraryScreen` the /posting/library page (Use
  in a new post opens the composer with `attach: plan.json`). VirgaPosting has a `LibraryPage` (a
  shelf's read), hence the page's name.
- `LibraryWiring.environment(app)` builds `LibraryEnvironment` (the session's transport, the
  account's archive, the link-card stand-in, the usage store). Each dialog and page makes its own
  `LibraryModel` and its own `TemplatesModel` (the model's `stop()` stops its templates model).
- The template editor and questions read through `LibrarySources` and preview with
  `Library.previewFor`; `TemplateAttachSummary` lives in Templates/TemplateQuestions.swift.

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

## Known gaps and deliberate differences

- Left for later steps: dragging cards; the posting cards' reads (they wait for the posting
  pages: scheduleService.js and hubModel.js); posting (the composer, its pages, Settings ›
  Posting and the pending-work warnings before a sign-out, which wait for VirgaPosting's
  services); "Keep it when space runs low" (iOS has nothing to ask).
- Copy is the web's word for word, including words that only fit a browser ("This
  browser's region", "Forget X on this browser", "Saving the repo to this browser"). Worth
  raising on the web side rather than changing on one side.
- New copy the web has no counterpart for: "This page isn't in the iOS app yet.", "This
  section isn't in the iOS app yet.", "This card isn't in the iOS app yet." and "This card
  needs the posting pages, which aren’t in the iOS app yet."; the share dialog's toasts after
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
  shuts it. The palette's New post still goes through /posting/compose (OpenComposerPage opens
  the composer and moves to /posting), and the n shortcut isn't there yet.
- Customize is the web's phone path at every width (each card a line, opened by its name to its
  size, Settings and Remove); the wide screen's grid with the chosen card's floating tools and
  the library beside it isn't drawn. VirgaUITests opens the first line (`arrange-open-<type>`)
  before it presses `card-settings-<type>`.
- The sidebar's fold button is the system's one sidebar glyph, open and folded, where the
  web draws PanelLeftClose and PanelLeftOpen.
