# core: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited.
Parity cases at port time: 3913, plus 278 added by the audit.
Tests at the time: Whole package: a clean `swift build --build-tests` has 0 warnings. `swift test` passes everywhere: VirgaCoreTests has 129 tests in 25 suites (was 114), and the other 8 targets' module tests pass. `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity`: 3 files, 27 tests pass. `npx eslint ios`: clean. New tests: JSTextParityTests.swift (core.jsjson and core.jsstring parity; 100,000-deep nesting; linear-time parsing of a 100,000-member array and object; response.json() byte-order-mark and bad-UTF-8 handling; error positions; stored values read the way JSON.parse reads them), plus additions to LocaleP

## API for the code that builds on it

All in VirgaCore (import VirgaCore). Paths are under ios/VirgaKit/Sources/VirgaCore/. Items marked [AUDIT] are new or changed in the audit; everything else is as the porter described.

JSON (JSONValue.swift, Support/JSONParse.swift) [AUDIT]
- JSONValue.parse(_ text: String) is exactly JSON.parse(text): strict ECMA-404 grammar, the last of two equal keys wins, 1e400 is ±infinity, -0 stays -0, lone surrogate escapes become U+FFFD, and a byte-order mark is an error.
- JSONValue.parse(_ data: Data) is `await response.json()`: UTF-8 decode (leading byte-order mark dropped, malformed bytes become U+FFFD), then JSON.parse. Use it for every network body.
- JSONText.parse(_:) is the same pair of functions. Refusals throw JSONParseError(message:position:), where position is the UTF-16 offset; the message isn't V8's.
- The parser is iterative and linear-time (4.6 MB in about 0.16 s in release, faster than JSONDecoder). Don't use JSONDecoder to read the web's stored strings or bodies as JSONValue.

JS STRING SEMANTICS (Support/) [AUDIT]
- String.jsLowercased() is toLowerCase() (Unicode full mapping plus Final_Sigma: 'ΟΔΟΣ' gives 'οδος'); String.jsUppercased() is toUpperCase(). Use them wherever the web calls toLowerCase or toUpperCase (hashtags, handles, shortcuts, search). Swift's lowercased() has no final sigma.
- Never split, search or prefix-match web strings by Character: a combining mark after '/', '?', '&', '=' or '@' merges with it into one Character. Use jsIndexOf/jsSlice, `utf16`, `unicodeScalars` or bytes.

LOCALE AND FORMATTING (Lib/AppLocale*.swift; locale.js; named AppLocale to avoid clashing with Foundation.Locale)
- Active state (Locked statics; under test en-US, Monday, UTC): AppLocale.activeLocale() -> String, activeWeekStart() -> Int (a getDay index), uses12Hour(), localeStamp(), activeTimeZone() -> TimeZone, setActiveLocale(_ tag: String?) -> String, setActiveWeekStart(_ day: Int?) and (_ value: JSONValue?), setActiveTimeZone(_:). The web's "local time" is AppLocale.activeTimeZone(); never read TimeZone.current in logic.
- Locale functions: systemLocale(_ languages: [String]?) (pass Locale.preferredLanguages), resolveLocale(_ pref:, languages:), regionWeekStart(_ tag:), resolveWeekStart(_ pref:, tag:), weekOrder(_ start: Int? = nil), weekdayOffset(_ day:, _ start:), fmtInt(_ n: Double) and fmtInt(_ n: JSONValue?) ([AUDIT] -0 gives "0", as `Number(n) || 0` does), localeSample(_ tag:, at:, timeZone:). Constants: defaultLocale, defaultWeekStart, localeChoices, weekStartChoices [(name, day)].
- Port `n.toLocaleString(activeLocale())` as AppLocale.formatNumber(_ n: Double, locale: String? = nil, minimumFractionDigits: 0, maximumFractionDigits: 3), or formatNumber(_ n: Int). Intl semantics exactly: halfExpand rounding of the shortest decimal; -0 is "-0"; NaN and ∞. Fuzzed exact over every region.
- Port date formatting with DateFormatOptions(weekday:year:month:day:hour:minute:second:hour12:dateStyle:timeStyle:), using the JS option names and values ("short", "numeric", "2-digit"). Functions: AppLocale.toLocaleDateString(_ ms: Double, _ opts, locale:, timeZone:), toLocaleTimeString, toLocaleString(date:_:locale:timeZone:), and formatDateTime (Intl.DateTimeFormat().format). Each applies ToDateTimeOptions defaults; an invalid time gives "Invalid Date".
- Only the option sets in DATE_OPTION_SETS (ios/parity/cases/_localeData.js) are exact; they cover every set the web uses today. To add one: append it there, run `node ios/parity/locale-data.mjs`, then `PARITY_ONLY=core.localeData npm run parity:write` and `PARITY_ONLY=core.locale npm run parity:write`. Anything else falls back to Foundation and isn't exact. postingQueue.js tzOffsetMs's formatToParts set isn't in the table: compute offsets with JSDate/TimeZone instead.
- [AUDIT] LocaleData.Names has format-context names (monthsShort/Long/Narrow and weekdaysShort/Long/Narrow, for the M and E tokens) and stand-alone names (standaloneMonths*/standaloneWeekdays*, for L and c). They differ in en-AU ("17 June" in a date, "Jun" alone). LocaleData.render reads y yy M..MMMMM L..LLLLL d dd E..EEEEE ccc..ccccc H HH h hh K KK k kk m mm s ss a.
- LanguageTag(_:) reads a BCP 47 tag the way Intl.Locale does: nil where Intl.Locale would throw; it gives language, script, region, maximizedRegion and isSupported. [AUDIT] Aliases and likely regions now cover every code Intl.Locale reads (dv→MV, la→VA, tw→ak/GH, …), not only the languages Intl formats in. LocaleData.profile(for:) returns the number symbols, patterns, names, firstDay and hourCycle.

TIME, SKY, ROUTER, PREFERENCES
- Time.formatDateShort(_ ms: Double | Date | String, locale:, timeZone:); Time.relativeTime(_ ms, now: Double, ...) (also Date and String overloads; `now` is always passed in); Time.toMs(_ JSONValue?). [AUDIT] JSDate.toMs/Time.toMs read an array as Date.parse of its joined text.
- Sky: enums SkyPhase (dawn/day/dusk/night), SkyChoice (clock plus the phases), Theme (light/dark), Contrast (normal/high). Sky.phaseAtHour(_ Double | JSONValue?), hourOf(_ Date | ms:, timeZone:), skyFor(_ SkyChoice?, dark:, hour:), themeOf, skyColor(_:contrast:).
- Router.hrefFor(_ to:, currentSearch:, keepQuery:); Router.pathParts(_:) throws JSURIError("URI malformed"). [AUDIT] Both now work by UTF-16 code unit.
- Preferences struct (JSON identical to the web's): sky, liveSky, accent (Preferences.Accent), contrast (ContrastChoice), density, period (Preferences.Period: days7 = "7d", days30, days90, year1 = "1y", all, custom), periodFrom, periodTo, sidebar, locale (LocaleChoice: system, enUS…), weekStart (WeekStart). Decoding is lenient.
- Preferences statics: preferencesKey "virga:preferences", defaultPreferences, accentChoices, choices, readPreferences(store:) and readPreferences(raw:) ([AUDIT] now through JSON.parse), normalize(_ JSONValue), writePreferences(_:store:) (writes the web's byte-exact JSON), applyFormats(_:languages:) -> stamp, effectiveContrast(_:systemMore:), rootAttributes(_:dark:moreContrast:hour:) -> RootAttributes.
- @MainActor @Observable PreferencesModel(store: KeyValueStore?, languages: [String], timeZone: TimeZone, systemDark:, systemMoreContrast:, now: @Sendable () -> Date). It holds prefs, systemDark and systemMoreContrast (the view sets these), hour, formats (key views on this) and languages, plus the derived rootAttributes, effectiveSky/Theme/Contrast, skyColor and watchesClock.
- PreferencesModel methods: setPref(\.keyPath, value), setPrefs { $0... }, lookAtClock() (call it each minute while watchesClock is true), and reload() ([AUDIT] it looks at the clock when the sky switches to 'clock'). Its init sets AppLocale's active time zone and formats.
- TEST CONVENTION: any test that changes AppLocale's globals must go inside `extension ActiveFormats { @Suite struct … }`. ActiveFormats is the serialized suite in Tests/VirgaCoreTests/LocaleParityTests.swift. Other tests pass locale and timeZone explicitly.

JS SEMANTICS (Support/)
- JSDate (Support/JSDate.swift), fuzzed exact against V8:
  - JSDate.parse(_ text:, timeZone:) -> Double ms or NaN (a port of V8's Date.parse); toMs(JSONValue?, timeZone:).
  - utc(y, m0, d, h, mi, s, ms) is Date.UTC; local(…, timeZone:) is new Date(y, m, …), with the spec's handling of DST gaps and overlaps, and years 0–99 read as 1900–1999.
  - fields(ms, timeZone:) and utcFields(ms) return Fields {year, month (0-based), date, day (0 = Sunday), hours, minutes, seconds, milliseconds}.
  - Also timezoneOffset, toISOString(ms) -> String? (nil where JS throws), timeClip, makeDay, makeTime, makeDate.
- JSURI: encodeURIComponent, encodeURI, decodeURIComponent and decodeURI (throw JSURIError), searchParams([(String, String)]) and searchParams([String: String]) (URLSearchParams.toString), parseSearchParams(_:) ([AUDIT] now by bytes, per WHATWG, which is what browsers do; Node's string constructor differs next to malformed escapes), searchParam(_:_:), formEncode.
- Coercion and strings: JSNumber.toNumber(String) and JSONValue.jsNumber (Number(x); Optional.none is NaN), String.jsJSONQuoted (JSON.stringify of a string), jsRounded (exact Math.round).
- Fixture helpers: ios/parity/cases/_zones.js exports inZone(zone, fn) and ZONES, for generators that need a local zone (the runner's TZ is UTC).

IDENTITY (Identity/)
- AtUri {authority, collection, rkey} gives each of the web's readings by its regex:
  - AtUri(_:) = postLink's AT_URI (strict; trailing slash allowed).
  - AtUri.parseExact = sources.js; AtUri.parsePrefix = rkeyFromAtUri and analyticsSync.
  - AtUri.authority(of:) = /^at:\/\/([^/]+)\//; did(of:) = didFromAtUri; rkey(of:) = rkeyFromAtUri; collection(of:) = library's collectionOf.
  - description builds the `at://a/c/r` string; AtUri is Codable as a string. Other modules' regexes (postChanges `([^/]+)$`, gates.js, settings.js) must be ported by their own agents.
- DID.isDid (accounts.js), DID.isValidDid (DID_SYNTAX in defense), DID.isAtprotoDid (interactionModel), DID.method.
- Handle.isValidHandle (mentions.js); Handle.normalize ([AUDIT] strips a leading '@' code unit, then jsLowercased: `.replace(/^@/, '').toLowerCase()`); Handle.displayable; Handle.invalid.

STORAGE (Storage/)
- protocol KeyValueStore: Sendable { getItem(_:) -> String?; setItem(_:_:) throws; removeItem(_:); allKeys() }.
  - Extensions: getJSON(_:) -> JSONValue? (JSON.parse exactly), getJSON(_:as:) ([AUDIT] now JSON.parse, then decode), setJSON(_:_:) throws (sorted keys, not byte-exact JSON.stringify), count.
  - Implementations: InMemoryKeyValueStore(_ items:, quota:) with refusesWrites and snapshot; UserDefaultsKeyValueStore(defaults:, prefix: "localStorage:") and init?(suiteName:). Errors: KeyValueStoreError.quotaExceeded and .refused.
  - Keep the web's keys and JSON, and catch setItem errors where the web does.
- protocol FileStore: Sendable { read(_:) async throws -> Data?; write(_:to:) async throws (atomic); delete(_:) (a file or a directory; missing is fine); list(_ dir:) -> [String] (sorted, recursive, relative paths) }. Extensions: exists, readJSON(_:as:), writeJSON(_:to:).
  - Paths are relative and "/"-separated; empty, "." and ".." segments, NUL and backslash throw FileStoreError.invalidPath. [AUDIT] Checked by Unicode scalar, so a combining mark can't hide a '/' or a '..'.
  - Implementations: actor InMemoryFileStore; struct DiskFileStore(baseURL:).

LEXICON (Lexicon/; the rules are in LexiconCoding.swift)
- Field names are the lexicon's. Records conform to LexiconRecord (static nsid; always write `$type`; `extra: [String: JSONValue]` keeps unknown and unreadable fields).
- Required lexicon fields are non-optional, so decoding a record that lacks one throws. Where the web reads malformed records leniently (e.g. the harness's minimal block, listitem and threadgate records, which are only {$type, createdAt}), decode JSONValue and pick fields, as the web does.
- Views use synthesized Codable: unknown fields are dropped, and an optional field of the wrong type fails the whole view.
- Unions are enums with `.unknown(JSONValue)`; a known member that fails to decode also becomes .unknown. View union members keep `lexiconType` ($type as read); unions write it.
- Records: PostRecord, ThreadgateRecord (allow: [ThreadgateRule]?; nil means everyone, [] means nobody), PostgateRecord, LikeRecord, RepostRecord, FollowRecord, BlockRecord, ListRecord, ListItemRecord, ListBlockRecord, StarterPackRecord, ProfileRecord, GeneratorRecord, TemplateRecord (+TemplateVariable); ReplyRef. Also PostRecord(json:), .json(), RepoRecord.decode(T.self), RepoRecord.rkey.
- Embeds and rules: PostEmbed {.images(ImagesEmbed), .video(VideoEmbed), .external(ExternalEmbed), .record(RecordEmbed), .recordWithMedia(RecordWithMediaEmbed), .gallery(GalleryEmbed), .unknown}, MediaEmbed; EmbedImage, VideoCaption, EmbedExternal, GalleryItem, AspectRatio.
  - [AUDIT] EmbedExternal has associatedRefs (what the web writes) and associatedRecords (the lexicon's name).
  - ThreadgateRule {.mention, .follower, .following, .list(String), .unknown}, PostgateRule {.disable, .unknown}, ListPurpose constants.
- Views: ProfileViewBasic, ProfileView, ProfileViewDetailed, ActorViewerState (knownFollowers, mutedByList…), ProfileAssociated, Label.
  - PostView (.postRecord), PostViewerState, ThreadgateView, FeedViewPost, FeedReplyRef (root/parent: PostOrUnavailable {.post, .notFound, .blocked}), FeedReason {.repost, .pin}, ThreadViewPost and ThreadNode (indirect), NotFoundPost, BlockedPost.
  - GeneratorView, ListView, ListViewBasic, ListItemView, StarterPackViewBasic and StarterPackView, LabelerView, Relationship and NotFoundActor (RelationshipResult).
- NotificationView, not Notification (that name is Foundation's). Its cid and isRead are optional because the harness omits them.
- Embed views: EmbedView, MediaEmbedView, EmbeddedRecord {.post(ViewRecord), .notFound, .blocked, .detached, .generator, .list, .labeler, .starterPack}.
- Drafts: Draft, DraftPost (includes the web's own facets/tags/embed/reply/virgaCard fields), DraftEmbed*, DraftView, DraftWithId. Preferences: ActorPreference {.postInteractionSettings, .savedFeedsV2, .savedFeeds, .unknown}.
- Outputs:
  - Repo and identity: ListRecordsOutput, GetRecordOutput, WriteRecordOutput, ApplyWritesInput / Operation / Output / Result, DescribeRepoOutput, ResolveHandleOutput, UploadBlobOutput, ServiceAuthOutput.
  - Video: VideoJobStatus (+Output), VideoUploadLimits.
  - Get*Output for profiles, follows, followers, relationships, list(s), starter pack, author feed, posts, search, thread, feed generator(s), notifications, preferences, bookmarks and drafts. SearchActorsOutput also serves searchActorsTypeahead.
  - DIDDocument (+VerificationMethod, DIDService.endpoint).
- StrongRef(uri:cid:lexiconType: nil) and Facet(…, lexiconType defaults to "app.bsky.richtext.facet") keep $type as read.
- core.lexicon has realistic JSON for all of these (most of it from the harness), for reuse in network and demo tests.

## Known gaps and deliberate differences

- Locale tags in a language other than English format as English in that tag's region (Intl would use the language). The app can't hit this: it only activates LOCALE_CHOICES or en-<region>, and localeSample is only called with those.
- A tag's -u- keywords (fw, rg, hc, nu, ca) are ignored by regionWeekStart, hourCycleOf and formatting: regionWeekStart('en-GB-u-rg-uszzzz') gives 1 where the web gives 0. No tag the app activates carries them; systemLocale drops them.
- V8 quirk: supportedLocalesOf(['tw-US']) is non-empty even though supportedLocalesOf(['tw']) is empty, so Node keeps setActiveLocale('tw-US') and Swift falls back to en-US. Unreachable.
- Multi-subtag language aliases that consume the region (sgn-GB → bfi, sgn-BR → bzs, …) aren't applied: systemLocale(['sgn-GB']) gives en-GB in Swift and en-US on the web.
- The SUNDAY_REGIONS/SATURDAY_REGIONS fallback (for engines without Intl.Locale weekInfo, such as older Firefox) isn't ported. Week starts are weekInfo's data, as Chrome, Safari and Node give them. Noted in the module map.
- Date option sets missing from DATE_OPTION_SETS fall back to Foundation's patterns and aren't exact. To add one: append it to ios/parity/cases/_localeData.js, run `node ios/parity/locale-data.mjs`, then `PARITY_ONLY=core.localeData npm run parity:write` and `PARITY_ONLY=core.locale npm run parity:write`.
- Local time comes from each platform's time-zone database. The Swift 6.4.2 Linux toolchain's bundled data is older than Node's (2026e) for Africa/Casablanca from late 2026. iOS uses Apple's tzdata.
- JSONParseError messages are this port's, not V8's (the web only catches them, never shows them). The error position is V8's UTF-16 offset.
- KeyValueStore.setJSON writes sorted keys, not JSON.stringify's insertion order. Readers can't tell the difference; where the stored bytes themselves must match the web's, write the string yourself (as Preferences.jsonString() does).
- Facet and ByteSlice don't keep unknown fields; every other record-side object keeps them in `extra`.
- Lexicon views use synthesized Codable: an optional field of the wrong type fails the whole view (records keep such a field in `extra` instead). Records are strict on lexicon-required fields; the harness's minimal block, listitem and threadgate records don't decode and must be read as JSONValue, as the web reads them. NotificationView.cid and isRead are optional, unlike the lexicon, because the harness omits them.
- Node's `new URLSearchParams(string)` loses non-ASCII text next to a malformed escape (gives '�' for 'x=é%BF'); browsers and `new URL(...).searchParams` give 'é�'. Swift follows the spec, so fixtures must avoid that combination.
- router.jsx's usePath/navigate/Link and preferences.jsx's DOM stamping and matchMedia are UI, for VirgaUI.
- KeyValueStore.allKeys() has no defined order (the order of localStorage.key(i) isn't reproduced).

## What the audit found and fixed

- high (fixed) src/lib/preferences.jsx readPreferences (JSON.parse(store.getItem(...) || 'null')); every localStorage reader: JSONValue.parse used JSONDecoder, which disagrees with JSON.parse in both directions. It accepts a trailing comma ('{"sky":"dusk",}') and a leading byte-order mark, rejects a lone surrogate escape ('"\ud800"') and 1e400, and keeps the first of two equal keys where JSON.parse keeps the last. So readPreferences, KeyValueStore.getJSON and every later port reading localStorage kept or dropped values the web wouldn't. Added Support/JSONParse.swift, a JSON.parse port: iterative so deep input can't overflow the stack, parse(Data) behaves like response.json() (byte-order mark dropped, bad UTF-8 becomes U+FFFD), lone surrogates become U+FFFD. Held to Node by the new core.jsjson fixture (95 cases) and by 13 new readPreferences cases. A 20,000-text fuzz against Node gives 0 differences.
- high (fixed) FileStore (the web's IndexedDB stand-in): FileStorePath split paths by Character, so a combining mark after a '/' hid that separator inside one segment. '../\u{301}' passed the checks and DiskFileStore wrote outside its base directory. The InMemoryFileStore prefix tests and DiskFileStore.list (hasPrefix and dropFirst by Character) also miscounted names starting with a combining mark. Paths are now checked by Unicode scalar, with a shared scalar-based prefix test. New tests cover both stores, including that nothing is written beside the store.
- medium (fixed) src/lib/locale.js and every toLocaleDateString call with month:'short' (time.js formatDateShort, periods.js, analytics.js, hubModel.js, ...): en-AU writes '17 June 2026' in a date but 'Jun' on its own. The locale table held only the stand-alone month names, so every en-AU date in June or July came out as 'Jun'/'Jul', unlike the web. Its patterns were only checked at March, November, September, January and December instants, so nothing caught it. The table now carries format-context names (M and E tokens) and stand-alone names (L and c), the generator checks patterns at June and July instants too, and the formatDate cases cover every set of names, not only every number format. Fuzzing Intl over every region (283 regions × 29 option sets × 36 instants × 2 zones = 590,904 formats) now gives 0 differences.
- medium (fixed) src/lib/locale.js systemLocale, regionWeekStart: systemLocale and regionWeekStart call Intl.Locale maximize(), which knows about 7,600 language codes, but the table had likely regions only for the roughly 450 languages Intl can format. So systemLocale(['dv']) gave en-US where the web gives en-MV (and Maldives weeks start on Friday); likewise la→VA, ny→MW, gn→PY, tw→GH, cnr→ME, aar→ET. The generator now records the likely region and canonical form of every code Intl.Locale reads, and the fixture has these languages. Probing 1,023 tags left only 8 differences, all unreachable in the app (see gaps).
- medium (fixed) src/lib/router.jsx hrefFor, pathParts: Router.hrefFor looked for '?' with String.contains and pathParts split on '/' by Character. A combining mark after either made it invisible: pathParts('/a/́b') gave one part, and hrefFor('/a?́b') appended the current query. Both now work by UTF-16 code unit, like includes('?') and split('/'). Added 7 router fixture cases.
- medium (fixed) URLSearchParams (used across the network and routing ports): JSURI.parseSearchParams found '?', '&' and '=' by Character (hasPrefix, split, firstIndex), so a combining mark after one hid it. It now works on UTF-8 bytes, as the WHATWG parser does. Added 4 fixture cases.
- medium (fixed) Support/JSONParse.swift (new in this audit): The JSON parser kept open containers in enum frames; popping and rebinding a frame left two references, so every insert copied the container, which is quadratic. A 4.6 MB listRecords-shaped body took 4.5 s in a release build, six times JSONDecoder. Containers are now mutated in place on separate stacks, and strings without escapes are read in one piece: 0.16 s, about a quarter of JSONDecoder's time. A test holds a 100,000-member array and object to well under the time a quadratic parser would take.
- low (fixed) src/posting/lib/postLink.js .replace(/^@/, '').toLowerCase(): Handle.normalize stripped '@' with hasPrefix("@") by Character, so it missed an '@' followed by a combining mark. It also used Swift's lowercased(), which has no final sigma (JS gives 'ΟΔΟΣ'.toLowerCase() = 'οδος', Swift gives 'οδοσ'). Added String.jsLowercased() and jsUppercased() (Support/JSCase.swift, with Unicode's Final_Sigma rule), held to Node by the new core.jsstring fixture (94 cases). normalize now strips the '@' code unit and uses jsLowercased.
- low (fixed) src/lib/locale.js fmtInt: AppLocale.fmtInt(-0.0) gave '-0', but the web's `Number(n) || 0` treats -0 as falsy and gives '0'. -0.4 still gives '-0', as Math.round does. JSON can't carry -0, so this is held by a Swift test rather than a fixture.
- low (fixed) localStorage stand-in: UserDefaultsKeyValueStore.allKeys matched its prefix by Character, so it would omit a key starting with a combining mark. Now matched by scalar, with a test.
- low (fixed) src/lib/time.js toMs: JSDate.toMs (and so Time.toMs) gave NaN for an array, where Date.parse(String(x)) reads its joined text (['2026-11-01'] is that day). Added time fixture cases for an array and a boolean.
- low (fixed) src/lib/preferences.jsx useSkyHour: PreferencesModel.reload() didn't look at the clock when the reloaded sky switched to 'clock'. The web's useSkyHour does that as soon as it starts watching, and setPrefs already did. Fixed, with a test.
- low (fixed) src/posting/lib/embeds.js buildExternalEmbed: EmbedExternal modelled only `associatedRefs`, the name the web writes, and not the lexicon's own `associatedRecords` (it only survived in `extra`). Both are now modelled.
- low (fixed) localStorage readers and writers: KeyValueStore.getJSON(_:as:) decoded with JSONDecoder, so it was looser than JSON.parse. It now parses with the JSON.parse port, then decodes. setJSON's doc claimed it was JSON.stringify; it actually writes sorted keys. The doc now says so.
- low (fixed) ios/parity/modules/core.json src/lib/locale.js: The module map said locale.js was fully ported with no note, but two branches differ by design: the SUNDAY/SATURDAY_REGIONS fallback (for engines without Intl.Locale weekInfo) and -u- keywords. Added a note saying so. Also corrected a JSDate comment that called V8's ten-day grace window 'a day'.
- medium (open) src/posting/lib/embeds.js buildExternalEmbed; src/posting/lib/linkCard.js normalizeAssociatedRefs; src/posting/schedule/scheduleSerialize.js; src/posting/drafts/drafts.js; harness/fakeServer.js: WEB BUG, reported, not fixed. The web writes link-card records under `external.associatedRefs`, but the lexicon (@atproto/api 0.19.19, app.bsky.embed.external#external) names the field `associatedRecords`, so the AppView won't see the refs or hydrate the richer card. The harness (fakeServer.js) uses the web's name too.
- low (open) src/posting/pages/scheduleModel.js slotLabel; src/defense/DefenseLists.jsx: WEB BUG, reported, not fixed. slotLabel calls toLocaleTimeString(undefined, ...) and DefenseLists calls toLocaleTimeString([], ...), so both format in the browser's own locale rather than activeLocale() like the rest of the app. On an Arabic browser '17:30' becomes '٥:٣٠ م' inside English copy.
- low (open) src/shell/routes.js parseRoute; src/posting/routes.js parsePostingRoute; src/lib/time.js relativeTime; src/lib/locale.js systemLocale: WEB BUGS reported by the porter, confirmed. (1) parseRoute and parsePostingRoute call pathParts without try/catch; pathParts('/bad/%') throws 'URI malformed' (in the fixture), so a malformed escape in the address throws while rendering. (2) relativeTime returns 'just now' for any future date (fixture case 'future'). (3) systemLocale's supported(`en-${region}`) check is always true, so systemLocale(['xx-YY']) gives 'en-YY'.
