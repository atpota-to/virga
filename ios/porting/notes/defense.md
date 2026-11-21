# defense: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited. The pure engine in an earlier wave; harvest, scan, veto, the service calls, the page model and the hooks on 2026-11-21 (the section at the end, which supersedes this file's remarks that call them pending).
Parity cases at port time: 1604, plus 886 added by the audit.
Tests at the time: The whole package passed swift test: VirgaDefenseTests 77 tests in 11 suites (2 new behaviour tests, both confirmed to fail on the porter's scorer), VirgaCoreTests 126 tests in 25 suites, and the placeholder targets. PARITY_ALLOW_PENDING=1 npx vitest run ios/parity passed (36 tests), npx eslint ios is clean, and the generators pass prettier --check. The defense-early fixtures went from 1,604 to 2,490 cases. Fuzz runs not kept in the fixtures also matched: 20,000 parseCommand, 6,667 parsePostScan, 6,667 parseActor and 200,000 trustScore. Commit aca8e84 on ios/w2-early-defense, not pushed.

## API for the code that builds on it

All files are in ios/VirgaKit/Sources/VirgaDefense/. Import VirgaDefense; it builds on VirgaCore's JSONValue, AppLocale, JSDate, DID and Locked.

TYPES (Codable, Hashable, Sendable, with the web's field names, so they encode to the web's JSON)
- Score+Types.swift
  - Band: enum with cases .protected, .connected, .peripheral, .notable, .unknown; raw values "PROTECTED" etc. It is CaseIterable in BANDS order and CodingKeyRepresentable, so [Band: Int] encodes as an object.
  - Band.named(_:) matches a string by code unit. Use it for untrusted text, never Band(rawValue:), which folds the Kelvin sign.
  - VouchCheck: .canary or .unavailable.
  - Thresholds: decoding fills missing fields from the defaults. Score.defaultThresholds is the default value.
  - Features: vouches, followers, follows, posts (all Double); ageDays and postsPerDay (Double?); mutual, followsYou, youFollow (Bool); protectedReason (String?). Decoding is lenient.
  - AccountScore: what one entry of scores.get(did) holds: did, handle, displayName, avatar, missing, band, trust (Int), alreadyListed, blocksYou, plus every Features field flattened. It has a .features property.
  - ScoreResult: scores ([String: AccountScore]) and vouchCheck.
  - ScanRow: the participant joined to its score, `{...p, ...score}`. It holds a Participant and an AccountScore?, and encodes flat; nil means unscored, with band UNKNOWN only. Accessors: did, band, trust (Int?), youFollow, followsYou, alreadyListed, blocksYou, followers, handle, displayName, avatar, primary.
  - SummaryTotals: participants, engagements, records, byBand ([Band: Int]), reviewReach, alreadyListed, blocksYou.
  - ScanSummary: uri, harvestedAt, truncated, unread, vouchCheck, totals, rows, requiresReview, autoEligible.
  - ScoreError: code (.read or .vouches), message (the web's sentence; it is also the LocalizedError text), cause.
  - protocol HTTPStatusError: Error { var httpStatus: Int? }. Wave 2 should make VirgaNetwork's errors conform: Score.retryable reads the status from it. An error without a status counts as no answer, so it is retried, and CancellationError is never retried.
- Harvest+Types.swift: Harvest (uri, harvestedAt?, sources?, participants, totals, truncated, unread?), Participant (did, engagements [String: Int], records, total, primary?), EngagementRecord (kind, rkey?, collection?), HarvestSource (collection, path, source, count, distinctDids?, kind, truncated, failed), HarvestTotals (participants, engagements, records?), UnreadKind (kind, count). The wave-2 harvest port should build these.
- Scan+Types.swift: ScanPost (uri, authorDid); ScanResult (summary, post, canary?, startedAt, finishedAt), which encodes flat like the web's `{...summary, post, canary, startedAt, finishedAt}`; ScanStageReport (stage, done?, total?); typealias ScanStageHandler = @Sendable (ScanStageReport) async -> Void. A wave-2 runScan must await onStage.

SCORE (Score.swift, Score+Scorer.swift)
- typealias GetProfiles = @Sendable ([String]) async throws -> [JSONValue]. It returns res.data.profiles from the signed-in getProfiles, read loosely as the web reads them. It should respect task cancellation (the web's signal).
- typealias GetRelationships = @Sendable (_ ownerDid: String, _ dids: [String]) async throws -> [JSONValue]. It returns the `relationships` list.
- Constants: Score.profileBatch (25), relBatch (30), bands, defaultThresholds, retryDelaysMs ([1000, 3000]), canaryBatches (4).
- Functions:
  - trustScore(vouches:followers:ageDays:mutual:followsYou:) -> Double (the exact JS value, NaN included); trustScore(_ Features).
  - assignBand(_ Features, _ Thresholds = default) -> Band.
  - knownFollowersOf(_ JSONValue?) -> Double?.
  - retryable(_ Error) -> Bool.
  - findCanary(ownerDid:candidates:getProfiles:maxBatches:retryDelaysMs:) async throws -> String?.
  - createScorer(ownerDid:getProfiles:getRelationships:canary:refindCanary:protectedSet [did: reason]:selves:alreadyListed:blockers:thresholds:retryDelaysMs:concurrency:now: @Sendable () -> Date:timeZone: TimeZone?) throws -> Scorer. It throws CreateScorerError when the owner is empty. timeZone nil means AppLocale.activeTimeZone(); it is the zone a createdAt with no offset is read in.
  - withoutSelves(_ Harvest, _ [String?]) -> Harvest.
  - summarise(_ Harvest, _ [String: AccountScore], vouchCheck: = .canary) -> ScanSummary.
- actor Scorer: score(_ dids, onProgress: (@Sendable (Scorer.Progress) async -> Void)?) async throws -> ScoreResult. It also exposes vouchCheck and activeCanary.
  - onProgress hears of each profile batch as it lands, one report at a time, always counting up (as the web's synchronous callback), and every report is delivered before score returns or throws.
  - Cancelling the task is the web's signal.abort: it throws CancellationError and also cancels a canary re-pick in flight (refindCanary should respect cancellation).
- Wave 2: port publicRelationships(fetchImpl, appview) as a GetRelationships, and make it the default for createScorer and runScan.

OTHER MODULES
- Limit.swift: Limit.appviewConcurrency (6); mapLimit(_ items, _ limit, _ fn: @Sendable (T, Int) async throws -> R) async throws -> [R]; chunks(_:_:) (size must be at least 1); pause(_ ms) async, which never throws and returns early when the task is cancelled.
- Pace.swift: Pace.batch, batchGapMs, rateLimitHoldMs, pointsPerCreate, pointsPerHour.
- BandWords.swift: BandWords.bandWord, bandMeans, bandCounted, each [Band: String].
- Plan.swift: Plan.approvableBands, defaultBands, planMax, noteMax, batch, batchGapMs; planRows(_ ScanSummary?, _ [Band]?, listed: Set<String>) -> [PlanRow(did, band, trust?)]; bandCounts(_:listed:) -> [Band: Int]; estimateWrites(_ Double | Int) -> WriteEstimate(writes, points, minutes); estimateWords(_ n, locale: String? = nil); cleanNote(_ String?) -> String?.
- HistoryModel.swift: DefenseDecision (the server's publicDecision: id, listId, planId, did, action, band?, trust?, via, note, state, reason, createdAt, actedAt, undoneAt, undoes; action and state are plain Strings), PlanCounts, DefensePlan (history.js plans; every field optional), PlanOutcome (added, waiting, kept, failed, undone, live, line). Functions: HistoryModel.decisionPhrase(_:), planOutcome(_:locale:).
- Radar.swift:
  - Types: Ring (.protected, .connected, .peripheral, .outer; raw values "OUTER" etc.), SectorSlice, RadarPoint (id, band, sector, row: ScanRow?), PlacedPoint (point plus ring, x, y, r, angle), TextureDot, ScanSector, RadarSector (key, name, verb, total, far), ScanRadar (sectors, points, byBand, total), RadarTableRow.
  - Radar.rings ([Ring: (inner, outer)]), edges, ringOf(Band?), ringAt(Double) -> Ring?, spots(String) -> (Double, Double), sectorAngles(Int), sectorAt(Double, Int), place([RadarPoint], Int), texture([Int], max: = 700), nearest(_:_:_:_:) (of equal distances, the later), walkOrder(_:) (stable), scanSectors, sectorKey(String?), scanRadar(ScanSummary?), radarTable(ScanSummary?).
- Command.swift:
  - ParsedCommand: action (.plan, .help, .lists, .status, .newList "new_list", .link, .history, .undo, .approve, .cancel, .review, .keep, .unkeep, .listAdd "list_add", .listRemove "list_remove"), plus optional kind, target, name, code, last, actor, bands ([Band]), kinds, actors, refusal, reason, fromPost, confirm, and needsTarget and raw.
  - Command.kinds ([String: [String]?]) and kindNames; shortCode, authorOf, looksLikeTarget, extractTargets.
  - CHANGED: facetLinks(_ JSONValue?) throws(NotIterableError) -> [String] and facetMentions(_ JSONValue?) throws(NotIterableError) -> [String]. They throw, as the web's for...of does, when facets or a facet's features is an object, a number or true; falsy values, strings and non-object elements read as nothing. A truthy non-string uri or did is returned as its String() form.
  - public struct NotIterableError: Error, LocalizedError (message is V8's, e.g. "object is not iterable (cannot read property Symbol(Symbol.iterator))").
  - parseActor(String?) -> String?; isWrite(ParsedCommand?); parseCommand(_ text: String?, embedUri:, links:, mentions:) -> ParsedCommand? (pass links/mentions from try facetLinks/facetMentions); parsePostScan(_:embedUri:links:) -> String?; help.
- DmMessage.swift: sharedUri(JSONValue?), isDirect(JSONValue?), CHANGED composeMessage(JSONValue?) throws(NotIterableError) -> String, answerTo(String?) -> DmMessage.Answer? (.yes or .no). Messages and convos are passed as JSONValue.
- ScanStore.swift: @MainActor @Observable final class ScanStore.
  - .shared, init(now: () -> Date), scans [did: ScanState] (views observe this), scanFor(_:), subscribeScans(_:) -> unsubscribe, resetScansForTests().
  - startScan(_ did, input:, now:, run: @Sendable (onStage: ScanStageHandler) async throws -> ScanResult) -> Task<Void, Never>.
  - stopScan, clearScan, keepScansFor([String]?).
  - ScanState: status (.idle, .running, .done, .failed), input, startedAt (epoch ms), stage, progress (done, total), result, error; ScanState.idle.

CONVENTIONS
- Loosely typed network input (profiles, relationships, chat messages and convos) stays JSONValue and is read with the web's truthiness and Number() rules.
- Untrusted text is compared by code unit, using internal helpers in Support/JSText.swift: jsEquals, jsStartsWith, jsIncludes, jsSplitWhitespace, jsUnique, jsContains, JSRegex (ICU patterns with JS \s, \b and i spelled out), JSMath.min/max and Array.jsSorted (stable).
- Functions that format numbers take locale: String? (nil means the active locale), so tests leave AppLocale's globals alone. ActiveFormats lives in VirgaCoreTests and can't be extended from another test target.
- Clock reads are injected and rounded to whole milliseconds.
- Parity helpers in ios/parity/cases/_defense.js: harness() (worlds and fake network), crowdScan(rkey, viewerDid) (real harvest, profiles, relationships and canary for one of Mira's posts), crowdSummary(scan), scripted({profiles, uncounted, profileErrors, relationships, relationshipErrors}), which the Swift Tests/VirgaDefenseTests/ScriptedAppView.swift mirrors exactly, scoreScripted(spec) (spec.zone runs the score in that local zone; the Swift test passes the same TimeZone), withNow(ms, fn), withZone(zone, fn) (async-safe TZ switch), madeUpSummary(n, {seed, mix, kinds, vouchCheck}), participant, harvestOf, scoreOf, seeded.
- A test that must see a throw from a parity function reads `{ $throws: message }` through CommandParityTests' outcome(_:) helper.

## Known gaps and deliberate differences

- score.js: publicRelationships (fetchWithTimeout against APPVIEW) is not ported; it comes in wave 2 with VirgaNetwork. createScorer has no default getRelationships yet.
- harvest.js, scan.js, veto.js, defenseService.js, useDefense.js and pageModel.js are still pending, as the brief says. harvest.js and scan.js have only their data shapes. Both have pure pieces wave 2 must bring along: harvest.js engagementKind, KIND_ORDER, primaryKind and isDid; scan.js canaryCandidates, STAGES, ScanError and scanErrorFrom.
- A truthy facet uri or did that isn't a string comes back from facetLinks/facetMentions as its String() form; the web passes the raw value through, so its actor can be a number.
- A profile count that isn't a number (for example "123") reads as 0. The web keeps the raw value, so its comparisons coerce it and `1 + followers` concatenates it. AppView counts are always integers.
- AccountScore.trust is an Int, so a NaN trust becomes 0. Only a negative follower count can make one. Score.trustScore returns the exact Double, NaN included.
- Radar.sectorAt(NaN) returns 0. Plan.estimateWrites caps writes at 1e15. Limit.chunks needs a size of at least 1. Thresholds decoded with null fields take the defaults. Limit.pause waits for delays over 2^31-1 ms.
- Limit.mapLimit, and so the Scorer, waits for in-flight items (already cancelled) after the first error; the web returns at once and leaves them running.
- If a score is cancelled while a canary re-pick is in flight, Swift throws CancellationError. In the same race the web's score() can reject with the vouches ScoreError. scan.js checks signal.aborted first, so the scan reports 'aborted' either way.
- Fixture sizes after the added cases: radar about 800 KB, score about 800 KB, plan about 437 KB, command about 293 KB.
- VirgaCore has no fmtInt(_:locale:) and no code-unit string comparisons, so Defense keeps internal stand-ins in Support/Formatting.swift and Support/JSText.swift.
- Web bugs to report (not fixed; the web is the reference): (1) plan.js estimateWords writes minutes in the active locale but hours with toFixed(1), so en-DE shows 'about 3.5 hours'. (2) dmMessage.js composeMessage, through command.js facetLinks/facetMentions, throws a TypeError on a DM whose facets or features is an object, a number or true, so the worker fails on it. (3) scanStore.js startScan's `if (controller.signal.aborted) set(did, IDLE)` can never run. (4) command.js parseActor's DID pattern rejects colons, so did:web:example.com:user is not read as an account, though harvest.js accepts it. (5) dmMessage.js answerTo doesn't read 'don’t', with the typographic apostrophe iOS Smart Punctuation types, as no; only ASCII don't and dont. (6) plan.js planRows' doc says 'nearest first within a band', but the code keeps the scan's row order (harvest order), not trust order.

## What the audit found and fixed

- medium (fixed) src/defense/command.js facetLinks/facetMentions; src/defense/dmMessage.js composeMessage: Malformed facets did not match the web. When a DM's facets, or a facet's features, is an object, a number or true, the web's for...of throws a TypeError (V8: 'object is not iterable (cannot read property Symbol(Symbol.iterator))', 'number 5 …', 'boolean true …'). The port silently read it as having no facets. Fixed: Command.facetLinks, Command.facetMentions and DmMessage.composeMessage now throw NotIterableError carrying V8's message. Strings, falsy values and nested arrays still read as nothing, as on the web. 15 facetLinks/facetMentions cases and 5 composeMessage cases now hold the throws to the fixture.
- medium (fixed) src/defense/score.js createScorer → profiles (onBatch/onProgress): Scorer progress could count backwards. On the web, onProgress is called synchronously as each batch lands, so the done count only goes up. In the port, each concurrent batch awaited its own onProgress, so a later count could reach the store first (for example 46, 22, 70). The porter's test sorted the reports to get past this. Fixed: reports now go into an AsyncStream as they are counted, are handed over one at a time in that order, and are all delivered before score returns or throws. New test reportsProgressInOrderWhateverOrderBatchesLandIn fails on the old code and passes now.
- medium (fixed) src/defense/score.js profileBatch (refind ??= refindCanary()): Stopping a score didn't stop the canary re-pick. The shared re-pick was an unstructured Task, so cancelling the score did not cancel it, and the batch waited for refindCanary and its reads to finish (the test case took 60 s). On the web, the re-pick reads with the scan's signal and stops at once. Fixed: the wait now goes through withTaskCancellationHandler, which cancels the shared re-pick, and Task.checkCancellation then throws CancellationError. New test stopsTheCanaryRepickWhenTheScoreIsStopped fails on the old code.
- low (fixed) src/defense/score.js (tests): The ScorerBehaviour progress test expected done counts of [24, 48, 70] after sorting. That assumes the 22-account batch lands last, which concurrent batches don't guarantee. It now checks the order that actually holds: each step is +24 or +22, ending at 70.
- low (fixed) src/defense/score.js, plan.js, historyModel.js, radar.js, command.js (fixtures): Several things had no fixture coverage, so I added cases: - createdAt was only ever read in UTC. Added three local zones through a new async withZone helper and a `zone` input the Swift test reads; it covers no-offset, date-only and legacy forms, plus 0 and '2026'. - en-FR, one of AppLocale.localeChoices, was missing from the plan and history locales. - Ties for nearest and walkOrder, and sectorAt with a negative n. - Texture with negative counts. - Look-alikes that JavaScript's case mapping folds onto a band or a kind (the dotless i gives PERIPHERAL, the Kelvin sign gives likers). - Number() count strings ('0x10', ' 7 ', '1e2', 'Infinity', '-0'). - Facets naming one account twice, shared records that aren't posts, and larger counts for estimateWrites. I also added a seeded fuzz: 240 parseCommand, 80 parsePostScan and 80 parseActor cases plus 300 trust keys are kept. Before trimming I ran 20,000 commands (and 6,667 each of post scans and actors) and 200,000 trust keys; all matched.
- low (fixed) ios/parity/modules/defense.json (harvest.js, scan.js): The pending notes were incomplete. harvest.js left out HarvestTotals and the pure helpers that still need porting. scan.js left out ScanStageHandler, that readPostInput needs VirgaPosting's parsePostLink, and which pure pieces (canaryCandidates, STAGES, ScanError, scanErrorFrom) come with it. Both notes are rewritten. Everything else in the map checked out: statuses, the score.js partial note, the headers, and stamps with no drift.
- low (open) src/defense/command.js facetLinks/facetMentions: Not fixed: a truthy facet uri or did that isn't a string comes back as its String() form. The web returns the raw value, so a numeric mention DID would make the web's actor the number 5 where Swift gives "5". This only happens with malformed facets, and the Swift API is [String].
- low (open) src/defense/score.js, radar.js, plan.js, limit.js: I confirmed the porter's documented deviations and left them as they are: - A profile count that isn't a number reads as 0. - A NaN trust (only from a negative follower count) becomes Int 0. - sectorAt(NaN) returns 0. - estimateWrites caps writes at 1e15. - chunks(_, 0) fails a precondition (the web loops forever). - mapLimit waits for in-flight items, already cancelled, after the first error. I found two more of the same kind: Thresholds decoded with null fields take the defaults, where the web reads `>= null` as `>= 0`; and Limit.pause waits for delays over 2^31-1 ms, which setTimeout fires at once. Thresholds come from code and the delays are 1 s and 3 s, so neither can happen today.

## The rest of the engine (2026-11-21)

Ported, then audited. Parity cases at port time: 995, plus 3 added by the audit.
Tests at the time: The whole package passes swift test on Linux with Swift 6.4.2. VirgaDefenseTests now has 144 tests in 23 suites (was 138), and the defense suite passed 3 runs out of 3 after the deflake; before it, 1 run in 3 failed. The other targets' suites pass unchanged: 194, 57, 190, 99, 79, 69 and 172 tests, plus 1. PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 109 passed. npx eslint ios is clean, and the edited generators pass prettier --check. Commits on ios/w5-a: abb69f9 (a stopped harvest resolves, the lists follow the session, veto test deflaked) and 717e9db (3 new parity cases: defense.harvest page-cap-negative and only-unknown-kinds, defense.scan kept-with-no-reason).

### API for the code that builds on it

All in VirgaDefense (import VirgaDefense). Paths are under ios/VirgaKit/Sources/VirgaDefense/. The web's AbortSignal is task cancellation throughout.

LIMIT (Limit.swift). One change from the porter's summary:
- Limit.mapLimit(_ items, _ limit, stopsWhenCancelled: Bool = true, _ fn) async throws -> [R].
- `stopsWhenCancelled: false` is the web's mapLimit called without `{ signal }`: every item is still started once the task is cancelled, and fn decides what a stop means. harvestPost uses false.

HARVEST (Harvest.swift; the functions are statics on the existing `Harvest` struct)
- Constants: Harvest.maxPages (60), Harvest.kindOrder, Harvest.constellationDown (the exact sentence).
- Harvest.isDid(_ String?) and isDid(_ JSONValue?).
- Harvest.engagementKind(collection:path:) and engagementKind(_ BacklinkSource).
- Harvest.harvestPost(_ uri, maxPages: = 60, only: [String]? = nil, onProgress: HarvestProgressHandler? = nil, transport: = HTTP.transport, clock: = HTTP.clock, now: @Sendable () -> Date = Date()) async throws -> Harvest.
  - Throws HarvestError(message) when Constellation doesn't answer the counts call.
  - Throws CancellationError only when stopped before Constellation listed the sources. Stopped later, it resolves as the web's does: the sources not yet read come back failed (and in `unread`) without a request, truncated is true, and every progress report is still made.
  - Throws JSError TypeError (V8's spread message) for records that aren't a list.
  - Progress reports are awaited, in counting order (0…n), all delivered before it returns.
- Types: HarvestProgress {done, total}; typealias HarvestProgressHandler = @Sendable (HarvestProgress) async -> Void.

SCORE (Score+Relationships.swift)
- Score.publicRelationships(appview: = AppConfig.appview, transport: = HTTP.transport) -> GetRelationships.
  - Goes through Atproto.fetchWithTimeout (15 s deadline).
  - Throws DefenseFetchError("HTTP <s> from getRelationships", status:) or "getRelationships answered with no list".
- Score.createScorer's getRelationships defaults to publicRelationships().

ERRORS (Support/StatusErrors.swift)
- XRPCError, BackendError, PublicXrpcError, AtprotoHTTPError and VirgaSession's JSError conform to HTTPStatusError, so Score.retryable reads their status. XRPCError's status 1 means no response and is not retried, as on the web.
- DefenseFetchError(message, status: Int?): HTTPStatusError, JSErrorConvertible.
- protocol CausedError { var cause: (any Error)? }: ScoreError, VetoUnreadable and ScanError conform.

VETO (Veto.swift, ReasonMap.swift)
- ReasonMap: did → reason, as a JS Map. Keys compare by code unit, kept in insertion order; ExpressibleByDictionaryLiteral.
  - Members: subscript(did:), has, set, keys, entries [Entry{did, reason}], count, merging (other wins), dictionary ([String: String], for createScorer's protectedSet). Encodes as an object.
- VetoUnreadable(message, cause:): code "veto-unreadable", name "VetoUnreadable".
- Veto.CurationLimits(lists: 20, membersPerList: 5000); Veto.curationLimits.
- Veto.followedNow(_ owner, _ dids, appview:, transport:) async throws -> ReasonMap.
- Veto.curationMembers(_ owner, appview:, transport:, limits:) async throws -> ReasonMap (did → list name).
- Veto.vetoed(ownerDid: String?, holderDid:, dids: [String?], kept: ReasonMap, curation: Veto.Curation? (nil reads it), follows: Veto.Follows?, appview:, transport:, limits:) async throws -> ReasonMap.
  - typealias Follows = @Sendable (owner, [String]) async throws -> ReasonMap; typealias Curation = @Sendable () async throws -> ReasonMap.
  - Both reads run side by side; when both fail, the first to fail is thrown.
  - A stop throws CancellationError, never VetoUnreadable.

SCAN (Scan.swift)
- ScanError(message, code: ScanError.Code {link, author, aborted, permission, vouches, read, harvest}, cause:): name "ScanError"; LocalizedError text = message.
- ScanStage {key, label}; Scan.stages, Scan.canaryCandidates (150), Scan.canaryRequiredAt (20).
- PostInput {did?, handle?, rkey}; Scan.readPostInput(_ String?) -> PostInput?.
- Scan.resolvePost(_ input, resolveHandle: Scan.ResolveHandle) async throws -> ScanPost.
- CanaryArchive {following: [Follow{did?, followedAt?}], followers: [Account{did?}], inbound: [Account{did?}]}, decoded leniently.
- Scan.canaryCandidates(_ archive, ownerDid:, limit: = 150, timeZone: TimeZone? = nil) -> [String].
- Scan.signedInProfiles(_ agent: XRPCAgent) -> GetProfiles: withProxy("bsky_appview", "did:web:api.bsky.app"), then app.bsky.actor.getProfiles.
- Scan.readCurationLists(_ owner, appview:, transport:) async throws -> ReasonMap: best effort ("on your list “name”"); rethrows a stop.
- Scan.scanErrorFrom(_ error, aborted: Bool = false) -> ScanError.
- Scan.runScan(input:, ownerDid:, getProfiles:, candidates: = [], onStage: ScanStageHandler?, resolveHandle: ResolveHandle?, harvest: HarvestRead?, getRelationships: GetRelationships?, readCurated: ReadCurated?, kept: ReasonMap?, retryDelaysMs: [Double]?, transport: = HTTP.transport, now: = Date(), timeZone: TimeZone? = nil) async throws(ScanError) -> ScanResult.
  - A nil read means the web's default over `transport`: PublicAppView.resolveHandle, Harvest.harvestPost, Score.publicRelationships, readCurationLists.
  - `now` stamps startedAt and finishedAt and is the scorer's clock.
  - Stopped part way through the default harvest, the scan still reports the canary stage, as the web does, then throws ScanError aborted ("The scan was stopped.").
  - typealias ResolveHandle = @Sendable (String) async throws -> String?; HarvestRead = @Sendable (uri, @escaping HarvestProgressHandler) async throws -> Harvest; ReadCurated = @Sendable (owner) async throws -> ReasonMap.
- Page wiring, as DefensePage.jsx does it: ScanStore.shared.startScan(did, input: text) { onStage in try await Scan.runScan(input: text, ownerDid: did, getProfiles: Scan.signedInProfiles(agent), candidates: Scan.canaryCandidates(archive, ownerDid: did), onStage: onStage) }.

DEFENSE SERVICE (DefenseService.swift)
- Every call takes VirgaBackend? (session.backendFor(did)); nil throws DefenseService.needsBackend() (BackendError code NEEDS_BACKEND, status 0).
- Results are the server's JSONValue (`body.data ?? body`).
- fetchLists(_), createList(_, name:purpose:description:), keepAccount(_, did, reason?), unkeepAccount(_, did).
- planAndApprove(_, listId: JSONValue, postUri: String?, rows: Encodable, totals: Encodable, bands: [String], note: String?).
  - The page sends rows = Plan.planRows output and totals = {participants, ...byBand}; a nil postUri or note is sent as null, as the page's `|| null` and cleanNote give.
- fetchHistory(_, before: JSONValue?, list: String?), undoAdds(_, planId: JSONValue?, ids: [JSONValue]?, note: String?).
- fetchLink(_), makeLinkCode(_), unlinkModerator(_), chooseLinkList(_, JSONValue?).
- defenseErrorMessage(_ error) and defenseErrorMessage(code:message:).
- Reading .list or .planId from a null answer throws JSError TypeError, as the web does.

MODELS (DefenseModels.swift)
- @MainActor protocol DefenseSession { did; accounts: [SessionAccount]; authMode; capabilitiesFor(_:); backendFor(_:); signIn(_:_:) }. SessionModel conforms.
- DefenseAccountModel(session:): did, account, caps, asking: Asking? (.busy | .error(String)), askFor(_ level: AppConfig.DefenseLevel?) async (nil means the web's false).
- DefenseListsModel(did:, session:, sleep: = Task.sleep):
  - Observed: did, data: JSONValue?, error: String?, loading.
  - Computed: requester, waiting. Static pollMs = 15 000.
  - start() async (mount): the first read. From then until stop() it follows the session: when what backendFor(did) reads changes (SessionModel's account rows, e.g. a sign-out or a new sign-in), it runs update(did:), so a new requester (or none) reads the lists again and a signed-out account's lists clear.
  - update(did:) async: when the did or the requester's (did, token) changes, the poll is reset at once, over the lists still shown, then the lists are read. The view still calls it when the open account changes, e.g. from .task(id:).
  - stop(): unmount. Ends the poll and stops following the session; a read under way is not stopped.
  - refresh() async -> JSONValue? (discardable).
  - While waiting it polls every 15 s.

PAGE MODEL (PageModel.swift; numbers take locale: String? = nil, meaning the active locale)
- postsToScan(_ posts: [Post]?, now:, days: = 30, limit: = 4, timeZone:, facts: (Post) -> PostToScanFacts?) -> [Post], plus a [JSONValue] overload.
- vouchPhrase(_ ScanRow, _ VouchCheck = .canary, locale:), didPhrase, protectedPhrase -> String?, describeRow -> RowDescription {title, lines}, rowFacts -> [String].
- stageLine / stageLabel / stageCount / stageFraction, taking ScanState? or (stage:progress:).
- inertCell (String and JSONValue overloads), engagementKinds(_ Participant), scanCsvHeader, scanCsvRows(_ ScanSummary?) -> [[JSONValue]].

TEST SUPPORT (internal to VirgaDefenseTests)
- Replay.swift: expectReplay(c, ordered:, sortedWaits:) { transport, clock in }, Fixed.now, date(ms:), Heard<T>.
- ScriptedAppView mirrors _defense.js scripted.
- DefenseModelsTests.swift holds a FakeSession (a DefenseSession, not @Observable, so it isn't followed) and a Ticker sleeper; both are file-private, so copy them to reuse.
- VetoBehaviourTests.swift has a private answered(_:on:) helper that waits for a MockTransport request.

### Known gaps and deliberate differences

- runScan passes createScorer a [String: String] protectedSet (the wave-1 API), so its keys compare by canonical equivalence: a non-DID curation member with a Kelvin sign would protect the ASCII DID it is equivalent to. It fails safe. The scorer's selves, alreadyListed and blockers Sets work the same way.
- DefenseListsModel follows the session through Observation on what SessionModel.backendFor reads (its rows). A token replaced in the secret store without any change to the account rows wouldn't be noticed until the next update(did:) or poll. Sign-in and sign-out both change the rows. A session that isn't @Observable (such as the tests' FakeSession) isn't followed; the view's update(did:) still works.
- Carried over from the porter and confirmed. HarvestSource.count, distinctDids and UnreadKind.count are Int: the web keeps the raw value, so a fractional count is truncated and a string count is concatenated on the web. A non-string backlink rkey or collection comes back in String form. A truthy cursor that stringifies to '' isn't sent. signedInProfiles gives [] where the SDK would throw InvalidResponse (a known network gap). Limit.mapLimit cancels and awaits in-flight items after the first failure. canaryCandidates skips null followers and non-string DIDs. postsToScan reads counts as numbers only. scanCsvRows orders the engagement column from the row's records. DefenseService answers stay JSONValue (planAndApprove ignores a non-object approve answer, which the web would spread key by key). console.warn calls are dropped. `now` also drives the scorer's clock and harvestedAt.
- Wiring the app still needs VirgaArchive, which the other chain owns, to supply CanaryArchive's following, followers and inbound and the post rows for postsToScan. VirgaUI then starts scans through ScanStore.startScan with Scan.runScan and Scan.signedInProfiles(agent), calls DefenseListsModel.start(), update(did:) and stop() from the view, and binds DefenseAccountModel.
- Possible web bugs, low (none fixed). The porter's six are confirmed (the useDefenseLists seq race, canaryCandidates' null follower, harvest's spread TypeError, followedNow keeping unasked DIDs, createList/planAndApprove on a null answer, drainSource's `??` retry). Two new ones: (1) src/defense/useDefense.js useDefenseLists computes `waiting = (state.data?.lists || []).some((l) => l.waiting > 0)` during render, so a null entry in lists, or a lists value that is truthy but not an array, throws and crashes the page; the port reads both as nothing waiting. (2) src/defense/defenseService.js planAndApprove's `{ planId: plan.planId, ...approved }` spreads a string or array answer into numbered keys.

### The audit

- **medium**, src/defense/harvest.js harvestPost (mapLimit without signal) / drainSource: If the caller stopped a harvest after Constellation had listed the sources, the port threw CancellationError, but the web resolves. harvest.js calls mapLimit without `{ signal }`, so every source is still drained: Constellation's client answers null at once with no request, those sources come back failed and unread, and all progress reports are made. The port's Limit.mapLimit always checked cancellation before starting each item. Fixed: Limit.mapLimit gained `stopsWhenCancelled: Bool = true` (false means the web's call without a signal), and harvestPost passes false. Three new tests: HarvestBehaviour.aHarvestStoppedPartWayResolvesWithTheRestUnread, ScanBehaviour.stoppedPartWayThroughTheWebsHarvestSaysSo (the scan still reaches the canary stage and is then stopped by the curation read, as on the web) and LimitBehaviour.withoutTheSignalEveryItemIsStillStarted. The first two fail on the old code.
- **medium**, src/defense/useDefense.js useDefenseLists (req = backendFor(did) per render; refresh effect): DefenseListsModel didn't follow the session. The hook re-renders whenever the session changes and reads backendFor(did) again, so a sign-out (no requester) or a new requester reads the lists again, and a sign-out clears them. The model only did this when the view called update(did:), and a SwiftUI view keyed on the did (.task(id:)) never sees a sign-out or a token change, so it kept showing a signed-out account's lists. Fixed: between start() and stop(), the model tracks session.backendFor(did) with withObservationTracking (SessionModel's rows are observed) and runs update(did:) when it changes. Tests: DefenseModelsOverTheSession.followsTheSessionWhenTheAccountIsSignedOut, which fails on the old model, and followsNothingOnceStopped.
- **low**, src/defense/useDefense.js useDefenseLists (interval effect deps [waiting, refresh]): On a requester change, update(did:) waited for the new read before resetting the poll. The hook's interval effect runs again at the same commit, before the read comes back. Meanwhile the old timer could fire and start a second read that overtook the first. Fixed: the poll is reset first, over the lists still shown, then the read runs. Test: DefenseListsModelBehaviour.setsTheTimerAgainAtOnceForANewRequester, which fails on the old order.
- **medium**, src/defense/veto.js vetoed (Promise.all, first rejection wins) — test only: VetoBehaviour.theReadThatFailsFirstIsTheFailure was flaky: it failed in 1 of 3 runs of the whole defense suite. It relied on a 30 ms sleep to order the two failing reads, and under the parallel parity load the slow read sometimes won. Fixed: the slow read now waits until the fast read's request has been made, then 250 ms more. The defense suite then passed 3 runs out of 3, plus one full-package run.
- **low**, src/defense/harvest.js harvestPost; src/defense/scan.js runScan protectedSet: Fixture coverage was thin in three spots. Added harvestPost with maxPages -1 (reads nothing, truncated but not failed), harvestPost with `only` naming unknown kinds, a repeated kind and a case look-alike ('Like'), and runScan with an empty reason kept by hand: it still replaces the curation list's reason in `new Map([...curated, ...kept])`, and the score falls back to its own ('you follow them') or to no protection. The Swift port matched all three as it was.
- **low** (left as it is), src/defense/scan.js runScan → score.js createScorer protectedSet.get(did): Not fixed: runScan hands createScorer `protectedSet.dictionary`, a [String: String]. That is the wave-1 scorer's API, and Swift's String keys use canonical equivalence. A curation-list member such as 'did:plc:\u{212A}…' (Kelvin sign) would protect the ASCII 'did:plc:K…' in Swift but not on the web, and two canonically equal keys collapse into one. This fails safe (it protects more people, never fewer) and needs a non-DID member from the AppView.
- **low** (left as it is), src/defense/{scan,veto,defenseService,pageModel,harvest}.js: Checked and confirmed, no change needed. readPostInput, resolvePost, canaryCandidates, scanErrorFrom (including AbortError, TimeoutError and a missing scope in the cause), STAGES and its copy, followedNow, curationMembers and vetoed. Every DefenseService call and every word of defenseErrorMessage (including the Kelvin-sign code case). Every pageModel export. engagementKind, isDid and the fold/sort/unread logic. The module map (all 16 files ported, headers present, no drift) and the porter's documented gaps.
