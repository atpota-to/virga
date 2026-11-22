# ui (VirgaUI): porting notes

What the agent that built the SwiftUI layer's foundation handed on, in four rounds
(November 2026), each compiled and run by CI's `iOS app` job on an iPhone and an iPad.
The code and ios/parity/modules/ui-*.json are the truth; read this for orientation, the
API a new screen uses, and what was left out.

Status: the foundation is built and passes CI (compile, the app's unit tests, the UI tests
on an iPhone and an iPad). Not yet audited against the web's components as a whole. The
dashboards, reports, tools, posting and Defense screens are still to come.

## How the layer is checked

SwiftUI can't be compiled on Linux. An agent writes VirgaUI in a worktree and checks
syntax with `swiftc -parse`; the main session merges and pushes; CI's `iOS app` job is
the compiler (Xcode 26.6, iOS 26.5 SDK, an iPhone and an iPad simulator); the UI tests
(ios/AppUITests) drive demo mode and keep a screenshot of each screen worth seeing
(XCTAttachment, kept always), which CI exports to the `screenshots` artifact
(`iphone/` and `ipad/`; the iPad run uses a 13-inch iPad upright, over 900 wide). Every VirgaUI file is wrapped in
`#if canImport(UIKit)`. VirgaUI builds in Swift 5 language mode.

Things CI's compiler has refused so far, worth avoiding: comparing an optional
`String?` with `String.jsEquals` (use the `Optional<String>.jsEquals` overload or unwrap);
reading a `@MainActor` model's properties from a static helper on a nonisolated enum
(mark the helper `@MainActor`, or put it on a View).

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
  Permissions, Data and sync with exports through `.fileExporter`, About).
- `Platform/AppStores.swift`: UserDefaults in `<bundle>.localStorage`, DiskFileStore in
  `Application Support/Virga`, KeychainSecretStore under `<bundle>.session`; tests in
  ios/VirgaKit/Tests/VirgaUITests (run by package-test on the simulator).
- Demo mode: `-VirgaDemo YES` runs on VirgaDemo's DemoSession (the demo network in front
  of the fake server), so the first build reads Mira's whole archive. Harness flags come as
  `-VirgaDemoFlags "<query>"` in the web's address form (accounts=1, signedout,
  expired=<handle>, scope=read, defense=on, terms=ask, latency=<ms>, now=…, appview=…);
  `-VirgaDemoTerms YES` and `-VirgaDemoSignedOut YES` are terms=ask and signedout. The
  app's own SessionModel runs over the demo session's environment, with the archive's
  reset and delete hooks wired as on a device.

## Known gaps and deliberate differences

- Left for later steps: the live sky (src/hillside, three.js) and the five taps on the
  mark; New dashboard and Customize; the dashboards, reports, tools, posting and Defense
  pages; "Keep it when space runs low" (iOS has nothing to ask).
- Copy is the web's word for word, including words that only fit a browser ("This
  browser's region", "Forget X on this browser", "Saving the repo to this browser"). Worth
  raising on the web side rather than changing on one side.
- New copy the web has no counterpart for: "This page isn't in the iOS app yet." and "This
  section isn't in the iOS app yet."
- Every window shares one session, so the web's "another tab switched accounts" notice
  has no case; TermsGate's Reload can't fetch newer documents (they are bundled).
- HandleField has no hardware-keyboard arrow navigation through the suggestions.
- DashboardsContext is only read so far (ui-insights.json keeps it pending).
