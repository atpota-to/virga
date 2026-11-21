# insights (the structure tables): porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited.
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
