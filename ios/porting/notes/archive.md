# archive: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited (2026-11-21).
Parity cases at port time: 3458, plus 4 added by the audit.
Tests at the time: Whole package: `swift test` passes, 952 tests (79+57+190+99+79+69+77+176+126 across the 9 test binaries), and a clean `swift build --build-tests` has no warnings beyond the existing VirgaDemo README one. VirgaArchiveTests: 126 tests in 16 suites, up from 116 in 14. New suites are AnalyticsStoreConcurrency (2 tests, over SlowFileStore) and SyncCalledOffInFlight (4 tests, replaying every called-off recorded case for followers, follows, notifications and likes through InFlightAbortTransport). New ArchiveModelBehaviour tests: callingASyncOffWhileFollowersAreAskedForBanksThemWithoutAnError, callingASyncOffWhileTheProfileIsReadStillMeasuresByIt, callingASyncOffWhileThePDSIsLookedUpEndsInTheRepoStep and aMountStoppedBeforeItsStoreOpensDoesNothingMore, plus assertions for a re-noted post and nowMs before mount. Each new test was checked to fail without its fix. `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity`: 4 files, 119 tests pass (fixtures fresh). `npx eslint ios`: clean. `npm run parity:drift`: no drift. Commits on ios/w5-b: e5cc1e1, ed23857, 1316912, 9d2470b, 12d9766.

## API for the code that builds on it

All in target VirgaArchive (import VirgaArchive), ios/VirgaKit/Sources/VirgaArchive/.

CONVENTIONS
- Times are epoch ms as Double.
- Every local-time function takes `timeZone: TimeZone = AppLocale.activeTimeZone()`. Words take `locale: String? = nil` (the active locale). Weeks take `weekStart: Int? = nil` (the active start).
- Strings compare by code unit (JSKey/jsEquals).
- Rows convert by hand to and from the web's JSON (`init?(json:)`, `.json`); Codable goes through those.

ROWS (Lib/AnalyticsRows.swift)
- protocol ArchiveRecord: Codable, Hashable, Sendable {init?(json:), json}. protocol ArchiveTimed {atValue: JSONValue?}; JSONValue conforms, reading ["at"].
- PostRow {uri, rkey?, at: String?, text?, len: Int?, replyTo?, quoteOf?, hasMedia: Bool?, media?, mediaCount?, altCount?, tags/links/mentions/langs: [String]?, threadOf?, threadKey?, likes/reposts/replies/quotes: Int, atMs: Double?, extra}. len == nil means a shape-1 row.
- EngagementEvent {uri, did, kind, at: JSONValue? (normally .string), subject: String?, extra; atText}, for inbound and outbound events.
- FollowerRow {did, handle, displayName, avatar ("" when absent), followedAt?}.
- FollowingRow {uri, did, followedAt?}.
- BlockRow {uri, did, source?, listUri?, blockedAt?}.
- ListInfo {uri, owner, name, purpose ('moderation'|'reference'|'curation'), memberAt?, subscribers: Int?}.
- ActorCard {did, handle?, displayName?, avatar?, at: Double?, lastActiveAt?, gone?, activityAt?}.
- VirgaRepo's AtmosphereRow gains `json` and `init?(json:)`.

ANALYTICS (Lib/Analytics.swift, enum Analytics)
- Constants: postRowVersion = 2; analyticsPeriods [AnalyticsPeriod]; engagementKinds and eventKinds [AnalyticsKind{key,label}].
- enum AnalyticsUnit {day, week, month} with init(_ raw: String?); an unknown string is day.
- engagementOf(_ PostRow?, _ kind = "all") -> Int.
- bucketStartMs(_ t: Double|JSONValue?, _ unit, timeZone:, weekStart:) -> Double (NaN for none); nextBucketMs takes the same.
- bucketSeries(_ items: [T]?, unit:, t0:, t1:, timeZone:, weekStart:, pickTime: (T) -> JSONValue?, pickValue: ((T) -> Double)?) -> [SeriesPoint{t,v}]. An overload for T: ArchiveTimed drops pickTime.
- cumulativeSeries(_:_ baseline).
- blockReach(_ [BlockRow]?, timeZone:) -> BlockReach{people: [BlockPerson{did, direct, list, source, blockedAt?}], directCount, listCount, listOnlyCount, overlapCount}.
- movingAverage(_:_ window = 7) -> [SeriesPoint]. [AUDIT] A NaN window gives NaN values, as on the web.
- comparePeriods(_ items, days: Double?, now:, timeZone:, pickTime:, pickValue:) -> PeriodComparison{current, previous, delta, pct?}, with an ArchiveTimed overload.
- isOwnVoicePost(_:_:).
- rateSeries(_ [PostRow]?, unit:, t0:, t1:, kind:, timeZone:, weekStart:) -> [RatePoint{t, v?, total, posts}].
- rollingRate(_:_ window) -> [TrendPoint{t, v?}]. [AUDIT] A NaN window gives nil throughout.
- compareRates(_:days:now:kind:timeZone:) -> RateComparison{current?, previous?, pct?}.
- givenEvents(_ outbound:_ posts:_ ownerDid:) -> [EngagementEvent].
- topPosts(_:kind:t0:t1:limit:timeZone:) -> [PostRow].
- topActors(_ [E: ArchiveEventLike]?, kind:, t0:, t1:, limit: 12, excludeDid:, timeZone:) -> [TopActor{did, total, byKind}]. EngagementEvent and JSONValue conform to ArchiveEventLike.
- didFromAtUri(String?|JSONValue?); linkHost(String?|JSONValue?).
- upgradePostRows(_:_ [JSKey: JSONValue]?, timeZone:).
- compactPostFromFeedItem(_ JSONValue?, timeZone:) -> PostRow?; compactPostFromRecord(_ uri:_ record:timeZone:).
- inboundFromNotification(_:timeZone:) -> EngagementEvent?; outboundFromRecord(_ kind:_ record:timeZone:); outboundFromPosts(_:).
- unitChoicesFor/defaultUnitFor(Double?) -> AnalyticsUnit(s).
- fmtCompact(_ Double?, locale:); fmtDelta(_ Double?); bucketLabel(_ t:_ unit:locale:timeZone:).
- oldestEventMs(_ [T: ArchiveTimed]?, timeZone:) -> Double?; dateValue (new Date(v)); timeOf.
- AnalyticsPeriod {key, days: Int?, label, start?, end?, from?, to?, custom: Bool?; isCustom}. Insights' CommandContext.Period mirrors it; pass Analytics.analyticsPeriods.

PERIODS (Lib/Periods.swift, enum Periods)
- defaultPeriodKey; customPeriod (the constant "custom").
- presetPeriod(_ String?); dayStartMs(_ String?|JSONValue?, timeZone:); dayKey(_ ms, timeZone:).
- rangeLabel(_ from:_ to:_ joiner = " – ", locale:, timeZone:).
- customPeriod(_ from:_ to:_ nowMs:, locale:, timeZone:) -> AnalyticsPeriod?.
- resolvePeriod(period:periodFrom:periodTo:nowMs:locale:timeZone:) and resolvePeriod(_ Preferences?, nowMs:...).
- periodEnd(_:_ nowMs); periodStart(_:_ nowMs) -> Double?.
- periodPhrase(_:locale:timeZone:); periodLine(_:_ nowMs:locale:timeZone:); periodWindowWord(_:); periodBefore(_:_ capital = false).

CHARTS (Charts/ChartFormat.swift, enum ChartFormat)
- niceScale -> NiceScale{min, max, step}.
- chartScale(_ min,_ max, zeroBase = true, bars = false) -> ChartScale{min, max, ticks, labelled}.
- axisStops(_ [SeriesPoint], _ unit, locale:, timeZone:) -> [AxisStop{i, text, anchor}].
- trendName(_ series, _ trend [TrendPoint] or [SeriesPoint], _ unit).
- heatSteps(_ [Double?]) -> HeatSteps (entries in the Map's order; subscript(Double?) -> Int?).
- fmtTick, clamp, fmtCount, fmtRate, fmtAverage, fmtFigure(_:decimals:locale:), unitLabel, unitNoun, deltaText (all take locale:).
- jsMax/jsMin (internal) are JS Math.max/min.

SMALL MODULES
- SyncProgress (Lib/SyncProgress.swift): syncSteps [(key, SyncStepInfo{label, doing})], syncStep(_:), syncPlan, share(Double?|Int?, ...), blockStages, blocksFraction(_ BlocksProgress?, directEstimate:), repoSpans, repoReadStages, repoDownloadFraction, repoReadFraction(_ RepoCarReadProgress?, expectedRecords:), repoSaveFraction, countAtOrAfter, walkFraction, timeFraction, partsFraction. BlocksProgress {stage, fetched, done, total?}.
- FollowerLog (Lib/FollowerLog.swift): followerLogLimit; followerChanges(_ before:_ after:at:since:) -> [FollowerLogEntry]; mergeFollowerLog(_ FollowerLogRecord?, _ changes, _ at) -> FollowerLogRecord{entries, lastSyncAt, firstSyncAt}.
- PostChanges (Archive/PostChanges.swift): isOwnPostUri(_ did:_ uri:); postRowsFor(_ did:_ [PostedItem]?, timeZone:); applyPostChanges(_ posts:rows:removed:) -> [PostRow]? (nil = unchanged). PostedItem {uri?, cid?, record?; init(json:)}.
- [AUDIT] applyPostChanges compares scalars by value and lists or objects never as equal, as the web's !== does for the new rows its callers pass. A held post noted again with lists reads as changed and is written again; rows without lists compare member by member.

EXPORTS
- AnalyticsExport (Lib/AnalyticsExport.swift): exportFormat, exportVersion, storeKeys, notes.
  - archiveJson(_ ArchiveData?, did:, handle:, actors: [ActorCard], now:) throws -> String; throws ExportTimeError "Invalid time value".
  - postsCsv(_ [PostRow]?, did:, handle:, timeZone:); exportFilename(_ handle:_ what:_ ext:now:timeZone:).
- ArchiveExports (Archive/ArchiveExports.swift): fileStem(handle:did:); exportArchive/exportPosts/exportRows(...) -> ExportFile{text, filename, type; data}; downloadText(_:_:_:) -> ExportFile.

STORE (Lib/AnalyticsStore.swift)
- protocol AnalyticsStoreHandle: AnyObject, Sendable {persistent, blocked, all(_ store) async -> [JSONValue], putAll(_:_ rows:), remove(_:_ keys: [JSONValue]), clear(_:), getMeta(_ key) -> JSONValue?, setMeta(_ key:_ facts: JSONValue)}.
- enum AnalyticsStore: dbVersion = 1; rootDirectory "analytics"; stores [(name, keyPath)]; analyticsDbName(_ did).
  - openAnalyticsStore(_ did: String?, files: (any FileStore)?, registry: AnalyticsStoreRegistry = .shared) async -> any AnalyticsStoreHandle.
  - resetAnalyticsStore(registry: = .shared): synchronous, nonisolated.
  - deleteDatabase(_ name: String, files:, registry:) async -> Bool.
- Implementations: actor FileAnalyticsStore (files under analytics/<encodeURIComponent(name)>/) and actor MemoryAnalyticsStore(blocked:). [AUDIT] FileAnalyticsStore serves calls one at a time, first in first out, so writes made at the same time all land.
- final class AnalyticsStoreRegistry (.shared, init()).
- SESSION WIRING (the other chain):
  - SessionEnvironment.resetAnalyticsStore = `{ AnalyticsStore.resetAnalyticsStore() }` (fits `@MainActor () -> Void`).
  - SessionEnvironment.deleteDatabase (`@Sendable (String) async -> Bool`) should send names starting "virga-analytics:" to `await AnalyticsStore.deleteDatabase(name, files: appFileStore)` (returns Bool), and other names (virga-posting:) to the posting store.

SWEEPS (Lib/AnalyticsSync.swift, enum AnalyticsSync)
- caps; actorTtlMs; followFromRecord(_ JSONValue?) -> FollowingRow?.
- sweepFollowers(agent: XRPCAgent, did:, clock:, onProgress:) -> SweepFollowersResult.
- sweepFollowing(agent:did:clock:onProgress:) -> SweepFollowingResult.
- sweepBlocks(did:transport:clock:timeZone:onProgress: (BlocksProgress)) -> SweepBlocksResult{blocks, lists, complete, truncated, aborted, error}.
- sweepPosts(did:knownUris: Set<JSKey>?, rehydrateSinceMs: Double = .infinity, resumeCursor:, transport:, clock:, timeZone:, onPage: ([PostRow], SweepPageInfo{cursor}), onProgress:) -> SweepPostsResult{fetched, complete, aborted, cursor, error}.
- sweepInbound(agent:cutoffMs:knownUris:coveredToMs:clock:timeZone:onPage:onProgress:) and sweepOutbound(agent:did:...) -> SweepEventsResult{events, fetched, reachedMs, complete, truncated, aborted, error}.
- hydrateActors(_ [String?]?, cache: [JSKey: ActorCard], now:, transport:, clock:) async -> [ActorCard] (fresh cards only).
- Callbacks are `@Sendable (...) async -> Void`; pass `{ @MainActor p in ... }`. SweepProgress {fetched, reachedMs?, part?, parts?}. AnalyticsSyncError {message}.
- Cancellation is the web's abort. [AUDIT] The Agent's reads (followers, follows, notifications, likes/reposts) carry no signal on the web and run in a task of their own here (internal AnalyticsSync.unaborted): calling a sweep off lets the request already out finish, keeps its page, and reports aborted without an error.

MODEL (Archive/ArchiveModel.swift, ArchiveModel+Sync.swift, ArchiveData.swift)
- `@MainActor @Observable final class ArchiveModel(agent: XRPCAgent?, did: String, handle: String?, environment: ArchiveEnvironment)`.
- ArchiveEnvironment(files: (any FileStore)?, registry: = .shared, transport: = HTTP.transport, clock: = HTTP.clock, didDocuments: PromiseCache<JSONValue> = Atproto.didDocumentCache, timeZone:, locale:, postsChanged: PostsChangedListener?).
- PostsChangedListener = `@Sendable (did, @escaping @Sendable (JSONValue) -> Void) -> (@Sendable () -> Void)`. The app wires `{ did, fn in (try? PostingEvents.onPostingEvent(PostingEvents.postsChangedEvent, did: did, fn)) ?? {} }` (VirgaPosting; exact constant name per the posting-text notes).
- State:
  - data: ArchiveData {loaded, persistent, blocked, posts, followers, following, blocks, inbound, outbound, atmosphere, meta: ArchiveMeta, rev, followRev}.
  - actors: ActorCards {cards, subscript(did), byDid, count}.
  - sync: SyncState? {plan, done, failed, step?, fraction?, detail, doing?}; syncError: String?.
  - nowMs: [AUDIT] clock.now() at init, then moves with each change of data.rev.
  - isBuilt, isSyncing, did, handle, agent.
- Actions:
  - start() async: the mount. Opens the store, reloads, listens, and auto-resumes or tops up; cancel the call to call the sync off.
  - stop(): [AUDIT] also marks the mount, so a start() still waiting for its store does nothing more; a later start() mounts again from scratch.
  - runSync(_ SyncMode = .incremental | .full | .resume) async; cancelSync(). [AUDIT] The profile read up front outlives a call-off, as on the web.
  - setFollow(_ subject: String?, _ on: Bool) async throws; notePosted(_ [PostedItem]) async; noteDeleted(_ [String]) async.
  - wantActors(_ [String?]) async; checkActivity(_ [String?], onProgress:) async -> Int; deleteArchive() async.
  - exportArchive() throws -> ExportFile; exportPosts(_ [PostRow]?) -> ExportFile; exportRows(_ what:_ rows: [[JSONValue?]]) -> ExportFile.
- ArchiveMeta {posts, followers, following, blocks, inbound, outbound, repo, lists: ArchiveMetaRecord?, followerLog: FollowerLogRecord?, read; json; init(json:)}.
- ArchiveMetaRecord is the stored JSON with typed views (syncedAt, complete, cursor, shape, count, profileCount, pathCount, version, rev, bytes, coverageMs, truncated, lists) and updating(_:).
- ArchiveContext.isBuilt(_ ArchiveData).
- Constants: ArchiveModel.autoSyncAfterMs, rehydrateDays, eventDepthDays, archiveStores.

TEST HELPERS (Tests/VirgaArchiveTests, internal)
- ArchiveTestSupport.swift: num and markers for '$NaN'/'$Infinity', js(), recorded(), encoded(), exactDiff, forEachCase, rows/json.
- SyncParityTests.swift: AbortingTransport (callOff cancels the sweep's own task), SweepLog, replaySweep.
- SyncCancellationTests.swift: InFlightAbortTransport, which fails a request whose task is cancelled, as URLSession does.
- ArchiveModelParityTests.swift: StepTransport (callOff = the model's cancelSync) and StepClock, one recording per step.
- AnalyticsStoreTests.swift: FailingFileStore and SlowFileStore.
- Generators: ios/parity/cases/archive.*.js, with shared helpers in _archive.js (under(zone/locale/weekStart), local, LOCALES, numbers/eachN markers). archive.model.js runs the web hook under a stand-in for React's useState/useRef/useEffect (vi.doMock('react')), evicts atproto.js's DID-document cache per scenario, and pins `new Date()` to Date.now. In archive.progress.js, applyPostChanges cases pass new row objects, as the app does.

## Known gaps and deliberate differences

- src/archive/exports.js is partial: downloadText's browser download (Blob URL, anchor click, revoke timer) belongs to VirgaUI. ArchiveExports returns an ExportFile for fileExporter/ShareLink.
- src/archive/ArchiveContext.jsx is partial: ArchiveProvider/useArchive are React context. VirgaUI puts the account's ArchiveModel in the SwiftUI environment (one model per signed-in DID) and calls start() from .task and stop() from .onDisappear. The provider's profile comes from the session.
- Cross-chain wiring left for the merge: VirgaSession's resetAnalyticsStore closure (`@MainActor () -> Void`) becomes `{ AnalyticsStore.resetAnalyticsStore() }`. Its deleteDatabase closure (`@Sendable (String) async -> Bool`) must send 'virga-analytics:<did>' names to `await AnalyticsStore.deleteDatabase(name, files: appFileStore)` and other names to the posting store. ArchiveEnvironment.postsChanged must be wired to VirgaPosting's posting events bus (VirgaArchive can't import VirgaPosting).
- Rows are typed: a field of the wrong type reads as absent (a non-string createdAt or post.uri, which the web keeps or throws on), and counts are whole Ints (a fractional or string likeCount is truncated or 0). Lexicon-valid answers never hit this.
- The store keys rows only by string or number keyPath values (IndexedDB also takes dates, arrays and binary); other rows are skipped. The wait for a database blocked by another tab has no iOS case, so `blocked` is always false. deleteDatabase also forgets a memoized memory fallback, which the web keeps until resetAnalyticsStore.
- archiveJson writes the document's own members in the web's order but sorts the members inside rows and meta (the web keeps insertion order). Readers can't tell.
- sweepBlocks keeps Lists you're on in the order the lists were asked for. That is the web's order when answers arrive as fast as they're asked (arbitrary on both sides under real concurrency). After a failed check, Swift cancels the other checks where the web lets them run and report.
- HTTPTransport returns whole bodies, so the repo CAR's download progress is reported once, as one chunk (the web's stream reports per chunk).
- linkHost uses VirgaNetwork's WebURL, whose non-ASCII (IDNA) host handling is approximate. VirgaPosting's exact WHATWGURL can't be imported here (noted in the network notes for the merge).
- topActors' byKind is [String: Int] (canonical-equivalence keys). Two notification reasons that differ only by normalization would merge; that can't happen with the reasons the archive keeps.
- Africa/Casablanca after 2027 buckets an hour off on the Linux toolchain (older bundled time-zone data than Node's); iOS uses Apple's data.
- The sync bar's copy matches the web word for word, including 'Saving the repo to this browser'. VirgaUI may want to raise that with the web owners rather than change it on one side.
- No generator records the sync against VirgaDemo's DemoWorld (optional in the brief). archive.model uses its own small made-up accounts built with harness/buildCar.js.

## The audit (2026-11-21)

- **high**, src/lib/analyticsStore.js idbHandle (putAll/remove/clear/getMeta/all); Swift Lib/AnalyticsStore.swift FileAnalyticsStore: FileAnalyticsStore is an actor, and its calls await the file store partway through, so a second call could start while the first was still waiting. Two writes to the same store then read the same cached state and the same segment number. The second segment file overwrote the first on disk, and the second state replaced the first in memory, so rows were lost silently. This happens in normal use: a post made while a sync writes pages, wantActors's background write landing during checkActivity, or a write during the first read of a store. The new test AnalyticsStoreConcurrency.writesMadeAtOnceAllLandAndSurviveARestart, run over a SlowFileStore, kept 2 of 12 concurrent writes. Fixed with a first-in, first-out gate (enter/leave, checked continuations) so calls run one at a time in order, as IndexedDB runs one connection's transactions. The closed flag is checked again once a call gets through the gate. Two concurrency tests cover it.
- **medium**, src/lib/analyticsSync.js sweepFollowers, sweepFollowing, sweepInbound, sweepOutbound (the Agent calls get no signal): The web passes the AbortSignal only to fetch and Constellation. Its Agent reads (getFollowers, listRecords for follows and likes/reposts, listNotifications) carry no signal, so cancelling a sync while one is in flight lets that request finish: its page is kept (notifications are banked) and the sweep stops at the top of the next page with aborted: true and no error. In Swift, task cancellation cancelled the request through URLSessionTransport (CancellationError). The sweep then returned error 'This operation was aborted', the model's syncError showed 'followers: This operation was aborted' after the person pressed Cancel, and the page was dropped. The parity tests missed this because AbortingTransport cancelled after answering, which the real transport doesn't do. Fixed: those requests run in a task of their own (internal AnalyticsSync.unaborted). The replay transports (AbortingTransport, StepTransport) now cancel the sweep's or model's own task through a callOff hook (the model one calls cancelSync, as the generator does). New suite SyncCalledOffInFlight replays every recorded called-off case through InFlightAbortTransport, which fails cancelled requests the way URLSession does. Model test callingASyncOffWhileFollowersAreAskedForBanksThemWithoutAnError.
- **low**, src/archive/postChanges.js applyPostChanges/sameRow, via useAnalyticsArchive.js applyPosts: sameRow compares members with !==, so on the web a row's tags, links, mentions and langs lists are compared by reference. The rows a post is noted with always come fresh from postRowsFor, so a post the archive already holds, noted again, always reads as changed: it is written again and data.rev moves, which also moves nowMs. The Swift port compared lists by value and reported it unchanged. It now treats lists and objects as never equal and compares scalars by value (strings by code unit). The fixture's 'same-row' and 'counts-differ' cases relied on shared object references, which JSON can't carry. They now pass new objects, as the app does (structuredClone). New cases 'same-row-without-lists' (unchanged) and 'row-without-lists-edited' cover the member-by-member path. The behaviour test hearsOfPostsMadeAndDeletedElsewhere now covers a re-noted post (rev + 1, counts kept). The module map note is updated.
- **low**, src/archive/useAnalyticsArchive.js runSync getProfile(did) (no signal): The web's profile read at the start of a sync can't be called off. In Swift it was cancelled, so prof was nil and the followers step began without the counter to measure against (fraction null, not 0). The read now runs in its own task. Test callingASyncOffWhileTheProfileIsReadStillMeasuresByIt. resolvePds already outlives a call-off, because the DID document cache reads in its own task. Test callingASyncOffWhileThePDSIsLookedUpEndsInTheRepoStep holds that: the repo step begins and the blocks step is closed, as on the web.
- **low**, src/archive/useAnalyticsArchive.js mount effect (`cancelled` flag): On the web, a store that finishes opening after the hook unmounted is neither read nor listened to. Swift start() only checked its own task's cancellation, so stop() during the open, without cancelling start's task, still read the store, registered the posting-events listener and could auto-sync. stop() now marks the mount (a mounts counter), and a later start() mounts again from scratch. Test aMountStoppedBeforeItsStoreOpensDoesNothingMore.
- **low**, src/lib/analytics.js movingAverage, rollingRate: With a NaN window the web's bounds are all NaN: movingAverage gives NaN values (0/NaN), and rollingRate runs no loop, so every v is null. Swift read NaN as a half-window of 0 and returned the series itself or a rate. halfWindow now returns nil for NaN and both functions follow the web. Fixture cases 'window $NaN' were added to both.
- **low**, src/archive/ArchiveContext.jsx nowMs = useMemo(() => Date.now(), [archive.rev]): The context's nowMs is the time of the first render. ArchiveModel.nowMs was 0 until the first read of the store. It is now set from environment.clock.now() in init. Test added in aFirstBuildIsAButtonNeverASurprise.
- **low** (left as the web has it), src/lib/analytics.js bucketStartMs/nextBucketMs, src/lib/periods.js (local calendar): I fuzzed outside the fixtures against Node: 32,500 random inputs to niceScale, chartScale, fmtTick, deltaText, fmtRate, fmtAverage, fmtFigure, fmtCompact, fmtDelta, linkHost, didFromAtUri and compactPostFromRecord, all matching. I also ran 9,000 bucket, period and series cases across 13 zones, week starts 0, 1, 5 and 6, 5 locales and 1970 to 2040. These match except 123 Africa/Casablanca cases after 2027: the Linux toolchain's bundled time-zone data is older than Node's, a known platform gap already in the core notes (iOS uses Apple's data). Nothing to fix in code.
- **low** (left as the web has it), src/lib/analyticsSync.js sweepBlocks check stage (mapConcurrent + Promise.all): WEB BUG, reported, not fixed. When one list check fails, Promise.all rejects and the sweep returns, but the other workers keep running and keep calling onProgress with 'check' reports. These can still move the blocks segment of the bar until the repo step begins. Swift's task group cancels the remaining checks, so no stray reports follow (Lists you're on holds only the checks answered before the failure on both sides).
- **low** (left as the web has it), src/archive/postChanges.js sameRow / applyPostChanges: WEB BUG, reported, not fixed (the port keeps it). The comment and the web's own test ('returns the same list when nothing changes') mean 'unchanged' to skip the write. In the app, the rows are always new objects with lists, so the unchanged path is never taken for a held post noted again: every re-note writes the row again and bumps rev. The web test passes only because it hands the same object in as both the held row and the noted row.
- **low** (left as the web has it), src/lib/analyticsSync.js sweepFollowers/sweepFollowing/sweepInbound/sweepOutbound: WEB BEHAVIOUR worth raising, not fixed (the port keeps it). The Agent's reads get no AbortSignal, so Cancel waits for the request already out, with no limit but the Agent's own, before the sync stops.
