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
- `.toggleStyle(.virgaSwitch)`, `.virgaCheck`; `.virgaField(invalid:size:)`,
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
- Memory while it is on: the dome (about 15 KB), the noise (64 KB and its mipmaps), two buffers of
  puffs per canvas (183 KB each), and the band's scene texture and two drawables at 1.5 pixels a
  point; the land's mesh (about 2.2 MB) only once a hill is drawn.
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
  share sheet, and New post (the sidebar's, the tab bar's, the palette's) goes to the
  composer's address, whose page says it isn't here yet.
