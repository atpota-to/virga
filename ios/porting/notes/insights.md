# insights (the structure tables): porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited. The tables in an earlier wave; the reports' models, chart notes, sharing and the Interaction lookup on 2026-11-21 (the section at the end, which supersedes this file's remarks that call them pending).
Parity cases at port time: 3210, plus 1802 added by the audit.
Tests at the time: `swift test` on Linux: 212 tests pass. VirgaInsightsTests has 79 tests in 18 suites, about 12s. VirgaCoreTests has 126 in 25, plus 7 one-test module checks. `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity` passes 35 tests in 3 files. `npx eslint ios` is clean and prettier is clean on the generators. Mutation checks: dropping spacing marks from fold, NFC-composing fold's output, and removing only the first card with a repeated id each fail the suite now; the old fixtures passed all three. The new canonical-equivalence and Kelvin cases failed 20 checks before the fix. Committed as 88b4b1e on i

## API for the code that builds on it

All in VirgaInsights (import VirgaInsights; depends on VirgaCore). Paths are under ios/VirgaKit/Sources/VirgaInsights/. Each table entry is a Codable, Hashable, Sendable, Identifiable struct whose field names are the web's, so it encodes to the web's JSON. An `icon` field holds a lucide displayName (e.g. "CalendarClock"; ImageIcon is "Image", History is "RotateCcwClock", Fingerprint is "FingerprintPattern"), and `sfSymbol` gives the mapped SF Symbol.

STRING COMPARISON (JSStrings.swift, internal)
- Where the web compares two strings from outside the code (ids, DIDs, recent ids, groups, registry keys, sizes), this target compares UTF-16 code units, as JS === / includes / Set do. Swift's == is canonical equivalence ("é" == "e\u{301}", Kelvin sign == "K").
- Internal helpers: String.jsEquals(_:), Optional<String>.jsEquals(_:), JSKey (Hashable by code units, for Sets), Dictionary<String,_>.jsValue(_:) (own key, exact), Sequence<String>.jsIncludes(_:).
- Comparisons with ASCII literals that contain no K, ; or ` are exact either way.
- VirgaCore should get a public version; until then don't depend on these from other targets.

ICONS (Icons.swift)
- Icons.sfSymbol(lucide: String) -> String (unknown names give "square.dashed"), Icons.hasSymbol(lucide:), Icons.lucideToSFSymbol: [String: String].
- The map also covers CommandPalette.jsx's own icons by displayName: ChartColumn (BarChart3), CalendarRange, Check, Clock, LayoutDashboard, Moon, Plus, RefreshCw, Search, Send, Settings, SlidersHorizontal, SquarePen, Sun, Sunrise, Sunset, Wrench. The commands fixture records these as value 'paletteIcons' ([{name, icon}]), read from that file's lucide-react import.
- IconsTests scans every ios/parity/fixtures/insights*.json for `icon` keys (so a wave-2 fixture is checked automatically) and checks paletteIcons.

ROUTES
- AppRoute (Shell/ShellRoutes.swift):
  - Fields: section: AppRoute.Section (.dashboard .reports .tools .settings .posting .defense .intent .missing; CaseIterable), dashboard: String?, page: String?, id: String?. Also AppRoute.missing.
  - Encodes the web's keys for each section, with explicit nulls.
- ShellRoutes:
  - parseRoute(_ path: String?) throws -> AppRoute. It rethrows Router.pathParts' JSURIError, message "URI malformed".
  - sectionTitle: [AppRoute.Section: String]
  - needsArchive(_:), opensBeforeArchive(_:) -> Bool
  - parentOf(_ route: AppRoute?) -> ParentLink? (ParentLink has label and to)
  - postingTitle(_:) -> String?
- PostingRoutes (Posting/PostingRoutes.swift):
  - postingBase "/posting", postingPages: [PostingPage], postingPageByKey: [String: PostingPage]. PostingPage fields: key, path, label, title, icon, needsBackend, pinned, access: [String], desc.
  - postingPath(_ key: String?) -> String
  - parsePostingRoute(_ path: String?) throws -> PostingRoute? and parsePostingRoute(parts: [String]) -> PostingRoute?. PostingRoute has key and id: String?, and always encodes id.
- DefenseRoutes (Defense/DefenseRoutes.swift): defenseBase, defenseIcon ("ShieldHalf"), defensePages: [DefensePage] (key, path, label, title, icon, desc), defensePageByKey, parseDefenseRoute(_ parts: [String]) -> DefenseRoute? (key). VirgaDefense should use these, not copy them.
- Deliberate difference: Object.prototype names ('/posting/constructor') are missing here; the web treats them as pages.

DASHBOARDS
- Catalog (Dashboards/Catalog.swift):
  - categories: [WidgetCategory] (key, label), widgetList: [WidgetDef] in library order, widgets: [String: WidgetDef], widgetRules: [String: WidgetRules].
  - WidgetDef: type, name, desc, category, icon, sizes, defaultSize, href, kind ("stat"|"card"), options; `.rules` gives its WidgetRules.
  - WidgetRules has sizes, defaultSize and options, all optional. It is what the layout functions take as `def`.
- Layouts (Dashboards/Layouts.swift), shapes:
  - DashboardLayout {version, dashboards}
  - Dashboard {id, name, template: String?, widgets: [DashboardCard]}; always encodes template, null when nil.
  - DashboardCard {id, type, size: String, options: CardOptions?}
  - CardOptions {title, period, kind, rows: Int?}; .jsonValue gives the raw form.
  - CardSize {cols, label, name}; DashboardTemplate {name, widgets: [TemplateCard]} (TemplateCard encodes as [type, size]).
- Layouts, constants: layoutVersion, sizes: [String: CardSize] plus sizeKeys (order), templates plus templateKeys, cardPeriods, cardKinds, cardRows, cardTitleMax.
- Layouts, functions (all pure; every function that makes ids takes `newId: (String) -> String = Layouts.newId`; ids, types and sizes are compared by code units):
  - cleanOptions(_ raw: JSONValue?, _ def: WidgetRules?) -> CardOptions?
  - fitSize(_ size: String?, _ def: WidgetRules?) -> String?
  - newId(_ prefix = "w")
  - dashboardFromTemplate(_ key, id:, name:, newId:)
  - defaultLayout(newId:)
  - sanitizeLayout(_ raw: JSONValue?, _ widgets = Catalog.widgetRules, newId:)
  - addDashboard(_ layout, name: "New dashboard", template:, id:, newId:) -> (layout, id: String)
  - duplicateDashboard(_ layout, _ sourceId, id:, newId:) -> (layout, id: String?)
  - renameDashboard(_, _ id, _ name: String?), deleteDashboard(_, _ id), moveDashboard(_, _ id, _ toIndex: Int), resetDashboard(_, _ id, newId:)
  - addWidget(_, _ dashboardId, _ type, _ def: WidgetRules?, id:, index:, size:, newId:)
  - removeWidget(_, _ dashboardId, _ widgetId), resizeWidget(_, _, _, _ size: String), setWidgetOptions(_, _, _, _ options: JSONValue?, _ def: WidgetRules?), moveWidget(_, _, _, _ toIndex: Int)
- LayoutIDGenerator (final class, Sendable): init(now: @Sendable () -> Double epoch ms, random: @Sendable () -> Double), .shared, newId(_ prefix:), static format(prefix:now:counter:random:). For deterministic ids in tests or the demo, pass `gen.newId`.
- Deliberate differences, in input the app never produces (map note and LayoutsBehaviour):
  - Object.prototype names are not types or templates.
  - Resetting a dashboard with an unknown template gives the overview's cards; the web throws.
  - Non-string template/type values in a stored layout are dropped.
  - A rule with no sizes and no default gives size "".
- Not ported here: DashboardsContext.jsx (the per-account model that stores the layout) is UI-domain. It should read the stored JSON with Layouts.sanitizeLayout and write DashboardLayout's JSON under the web's key.

REGISTRIES
- ReportsRegistry.reports: [ReportEntry] (key, label, icon, desc), reportByKey (Reports/ReportsRegistry.swift).
- ToolsRegistry.toolSections: [ToolSection] (key, title, desc), tools: [ToolEntry] (key, name, icon, section, access: String, planned: Bool?, desc), toolByKey, access (Tools/ToolsRegistry.swift).
- AccessBadge.access: [String: AccessKind] (label, tone: String? = "warn" for ask, icon) and accessKeys order (Components/AccessBadge.swift). Its header now has `// Ports src/components/AccessBadge.jsx` and `// Ports src/tools/registry.js`; ui-shell.json's AccessBadge.jsx entry is still pending.
- SettingsSections.sections: [SettingsSection] (key, label, desc).
- RadioKeys.radioKeyTarget(_ key: String, _ index: Int, _ count: Int) -> Int?. Keys use DOM names: "ArrowRight", "Home", ...

KEPT ACCOUNTS (Tools/Keep.swift)
- Keep.keepKey(did, name) gives "virga:keep:<name>:<did>"; Keep.read(_:store:) (each DID once, by code units, as a JS Set), Keep.serialize(_:) (byte-exact JSON.stringify).
- @MainActor @Observable KeepListModel(did:name:store: KeyValueStore?): dids: [String] (insertion order), has(_:), size, key, add(_:), remove(_:), clear(). Membership is by code units. A refused write is kept in memory only. Make one model per account and tool ("cleanup", "followback").

SHORTCUTS (Shell/Shortcuts.swift)
- KeyEvent(key:metaKey:ctrlKey:altKey:shiftKey:repeat:isComposing:defaultPrevented:target: KeyTarget? = .page)
- KeyTarget(tagName:type:isContentEditable:) with presets .textField .searchField .textEditor .control .page
- Navigator(platform:userAgentData:) and Navigator.current (Apple platforms give an Apple platform string)
- Shortcuts: isTypingTarget(_:), isNewPostShortcut(_:inDialog:), isMacPlatform(_ nav = .current), paletteShortcutLabel(_ mac), paletteShortcutAria(_ mac), isPaletteShortcut(_:inDialog:mac:). Keys are compared by code units: the Kelvin sign is not "K".

COMMAND PALETTE (Shell/Commands.swift)
- Command fields: id, group, title, hint?, keywords?, icon?, shortcut?, current: Bool?, go?, `do`?, arg?. Read with command.do; init label is `do:`.
- PaletteGroup {group, items}.
- CommandContext: dashboards, reports, tools, postingPages, defensePages, settingsSections, accounts, activeDid, periods, period, sky, route, archive.
  - Nested item structs (DashboardItem, ReportItem, ToolItem, PageItem, SectionItem, Account, Period {key, days: Double?, label}, Route {section, dashboard}, Archive {built, complete, syncing}) each have an init from the matching registry type.
- CommandContext.app(dashboards:accounts:activeDid:periods:period:sky:route:archive:defenseEnabled:) builds the context the way CommandPalette.jsx does.
  - Pass `route` with `dashboard` set to the dashboard the shell shows, nil when the address names none (Shell.jsx passes dashboard?.id || null).
  - Pass VirgaArchive's ANALYTICS_PERIODS as `periods` once that module exists.
- Commands, constants: commandGroups, recentGroup, maxRecent.
- Commands, functions (ids, groups and DIDs compared by code units):
  - periodTitle(_:), buildCommands(_ context = .init()), fold(_:)
  - rankCommands(_ commands, _ query: String?, recent: [String]) -> [Command]
  - paletteGroups(_, _, recent:) -> [PaletteGroup]
  - rememberRecent(_ recent: [String]?, _ id: String?) and rememberRecent(stored: JSONValue?, _ id:)
  - parseRecent(_ raw: String?), moveActive(_ key, _ index, _ count) -> Int?
- The palette's storage key 'virga:palette-recent' (PALETTE_RECENT_KEY) is defined in CommandPalette.jsx (UI), so it is not in this target.

TEST SUPPORT (Tests/VirgaInsightsTests/)
- InsightsTestSupport.swift:
  - encoded(_:), outcome { } (gives {"$throws": message}), strings(_:), decoded(_:as:_:).
  - expectOutput(_:_:strictNulls:) now also checks every string scalar for scalar.
  - exactDiff(_:_:strictNulls:) is Parity.diff then scalarDiff; scalarDiff(_:_:) also checks object keys. Use exactDiff instead of Parity.diff, which takes "é" and "e\u{301}" as the same string.
- When comparing whole tables or layouts, pass strictNulls: true.
- CommandsParity resolves a case input `named: "<fn>"` to that value case's output (the generated list 'fuzzCommands' is written once).
- Generator helpers in ios/parity/cases/_insights.js: iconName, withIconNames, seeded(seed) (mulberry32: next/int/pick/string), HARD_TEXT (a pool of hard Unicode text, whole code points only).

## Known gaps and deliberate differences

- Cross-domain: Swift String ==, Set<String> and Dictionary keys are canonical equivalence, while JS compares code units. VirgaCore should offer a public helper (VirgaInsights' internal JSStrings.swift: jsEquals, JSKey, jsValue, jsIncludes) and PORTING.md should state the rule. The same thing likely affects other domains (Defense DID sets, archive ids).
- Cross-domain: VirgaTestSupport's Parity.diff lets canonically equivalent strings through. It should compare string scalars, as InsightsTestSupport's scalarDiff does. Only VirgaInsightsTests checks this today.
- Null vs missing in CommandContext (period key null, Defense page title null) still reads as missing. The web differs there; the app's tables never have these nulls. Documented in the commands.js map note.
- Deliberate differences, still only in Swift behaviour tests: Object.prototype names, resetting a dashboard with an unknown template, non-string template/type values in a stored layout, and size "" for a rule with no sizes and no default.
- src/shell/shortcuts.js stays partial: VirgaUI must turn key presses and focus into KeyEvent/KeyTarget and work out inDialog.
- TERMS_PATH and PRIVACY_PATH are private copies in Commands.swift until VirgaSession merges. CommandContext.Period mirrors ANALYTICS_PERIODS; callers pass it in until VirgaArchive exists.
- ui-shell.json's src/components/AccessBadge.jsx entry is still pending; I didn't edit it. Its ACCESS table is in Components/AccessBadge.swift, whose header now names that file, so the ui-shell agent can list it and port AccessLine as a view.
- SF Symbol names can't be checked on Linux. A VirgaUI test should check that UIImage(systemName:) is non-nil for each value in Icons.lucideToSFSymbol.
- DashboardsContext (UI domain) should store the layout with JSONEncoder output of DashboardLayout. That output isn't byte-identical to JSON.stringify (JSONEncoder escapes '/' unless told not to), which doesn't matter, since only the iOS app reads it back through sanitizeLayout.
- Still pending, per the brief: src/reports/models.js, annotations.js, useAnnotations.js, src/tools/interactionModel.js, src/share/chartImage.js, src/share/shareSpec.js.
- src/defense/routes.js is ported in VirgaInsights (Defense/DefenseRoutes.swift). The Defense agent should import it from there rather than define a second copy in VirgaDefense.

## What the audit found and fixed

- medium (fixed) src/tools/keep.js read/useKeepList; src/dashboards/layouts.js sanitizeLayout, mapDashboard, duplicate/delete/moveDashboard, remove/resize/setWidgetOptions/moveWidget, fitSize, addWidget; src/shell/commands.js buildCommands, rankCommands, paletteGroups, rememberRecent: Swift's String == (and Set<String>, Dictionary keys, contains, firstIndex(of:)) is canonical equivalence, but JS ===, includes, indexOf and Set compare UTF-16 code units. So the port merged strings the web keeps apart. Stored DIDs "café" (NFC) and "café" were one kept DID (size 2 where the web has 3). Two dashboards with those ids collapsed in sanitizeLayout, and rename, delete, move, duplicate and reset hit both. Palette groups merged, the recent order and the rememberRecent filter matched the wrong id, and onDashboard/current/activeDid/period matched across spellings. Fixed with internal JSStrings.swift (jsEquals, JSKey, Dictionary.jsValue, jsIncludes), used wherever two strings from outside the code are compared. New fixture cases (ACCENTS layout, accents context and list, the canonically-equivalent keep case) failed 20 Swift checks before the fix and pass after it.
- medium (fixed) src/shell/shortcuts.js isPaletteShortcut / isNewPostShortcut: The Kelvin sign U+212A canonically decomposes to 'K', so Swift's `event.key == "K"` was true for it. Cmd+Kelvin (or Ctrl+Kelvin off a Mac) opened the palette, where the web's === says no. Keys are now compared by code unit. New cases isPaletteShortcut#585/#586 failed before the fix.
- medium (fixed) (test harness) ios/VirgaKit/Tests/VirgaTestSupport/Parity.swift diff: Parity.diff compares strings with JSONValue ==, which is canonical equivalence, so an NFC/NFD difference passes. Proven by mutation: fold returning NFC-composed Hangul ("한국어") still passed where the web gives jamo. I left the shared harness alone. Instead the insights tests now also run scalarDiff, a scalar-for-scalar string check, through expectOutput and the new exactDiff, with ScalarDiffTests. With it the mutation fails. Every other domain's parity tests still have this blind spot.
- medium (fixed) src/shell/commands.js fold; src/dashboards/layouts.js removeWidget/resizeWidget/moveWidget/setWidgetOptions: Coverage gaps, shown by mutation. Old fixtures still passed when fold stopped stripping spacing marks (Mc, e.g. Devanagari ि), and when removeWidget removed only the first card with a repeated id (stored layouts keep repeated card ids). Added seeded generated text (HARD_TEXT) for fold and ranking (160 strings, 160 queries over a generated list), 200 generated addresses plus every posting/Defense/intent page path for parseRoute and parsePostingRoute, 50 generated stored layouts and 80 option objects, a TWINS layout with repeated card ids, Unicode tag/type/platform cases (Kelvin, dotted and dotless i, long s, Cyrillic, fullwidth), and DIDs that need JSON escapes. Both mutations now fail.
- low (fixed) ios/parity/modules/insights.json (src/posting/routes.js, src/dashboards/layouts.js, src/tools/registry.js, src/shell/commands.js): The map's entries were 'ported' with no notes, though the porter's summary said they had them. The deliberate differences were written nowhere in the map. Added notes covering the Object.prototype names, resetting a dashboard with an unknown template, non-string template/type values, size "" for a rule with no sizes, the private TERMS/PRIVACY copies, the null-key period and null Defense title, and the ACCESS table living in AccessBadge.swift.
- low (fixed) src/components/AccessBadge.jsx / src/tools/registry.js: AccessBadge.swift's header was not in the `// Ports <web path>` form (it read 'Ports ACCESS from …'). It passed the header check only because the check is a substring match. It now has one `// Ports` line for each web file.
- low (fixed) src/shell/CommandPalette.jsx (ACTION_ICONS, SKY_ICONS, GROUP_ICONS): The palette's own icons were in Icons.lucideToSFSymbol, but no fixture backed them. The commands generator now reads CommandPalette.jsx's lucide-react import and records each icon as {name, icon} (value 'paletteIcons'; BarChart3 is ChartColumn). IconsTests checks that each one maps.
- low (open) src/shell/commands.js buildCommands: Not fixed; documented in the map note. Swift can't tell null from absent here. A period whose key is null gives 'period:null', arg null and current true in the web when no period is set. Swift gives 'period:undefined', no arg and current false. A Defense page with title null gives keywords starting 'null' in the web and 'undefined' in Swift. The app's own tables never have these nulls.
- low (open) src/posting/routes.js parsePostingRoute: Web bug, confirmed by running the web code; I didn't fix it, as instructed. POSTING_PAGE_BY_KEY is a plain object, so parseRoute('/posting/constructor') gives {section:'posting', page:'constructor', id:null}. PostingPage.jsx then finds PAGES['constructor'] (Object) instead of a page. The same goes for '__proto__', 'toString' and the like. Fix: Object.hasOwn. On purpose, the port returns missing for these (RoutesInheritedNames).
- low (open) src/dashboards/layouts.js sanitizeLayout / resetDashboard / dashboardFromTemplate / addDashboard: Web bugs, confirmed. sanitizeLayout keeps template 'constructor' and card type 'toString' (plain-object lookups), and resetDashboard on that dashboard throws "Cannot read properties of undefined (reading 'map')". addDashboard({template:'nope'}) stores template 'nope', and resetDashboard on it throws "Cannot read properties of undefined (reading 'widgets')". On purpose, the port drops these names and resets to the overview's cards (LayoutsBehaviour).
- low (fixed) all insights files: Verified by side-by-side reading and fixtures, no discrepancy found: every export of the 12 files (plus ACCESS) is ported; UTF-16 indexing in slice/indexOf/startsWith/scattered gaps; ASCII-only /i folding in isMacPlatform; JS trim set; Final_Sigma and İ lower-casing; NFD and \p{M}/\p{L}\p{N} splitting; the ranking order is a total order, so sort stability doesn't matter; newId call order and counter wrap; default parameters; every word of copy is compared by whole-table fixtures with strictNulls; SF Symbols all exist on iOS 17.

## The rest of insights (2026-11-21)

Parity cases at port time: 5322, plus 1827 added by the audit.
Tests at the time: `swift test` (whole package) passes on Linux:
- VirgaInsightsTests: 152 tests in 29 suites, about 13s (one new test, ChartImageParity/drawShareImagePartly).
- Other targets: 79, 57, 190, 99, 69, 77, 176 and 126 tests, all passing.

Other checks:
- `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity`: 128 tests in 4 files pass.
- `npx eslint ios` is clean. Prettier is clean on insights.collation.js, insights.chartImage.js and generate-collation-table.mjs.
- `npm run parity:drift`: no drift.

Insights parity numbers are now compared exactly, and all fixtures pass.

Mutation checks:
- The previous JSCollation fails 162 of the 4,823 insights.collation cases.
- The new code passes them all, plus 100,000 fresh random pairs from Node.

Commits on ios/w5-b:
- 32d4cc3 iOS insights audit: localeCompare's contractions and compatibility cases
- e0f3d56 iOS insights audit: the share picture stops where the web's drawing throws

### API for the code that builds on it

Everything below is in VirgaInsights (import VirgaInsights). Paths are under ios/VirgaKit/Sources/VirgaInsights/.

INPUTS (Reports/ReportArchive.swift)
- struct ReportArchive(did:handle:nowMs:data: ArchiveData), and `@MainActor init(_ model: ArchiveModel)`.
  - Pass-through accessors: posts, followers, following, blocks, inbound, outbound, atmosphere ([AtmosphereRow], VirgaRepo's type; added in wave 6), meta, rev, followRev.
- struct ReportFormats(locale:weekStart:timeZone:twelveHour:), with `.active` (AppLocale's) and static twelveHour(_ locale).
- Every model, mark and share function takes `formats: ReportFormats = .active`.

REPORT MODELS (enum ReportModels; Reports/ReportModels*.swift)
- Every model first replaces nowMs with Periods.periodEnd(period, nowMs). Each takes (_ archive, _ period: AnalyticsPeriod, _ nowMs: Double, …, formats:).
- followersModel(…, unit: AnalyticsUnit?) -> FollowersReport
- blocksModel(…, unit:) -> BlocksReport
- postsModel(…, unit:) -> PostsReport
- engagementModel(…, kind: String = "all", unit:, rateUnit:) -> EngagementReport
- givenModel(…, kind:, unit:) -> GivenReport
- peopleModel(…, kind:) -> PeopleReport
- followBackModel(…) -> [TopActor]
- atmosphereModel(…, unit:) -> AtmosphereReport?
- bestTimeModel(…, block: Int = 2) -> BestTimeReport. The block is clamped to ≥ 1.
- contentModel(…) -> ContentReport
- relationSets(_ archive) -> RelationSets, with isFollower, isFollowed and followerCard.
- listsModel(_:) -> [ListInfo]; followerLogModel(_:) -> FollowerLogReport.
- Pure functions:
  - median([Double]) -> Double?
  - hourRange(_ col, _ block = 2, twelveHour:)
  - hourColumns(_ block, twelveHour:) -> [HourColumn]
  - weekdayOrder(_ weekStart?)
  - formatOf(PostRow), contentReady(ReportArchive)
  - contentStandout([ContentGroup], Double?, String?) -> ContentStandout?
- Constants: weekdays, weekdaysLong, bestTimeMinPosts, contentMinPosts, contentFormats, lengthBands, threadPlaces ([ContentDef]), givenNoun.
- Cache: public cached(_ archive, _ name, _ period?, _ options: [(String, JSONValue)], formats:, compute) -> T.
  - It uses the web's key plus the zone and clock; cacheLimit is 80; clearCache().
  - There is also an internal Cache class for tests.
- Result types are in ReportModels+Types.swift: public fields named as the web's, and `json: JSONValue`, the web's object with NaN kept.
  - DatedFollower {row, atMs}; PostRow with atMs set on dated posts.
  - Content results: ContentGroup, ContentUse {name, tally} (writes tag/host), LangCount, AltCoverage.

JS SUPPORT
- localeCompare is VirgaCore's JSCollation.localeCompare(a, b, locale:, sensitivity:) since wave 6 (VirgaCore/Support/JSCollation.swift; notes/core.md, "localeCompare"). VirgaInsights' own copy is gone.
- JSMath (internal): max, min, less (code-unit `<`), or (JS `||` over comparator terms).

ANNOTATIONS (Reports/Annotations.swift)
- Types: Annotation {id, day, label}; ChartMark {t, label, kind: .note|.milestone, id?, count?}; SeriesMark {i, t, kind, items}.
- enum Annotations, constants: annotationLabelMax (80), annotationsMax (200), annotationsKey(did) ("virga:annotations:<did>").
- Notes:
  - cleanAnnotations(JSONValue?) and cleanAnnotations([Annotation]).
  - readAnnotations(did, store:) and writeAnnotations(did, list, store:), which writes byte-exact JSON.stringify; serialize.
  - newId(now:), addAnnotation(list, day:, label:, id:), removeAnnotation.
- Milestones: milestoneSteps(Double) -> [Double]; followerMilestones([FollowerRow]?, locale:) -> [ChartMark].
- On a chart:
  - noteMark(_:).
  - marksOnSeries(_ series: [Double]|[SeriesPoint]|[RatePoint], unit, marks, weekStart:) -> [SeriesMark].
  - markText(mark, unit, locale:), todayKey(now).
  - chartMarks(notes:archive:series:unit:milestones:formats:).
- @MainActor @Observable AnnotationsModel(did:store:changes: = .shared, timeZone:, newId:): list, add(day, label), remove(id), reload(), chartMarks(archive, series, unit, milestones:).
- @MainActor AnnotationsChanges (.shared) stands in for the web's window event. Make one model per account.

INTERACTION LOOKUP (enum InteractionModel; Tools/InteractionModel*.swift)
- interactionModel(_ archive, _ who, nowMs: Double? = nil, formats:) -> Interaction.
  - Fields: did, isSelf, relationship, totals/first/latest as BothWays<…> (.in/.out), timeline, coverage, engagedPosts, yourPosts, events: [InteractionEvent].
- interactionIndex(_:) -> InteractionIndex {order, byDid, ranked, count(did)}.
- peopleDirectory(_:cardOf: (String) -> ActorCard?) -> [DirectoryPerson]; matchPeople(_:_:limit:).
- filterEvents(_:direction:kind:); eventPhrase(_ ev) or eventPhrase(dir:kind:); eventsCsvRows(_:did:handle:) -> [[String]].
- kindsLine(entries:byCount:locale:) or kindsLine(_ [String: Int]?); keepsMentions; isDid.
- parseActorInput -> ActorInput {kind: .did|.handle, value}; lookupHref(who, search).
- Constants: lookupPath, lookupKinds, outboundKinds, kindLabel, kindNoun, directions.

SHARE (Share/)
- ShareSpec (enum):
  - shareSpec(type, archive, period, nowMs, ShareOptions(kind:rows:title:notes:), formats:) -> ShareSpecification?
  - canShare(type); shareAltText(spec, formats:); sharePostText(spec, period, formats:); altTextMax.
  - ShareSpecification fields: kind (.series|.bars), title, subtitle, figure: ShareFigure?, series: [SharePoint {t, v?, total?, posts?}], unit, mode ("bars"|"line"), trend, zeroBase, format: ShareNumberFormat (.count|.rate, callable), marks, noun, ghost: Double?, rows: [ShareBarRow], measure. `json` gives the web's spec.
- ChartImage (enum):
  - Constants: shareWidth 1200, shareHeight 675, plot: ShareBox, fontFamily.
  - readShareTheme(ResolvedTheme) -> ShareTheme (13 ThemeColors).
  - seriesLayout(spec, box) -> SeriesLayout with x(i) and y(v); axisLabels(series, unit, locale:, timeZone:) -> [AxisLabel]; fitText(ctx, text, width).
  - `@discardableResult drawShareImage(ctx: some ShareCanvas, spec, theme, formats:) -> Bool`. It is CHANGED by the audit: it returns false where the web's drawing throws part way (a line with no buckets, which shareSpec never gives), after the same calls and none after. Treat false as "the picture couldn't be made", as renderShareImage rejects.
- protocol ShareCanvas: AnyObject.
  - Properties: fillStyle/strokeStyle: ShareStyle (.color, .linearGradient(ShareGradient)), font: ShareFont {weight, size}, textAlign, textBaseline, lineWidth, lineCap, lineJoin, supportsLetterSpacing, letterSpacing.
  - Methods: measureText, fillRect, fillText, save, restore, translate, scale, beginPath, moveTo, lineTo, arc (radians, clockwise, y-down), arcTo, rect, closePath, fill, stroke, clip, setLineDash.
  - VirgaUI implements it over GraphicsContext and renders to PNG with ImageRenderer.

TEST HELPERS (Tests/VirgaInsightsTests, internal)
- InsightsTestSupport.swift: exactDiff is Parity.diff, then scalarDiff, then numberDiff (NEW: every double compared exactly).
- ReportsTestSupport.swift:
  - ReportFixtures.archives (insights.archives plus insights.interaction's own), data(json), archive(c).
  - ParityCase.zone, formats, period, option, unitOption, compactOutput.
  - recorded() (NaN and ±Infinity become null, deeply); expectReport().
  - All fixtures load from VIRGA_PARITY_DIR when it is set, which is handy for fuzzing over a scratch directory.
- ShareTestSupport.swift: shareSpecification(json), shareTheme(json), canonical(ThemeColor) ("rgba(r,g,b,a)"), RecordingCanvas (measures 0.55·size per UTF-16 unit plus the spacing).
- ChartImageParityTests has drawShareImagePartly (NEW).
- Generator helpers:
  - ios/parity/cases/_reports.js: worldArchive, harnessArchives, edgeArchives, emptyArchive, archiveCases, contexts(base), compact, modelCases, MODELS, periodsAt, preset, roundTrip, NOW, EDGE_NOW.
  - ios/parity/cases/_share.js: shareThemeFor, canonical, recordingContext, logRecord, measure.
  - insights.collation.js: OWN_LETTERS groups (all pairs) and OWN_LETTER_TEXT seeded pairs.

### Known gaps and deliberate differences

- src/share/chartImage.js stays partial: renderShareImage is VirgaUI's. It needs a ShareCanvas over GraphicsContext, CoreText measuring in Instrument Sans and ImageRenderer to PNG (virga-chart.png). VirgaUI should treat drawShareImage returning false as a picture that couldn't be made.
- src/shell/shortcuts.js stays partial: turning key presses and focus into KeyEvent/KeyTarget is VirgaUI's.
- (Resolved in wave 6.) JSCollation's gaps listed here at port time (scripts outside the table, two-part discontiguous contractions only, approximate later parts of compatibility forms, living in VirgaInsights) are closed: it is VirgaCore's now, exact over core.collation; see notes/core.md.
- The report models' cache keys on the zone and the clock as well as the web's key. Like the web, it keys on the archive's nowMs, not the one passed in.
- Rows are VirgaArchive's typed rows, so a field of the wrong type reads as absent. For example, a numeric post `at` or follower `followedAt` reads as undated where the web keeps the number. PostRow.json also writes mentions [] and altCount 0 for current-shape rows; the web's shaper always writes both fields there anyway.
- (Resolved in wave 6.) VirgaInsights depends on VirgaRepo, and ReportArchive has its `atmosphere` accessor.
- Node's URLSearchParams truncates non-ASCII text in a segment that mixes a valid escape with a malformed '%'. Browsers don't, and neither does Swift's JSURI. A fixture generated in Node can't hold the browser's answer for such input.
- Deliberate differences, pinned by tests and noted in the map:
- Object.prototype names are not share types, event phrases, counted kinds or list purposes.
- A note's day must be a string.
- A note label cut through an emoji keeps U+FFFD where the web keeps a lone surrogate.
- An interaction event at a time outside Date's range gets at "" where the web throws.
- The best-time block is a whole number of at least 1.
- drawShareImage returns false where the web throws.

### The audit

- **medium**, src/reports/models.js contentModel (ranked tags/links, langs) and listsModel: String.prototype.localeCompare, ported as Support/JSCollation.swift: JSCollation (Swift's localeCompare, which breaks name ties for tags, links, languages and list names) took text apart canonically before weighing it. So letters that ICU weighs as letters of their own came out as their base letter plus an accent. Affected: Cyrillic й/Й (the letter after і and ї), the Arabic hamza letters أ إ آ ؤ ئ, and the two-part vowel signs of Bengali, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala and Myanmar. Node puts "моим" before "мой" and "احمد" before "أحمد"; Swift gave the reverse. 363 of 20,000 random pairs in those scripts disagreed with Node. Fix: generate-collation-table.mjs now asks the collator which canonical decompositions are contractions (30 in the table's ranges) and weighs them like single code points. JSCollation puts their decompositions back together after NFD, either in a row or across an unblocked mark (UCA S2.1, e.g. the shadda in و + ّ + ٔ). 100,000 fresh random pairs, Latin through Hangul, now match Node with none differing.
- **low**, src/reports/models.js (localeCompare ties), Support/JSCollation.swift + JSCollationTable.swift: In JSCollation, compatibility forms (ﬁ ﬀ ﬃ ĳ Ĳ ǅ ǆ ½) gave their parts a case heavier than every capital. ICU puts that case between a letter's small forms and its capitals, so Swift sorted ﬁ after FI and ﬀ after FF (Node: ﬁ < Fi < FI). 13 of 30,000 mixed-text pairs were wrong. Fix: the generator reads where each expansion's first part falls among its letter's cases (`@slot` in the table), on a tertiary scale of 2t+1 that leaves room between ranks. The later parts keep their own case one step up, so ǅ still sorts before Ǆ. Accented expansions (æ, ß) keep the heavier case, which is right for them.
- **low**, src/share/chartImage.js drawShareImage/drawSeries: Swift's drawShareImage on a line-mode spec with no buckets read series[L.n - 1] with L.n = 0, which traps (crashes). The web throws a TypeError at the same point, after stroking the line, and renderShareImage rejects, so ShareDialog shows an error. shareSpec never returns such a spec, but ShareSpecification has a public init. Fix: drawShareImage now makes the web's calls up to that point and none after (it skips the foot, as the web's throw does), then returns false. The function is @discardableResult and returns true otherwise, so VirgaUI can refuse the picture as the web does. New fixture case drawShareImagePartly holds the web's 42 calls and its throw. empty-bars, which finishes on the web, is covered too.
- **low**, ios/parity/modules/insights.json (src/reports/models.js, src/share/chartImage.js): The module map was missing deliberate differences. bestTimeModel and hourColumns clamp the block to a whole number of at least 1, where the web takes fractions (2.5 gives cols 10), throws RangeError for 0 in bestTimeModel (hourColumns(0) gives one label spanning Infinity), and returns cols -12 for a block of -2. BestTime.jsx only offers 1 to 4, so this is unreachable. Also, a post's `at` or a follower's `followedAt` written as a number reads as undated in the typed rows; the web's interactionModel and relationSets keep it. The sync never writes either. Both are now written in the models.js note, and the chartImage.js note describes drawShareImage's Bool.
- **low**, ios/VirgaKit/Tests/VirgaInsightsTests/InsightsTestSupport.swift exactDiff/numberDiff: Test-harness hardening: insights' exactDiff used Parity.diff's relative tolerance of 1e-9 for numbers. It now also runs numberDiff, which compares every double exactly, as VirgaRepoTests does. All 151 existing insights tests already passed exactly, so the port's sums, medians and pixel positions are bit-for-bit the web's.
- **low** (left as it is), src/tools/interactionModel.js lookupHref (new URLSearchParams(search)); Swift JSURI (VirgaCore): Node's URLSearchParams differs from browsers (WHATWG) when a query segment has a valid %XX escape, then a malformed %, then non-ASCII text. Node falls back to a byte-truncating unescape: "%3A%İ" serializes as "%3A%250=" (İ becomes '0'), U+3000 becomes %00 and U+00A0 becomes U+FFFD. Browsers, and VirgaCore's JSURI.parseSearchParams, decode the UTF-8 bytes. So Swift matches the browser the web app actually runs in, but a Node-generated fixture would disagree for such input. No fixture currently has it. This is a Node runtime quirk, not a web-app bug; I changed nothing.
- **low**, src/reports/*.js, src/share/*.js, src/tools/interactionModel.js: Verified without finding any discrepancy, beyond the items above:
- Read the web code side by side with the Swift for every export of models.js, annotations.js, useAnnotations.js, shareSpec.js, chartImage.js and interactionModel.js. Checked UTF-16 slicing, JS truthiness, `||` vs `??` defaults, stable sorts, Math.max/min with NaN and -0, Map insertion order, code-unit keys, the cache key and FIFO eviction at 80, and regex ports (DID, handle, profile link, at:// URI).
- Fuzzed the report models, share specs and Interaction lookup with VIRGA_PARITY_DIR: 12 random archives × 3 seeds × every period and model in four zones. About 3,300 cases, all exact.
- Fuzzed parseActorInput, isDid, matchPeople and cleanAnnotations on 8,500 random strings, all matching. lookupHref matched apart from the Node quirk above.
- The map is honest: no drift, every header names its web file, and the partial entries (chartImage renderShareImage, shortcuts DOM input) are accurate.
