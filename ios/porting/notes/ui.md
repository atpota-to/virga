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
  tracking:)`, `theme.measure`, `theme.characters(n)`. Instrument Sans is bundled
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
  red at night); `.linkAction`; `MoreLink(_, to:)`. The kit's sizes are `KitSize`.
- `Segmented(label:options:selection:size:)` (scrolls with faded edges, keys held at their
  bold width), `ChipStyle`, `TokenView`/`TokenRow`, `Badge`, `MetaLine`/`MetaPiece`,
  `StateDot`, `Avatar`, `AccessLine`.
- `.toggleStyle(.virgaSwitch)` draws the capsule and its knob and no words, as the web's
  `.switch` (its label is VoiceOver's name for it, the web's aria-label; the row beside it
  says what it is, as `SettingsSwitch`'s and the timer editor's rows do: a ToggleStyle
  can't see `.labelsHidden()`, so it once drew its label beside it, "Require alt text"
  twice); `.virgaCheck` draws its words beside the box. `.virgaField(invalid:size:)`,
  `.virgaTextArea()`, `FieldStack`, `FieldHint(_, isOver:)`, `SearchField`.
- Menus: `MoreMenu`/`VirgaMenu` over `[MenuEntry]` (`.item(MenuItem(...))`, `.separator`),
  a native Menu.
- `.virgaDialog(isPresented:title:size:) { } actions: { }` (a sheet), `InfoTip`,
  `FollowerCountTip`, `Callout(tone:)`, `EmptyState`, `NoteText`, `ProgressLine(value:)`,
  `Disclosure`.
- Data: `FiguresView([FigureItem])`, `DeltaView(pct:)` (ChartFormat.deltaText),
  `DataTable(columns:rows:selected:)`.
- Page structure: `PageHeader(PageHeaderModel(title:sub:access:crumbs:), titleTools:,
  actions:, extra:)`, `VirgaPage`, `PageColumn`, `VirgaSection(title:sub:trailing:flush:
  caption:)`, `SectionFoot`, `VirgaRow(roomy:time:) { } actions: { }`, `RowWords`.
- Helpers: `FlowLayout`, `ScrollRow`, `.touchReach`, `.touchTarget`, `.virgaFocusOutline`.
- Toasts: `ToastCenter` (in the shell's environment) and `ToastStack`.

SHELL (Shell/)
- From 900 wide: Virga's own layout, an HStack of the sidebar (272, or the 72 rail when
  folded; no ground, on the sky) and the page, held to `--shell-max` and centred; no
  NavigationSplitView (iOS 26 gives its sidebar a floating panel). Below 900: a
  NavigationStack, the app bar drawn in the page's content on a top-level page
  (`AppBarRow`, the navigation bar hidden), the system's back button on inner pages, and
  Virga's own TabBar in `.safeAreaInset`.
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
  sidebar, ⌘K; recent commands under `virga:palette-recent`).

CHARTS (Charts/), in Swift Charts over bucket indices
- `SeriesChart(series: [ChartPoint], seriesLabel:, secondary: ChartSecondary?, stacked:, trend:,
  mode: .bars|.line, unit:, zeroBase:, ghost: ChartGhost?, format:, marks: [SeriesMark]?, height:,
  accessibilityLabel:)`; `ChartPoint.of(...)` takes SeriesPoint, TrendPoint or RatePoint arrays.
  A press is the hover (`chartXSelection`), with the readout on its own ground.
- `ChartTable(series:secondary:trend:unit:valueHead:secondaryHead:format:) { actions }` and
  `ShowAsTable`: the line under every chart and its table. `BarList(rows: [BarListRow])`,
  `Heatmap(rows:columns:summary:)`, `Sparkline(values:)`.

DASHBOARDS AND REPORTS (Dashboards/, Reports/)
- `ShellDashboards` is DashboardsContext's provider now: every action over Layouts, written back
  under `virga:dashboards:<did>` at once.
- `DashboardPage(dashboard:)`: header with ⋯, Customize (move up/down, size, Remove, the library
  in a dialog), the period picker; `CardGrid` (twelve columns, dashboards.css's 860/620 rules);
  `WidgetBody` draws the ported cards (four figures, six charts, Best time); the rest show their
  title and `Unported.card` (posting cards: `Unported.postingCard`).
- `ReportsIndex`, `ReportPage(report:)`: every report (Followers, Posts, Engagement, Content,
  Blocks, People, Atmosphere), with `PersonRow` and `PostRowView` (Reports/People.swift);
  `ChartNotes` and `ChartNotesModels.marks` (one AnnotationsModel per account) put the notes
  and the follower milestones on the charts; every dashboard card (`MoreWidget`), and the card
  settings dialog (`CardSettings`) from Customize.

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
  `ToolStatement`, `FilterCards`/`FilterChoice` (figures that are the filter), `KVList`,
  `TimelineList`, `ToolMoreFoot` ("Show 30 more"), `ToolSelect`, `ToolSplit`, `ToolCaption`,
  and `.toolExporter($file)` with `archive.exportRows(name, rows)` for Export.
- From 641 wide Follow cleanup and Lists are tables (`CleanupTable`, `ListsTable`, a Grid
  whose first column takes what the rest leave); narrower, rows as the web's phone sets
  them. `Measure.Tools` (ToolMeasures.swift) names tools.css's measures.

SHARING (Share/)
- The hook, for a card or a report: `PostChartButton(type:name:options:period:)` (a card's
  ghost icon), `PostChartLink(type:name:kind:period:)` (a report's link action), or
  `@State var share: ShareRequest?` with `.shareDialog($share, period:)`. Each draws nothing
  for a type ShareSpec can't picture.
- The picture is `ShareImage.render(spec, theme:)`: VirgaInsights' ShareSpec drawn by
  ChartImage onto `GraphicsShareCanvas` (its `ShareCanvas` over a SwiftUI GraphicsContext)
  in an ImageRenderer at scale 1, 1200 × 675, under the sky on screen.
- Write a post with it calls `@Environment(\.shareComposer)` (a `ShareComposer` taking a
  `ShareDraft`: whose post, its first line, the PNG and its description) once the composer
  sets it; until then the picture and the first line go out through ShareLink as
  virga-chart.png. Save the picture asks Photos for add-only access
  (NSPhotoLibraryAddUsageDescription in project.yml) and says how it went in a toast.

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
  `LanguagePicker` and `GatesEditor`; its weekly queue reads VirgaPosting's `ScheduleModel` (the
  week's count and summary, the zone's name, moveToZone) and draws scheduleParts' `TimezoneSelect`. The
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

SCHEDULING (Posting/Schedule*.swift, Posting/ScheduledPage*.swift, Posting/WeeklySchedulePage.swift,
Posting/WhenPicker.swift, Composer/ComposerController+Schedule.swift, Composer/ComposerWhenPanel.swift)
- Over VirgaPosting's Schedule and Pages ports, unchanged (notes/scheduling.md): the rows, the week and
  the picker's words are ScheduleModel's, the reorder QueueReorder's, the calendar QueueCalendar's, the
  calls ScheduleService's over the account's `VirgaBackend` (`app.session.backendFor(did)`).
- `Measure.Schedule` (Posting/ScheduleMeasures.swift) names schedule.css's measures (and the few of
  hub.css's the rows use, and the toasts' and clocks' durations from the JSX).
- Posting/ScheduleParts.swift, what more than one page draws: `TimezoneSelect(value:identifier:onChange:)`,
  `ScheduleSwitch` (the web's Switch), `QueueCalendarView(schedule:rows:now:onPick:occupancy:highlight:
  caption:lead:after:)` (a SwiftUI Grid; VoiceOver reads it day by day through sort priorities),
  `.scheduleActionDialog(isPresented:title:confirmLabel:busyLabel:cancelLabel:danger:onConfirm:message:)`
  (ActionDialog, which the Timers page asks too, its quoted post a `HubQuote`), `ScheduleLinkedText`
  (words with links the navigator follows, through
  `InternalLink`), `ScheduledListLoad` (hubParts' useLoad over listScheduled, with the limits when asked,
  read again on `virga:scheduled-changed` / `virga:timers-changed` for the account), and the small
  helpers `ScheduleIds` (ids compared as `===`), `ScheduleText`, `ScheduleSaid` (a sentence as an error,
  a `ScheduleErrorObject`), `ScheduleGlyph`.
- `ScheduledPage(app:did:)` (RoutedPage's `/posting/scheduled`) over `ScheduledPageModel`
  (ScheduledPage+Model.swift: the clock, busy rows, the message, the optimistic redraw while an order
  saves, the drag, the lit row, the announcements, the question up). Rows are `ScheduledRowView`
  (ScheduledPage+Rows.swift) in one flat `ForEach` of `ScheduleListEntry` (day names and rows) so a row
  keeps its view, and its drag, as it changes day. Reordering: wider than a phone the `QueueHandle`
  (inline below 900, in the page's margin from 900) takes a drag over the rows' frames
  (`QueueRowFrames`), the keys (Space or Return, the arrows, Escape) and VoiceOver's adjust; a phone has
  Move earlier and Move later. Identifiers: `scheduled-page`, `sched-notes`, `sched-failed`, `sched-queue`,
  `sched-queue-list`, `sched-timed`, `sched-row-<id>`, `sched-note-<id>`, `sched-edit`, `sched-retry`,
  `sched-handle`, `sched-move-earlier`/`-later`, `sched-note-set-timer`, `sched-note-dismiss`,
  `sched-add-to-queue`, `sched-schedule-a-post`,
  `queue-calendar`, `calendar-pick`, `schedule-dialog` (`-keep`, `-confirm`, `-error`), `sched-limits`.
- `WeeklySchedulePage(app:did:)` (`/posting/schedule`): `DayRow` per weekday in the reader's week
  (`ScheduleWeek.orderedWeekdays()`), `CopyDaysDialog`, `ScheduleSuggestions.read(archive:…)` over the
  archive's best times, `ScheduleSplit` (two columns from 1181). Identifiers: `weekly-schedule-page`,
  `week-times`, `week-day-<key>`, `week-add-<key>`, `week-add-time`, `week-add-confirm`, `copy-day-<key>`,
  `copy-days-confirm`, `week-reset`, `week-ahead`, `week-off`, `week-repack`, `week-suggestions`.
- `WhenPicker(schedule:value:onChange:queue:requester:onQueue:min:max:repeatRule:onRepeatChange:
  repeatBlock:occurrence:)`: the caller passes the account's weekly schedule (its settings' `queue`) and
  its `VirgaBackend` (nil without a long session), where the web reads them from the did. Drafts'
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
  pickers (no 5-minute step, always a whole time); the picker's and a repeat's fields share their row
  evenly; forced colours have no counterpart.

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
  button under the words), `DraftsRowMenu` (the ⋯, a `HubSpinner` while the row works), `HubQuote`, and
  `PostingPagesError` (a sentence a page throws to its dialog, which shows it).
- `.postTimerDialog($post, did:onArmed:)` is TimerDialog.jsx (`PostTimerDialog`: the composer's
  stand-in already holds the name TimerDialog), over a `PostTimerTarget` (uri, cid, extraUris, text,
  postedAt, reply; nil reply or postedAt is the web's undefined and is read from Bluesky).
  `PostTimerTarget(arm)` takes a scheduled post's timer note (ScheduleModel.TimerNoteArm), for the
  Scheduled page's "Set a timer" (SCHEDULING above). `onArmed` hears the armed row after the sheet has
  closed.
- `LifespanDefaultsCard(did:model:)` (Posting/LifespanDefaults.swift, from Settings › Posting) reads
  getLimits with a long session, so its editor checks the free timers and its caption starts with
  timerLimitsLine.
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
  clock, an ISO string or nil as the web's `when`.
- Deliberate differences: the focus after a row goes (posted, deleted, called off) is the system's to
  place, not useFocusAfterRemoval's; a timer row whose model throws (a corrupt `acted` step, a web bug
  in timerRowModel) is left out where the web's page would fail. The web shows
  no PostPreview on the posted or scheduled rows (only in the composer's dialogs, a quote's card, the
  reply's context and the library), so neither does the app.

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
  `resetAnalyticsStore` and `deleteDatabase` go to VirgaArchive's AnalyticsStore.
- `AppRoot` ports App.jsx's states; `onOpenURL` and universal links go to
  `completeSignIn(callbackURL:)`. `SystemWebAuthenticator` is ASWebAuthenticationSession
  with the `.https(host:path:)` callback.
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

- Left for later steps: dragging cards, a card's settings dialog, the dashboard cards and reports not listed
  above, ChartNotes and the charts' notes and milestones; posting (the composer, its pages,
  Settings › Posting and the pending-work warnings before a sign-out, which wait for
  VirgaPosting's services); "Keep it when space runs low" (iOS has nothing to ask).
- Copy is the web's word for word, including words that only fit a browser ("This
  browser's region", "Forget X on this browser", "Saving the repo to this browser"). Worth
  raising on the web side rather than changing on one side.
- New copy the web has no counterpart for: "This page isn't in the iOS app yet.", "This
  section isn't in the iOS app yet.", "This card isn't in the iOS app yet." and "This card
  needs the composer, which isn't in the iOS app yet."; the share dialog's toasts after
  Save the picture ("Saved to Photos." and "The picture couldn’t be saved.") and Photos'
  permission line ("Virga saves a chart's picture to your photos when you ask it to."),
  since the web downloads the file instead.
- Hover is the pointer's on an iPad: a lookup suggestion or a handle suggestion under it is
  shaded or marked; underlines on hover are left to the system's pointer effect. The
  Interaction lookup's and the handle field's suggestions don't scroll (at most eight and
  five rows).
- Every window shares one session, so the web's "another tab switched accounts" notice
  has no case; TermsGate's Reload can't fetch newer documents (they are bundled).
- Until the composer is in the app, Post this chart's Write a post with it is the system's
  share sheet. New post (the sidebar's, the tab bar's round button) opens the composer in
  place, over the page it was pressed on, as Shell.jsx's does; VirgaUITests'
  `testNewPostOpensTheComposer` checks it opens and that Close shuts it.
