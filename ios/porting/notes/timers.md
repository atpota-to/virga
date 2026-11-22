# timers: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited.
Parity cases at port time: 7244, plus 1560 added by the audit.
Tests at the time: The whole package passes under `swift test`. VirgaPostingTests is 177 tests in 31 suites, and the other targets are 57/79/77/134 tests. The timer suites are now 61 tests in 8 suites: SelfDestructNormalizersParity, SelfDestructRulesParity, SelfDestructWordsParity, LifespanModelParity, TimerServiceParity, TimerServiceBehaviour, TimerModelBehaviour, and the new TimerFuzzParity. New tests:

## API for the code that builds on it

All of this lives in VirgaPosting (`import VirgaPosting`). Paths are under ios/VirgaKit/Sources/VirgaPosting/.

THE RULE MODEL: `enum SelfDestruct` (Timers/SelfDestruct*.swift; ports selfDestruct.js; web names unchanged)

Types (SelfDestruct+Types.swift)
- All types are Codable, Hashable and Sendable, and encode to the web's JSON, explicit nulls included.
- Enums: TimerMetric, TimerOperator, ConditionLogic, ConditionSense, SpareAction, TimerAction (.limitReplies/.disableQuotes/.delete), AllowKey.
- AllowEntry is `.rule(AllowKey)` or `.list(uri, name:)`. It encodes as a string, or as {list, name?}.
- The rule: ActorFilter{match, notFollowed, followersOver: Int?}, TimerClause{metric, op, value, from?}, TimerConditions{logic, clauses, sense, onSpare, maxExtensions}, TimerEffect{action, allow?}.
- TimerRule{enabled, deleteAt: String? (ISO), lifespanSeconds: Int, conditions, effects} is the web's TimerRule. Keep the writer's rule, and fit it for display and sending.
- Fits and results: TimerWireSpec (what the server is sent), TimerFit(gatesSupported, conditionsSupported, replyLimitSupported, available; init(json:) reads a loose fit), SettledTimer, ImmediateTimerSend, ScheduledTimerSend, ScheduledGateChange, StoredTimer, SessionDraftTimer, RestoredDraftTimer, LifespanParts.
- Evaluation and the list: ConditionsEvaluation, TimerCounts (.json), TimerGroup{key, title, rows: [JSONValue]}, TimerUsage{plain, conditional}.
- Every type with a web counterpart has `.json: JSONValue`.

Inputs
- Every web function that takes "anything" takes `some TimerRuleInput` (or TimerConditionsInput / TimerEffectsInput). TimerRule, TimerConditions, [TimerEffect], JSONValue and JSONValue? all conform.
- A typed value is re-normalized through its JSON, exactly as the web re-normalizes.
- Status strings are plain Strings, as on the web: pinnedDeadlineStatus gives 'none'|'ok'|'tooSoon'|'passed'|'tooLate'; timerBucket gives 'plain'|'conditional'; settle's `adjusted` is nil or 'floor'.

Time
- Every `now`/`publishAt` is epoch ms as a Double; NaN is an invalid date.
- Functions that say a time take `locale: String? = nil, timeZone: TimeZone? = nil`; nil means AppLocale's active one.
- A given timeZone is also the zone every date-time without an offset is read in for the whole call, the rule's own pin included (normalizeTimer, however deep). TimerJS.localZone, a task-local, stands for the web's single local zone.
- Functions without a timeZone read offset-less pins in the active zone, or in the zone a caller up the stack bound.
- Pass both locale and zone explicitly in tests.
- The web's describeDeleteAt reads Date.now() inside scheduledTimerProblem, scheduledTimerToSend and scheduledRowTimerProblem; the Swift versions take `now:` instead.

Key signatures
- Normalizing: normalizeTimer(_:timeZone: = nil) -> TimerRule; normalizeConditions; normalizeEffects; normalizeClause(JSONValue?); normalizeAllowEntry; parseDeleteAt(_:timeZone:); normalizeDeleteAt(_:now:timeZone:).
- Fitting and sending: fitTimerToPost(_:_ fit: TimerFit); composerTimerFit(editingExisting:unavailable:reply:) -> TimerFit (also a loose JSONValue overload); keepHiddenRuleParts(edited, stored, fit); describeFitChange(rule, fit); sameTimer(a, b); pinnedDeadlineStatus(timer, publishAt); settleForPublish(timer, now); toWireSpec(timer, now) -> TimerWireSpec?; immediateTimerProblem(timer, now); immediateTimerToSend(rule, fit, now:); scheduledTimerToSend(rule, fit:, publishAt:, now:, locale:, timeZone:).
- Scheduled rows: scheduledRowTimerProblem(row, whenISO: JSONValue?|String?, now:, locale:, timeZone:); scheduledRowDeadlineStatus(row, whenISO, timeZone:). The move and the pin are both read in timeZone.
- Gates from the reply settings: withScheduledGateChange(timer, action: String, on: Bool); withScheduledGateLifespan; scheduledGateChange; withEffect(effects, action, on, extra: JSONValue); withoutEffects / withoutGateEffects / withoutConditions.
- Stored rules and drafts: readStoredTimer(JSONValue?); unreadableRuleParts; defaultRuleFromSettings(settings.lifespan); draftTimerNote(rule, touched, defaults); sessionDraftTimer; restoreSessionDraftTimer(saved, now:).
- Sentences: describeTimer(timer, now:, from: "goesUp"|"wentUp"|"now", locale:, timeZone:); timerChipLabel; describeWhen; describeDeleteAt(iso: String? or JSONValue? (read as `new Date(value)`: null is the epoch), now:, locale:, timeZone:); describeClauses(conditions, locale:); describeEffects; describeAllow ([AllowEntry]? or loose JSONValue?; a non-list says 'nobody'); formatLifespan; plural; timeUntil(iso, now:, timeZone:).
- Slots and the list: timerBucket; timerUsage(liveRows:scheduledRows:exceptScheduledId:) -> TimerUsage; timerSlotProblem(bucket:limit:usage:); timerSlotSentence; timerSlotRefusal(err.payload); timerRoomProblem(rule, limits JSON (getLimits' answer), holds:); groupTimers(rows, history:, timeZone:); compareTimers; waitingTimerRows(listScheduled rows, timeZone:); evaluateConditions(conditions, counts); readCounts.

Constants
- minLifespanSeconds, maxLifespanSeconds, maxExtensionsCap, lifespanPresets, defaultLifespanSeconds, lifespanUnits, metrics, operators, effects, allowOptions, actorTests, maxAllowRules, blueskyOnlyEffects, pastDeadlineGraceSeconds, timersUnavailableNote, expiredDraftTimerNote, timerBucketFeature, timerSlotFeatureBucket, and the rest.

Internal helper TimerJS (Timers/TimerJS.swift and Timers/TimerJS+Sort.swift)
- dateMs(_:timeZone:) is `new Date(x).getTime()`; with nil it uses the bound local zone, else the active one.
- zone(_:) and inZone(_:_:) read and bind TimerJS.localZone.
- v8Sorted is Array.prototype.sort exactly as V8 runs it, for any length (V8TimSort: runs, the merge stack, galloping). Even an inconsistent comparator gives V8's order; a comparator's NaN is 0.
- truthy/present are `a || b` and `a ?? b`. JSONValue is ExpressibleByNilLiteral, so never write `x.flatMap { cond ? $0 : nil }` on a JSONValue: that `nil` becomes `.null`.

THE EDITOR MODEL: `enum LifespanModel` (UI/LifespanModel.swift). These are pure functions; the view holds the TimerRule.
- patchRule(rule, [String: JSONValue?]) and lengthChoice(rule) -> "exact"|"<preset seconds>"|"custom".
- withLength(rule, seconds); withPin(rule, iso, timeZone:) reads the pin (and the rule) in timeZone; toggleEffect(rule, action, allow: JSONValue = ["follower"]), with a typed (TimerAction, [AllowEntry]) overload; withAllow; toggleAllow([AllowEntry], entry) -> [AllowEntry].
- withMetric(rule, metric, patch JSON; a non-object reads as {}); withConditions(rule, [String: JSONValue]); withQuoteFilter(rule, patch, where .null clears it).
- pinBounds(from:) throws InvalidTimeValueError -> PinBounds{min, max}.
- editorNotes(rule, fit: LifespanEditorFit(editingExisting:reply:thread:), publishAt: String?, limits:, holds:, countFrom:, now:, locale:, timeZone:) -> LifespanEditorNotes{fitted, summary, fitNote, pin, pinBlocks, room, thread, unavailable}. publishAt and the rule's pin are read in timeZone.
- curateLists(getLists JSON) -> [AllowEntry].
- firstActAt(rule, startedAt:, now:) -> Double? (ms; NaN means an invalid date). timerStart(rule, start: "now"|"posted", postedAt:, now:, timeZone:) -> TimerStartPoint{startedAt, from, passed}.
- Constants: followerThresholds, extensionChoices.

THE SERVICE: `enum TimerService` (Timers/TimerService.swift)
- The seam: `protocol TimerRequester: Sendable { var did: String? { get }; func request(_ request: TimerRequest) async throws -> JSONValue? }`.
  - TimerRequest{path, method (nil means GET), query: [String: String]?, body: JSONValue?} is the web's req.request(path, opts).
  - VirgaBackend should conform to TimerRequester, answer the decoded JSON body, and throw an error conforming to `TimerErrorConvertible` (var timerServiceError: TimerServiceError{code, message, status, name, payload}).
  - Status 0 means no answer; use codes TIMEOUT and NETWORK_ERROR as the web's backend client does. A CancellationError reads as an AbortError.
- Page state is `TimerServiceContext(availability: TimerAvailabilityState, events: PostingEventBus?)`; `.shared` is the app's. Tests make fresh ones.
- Helpers: timerDidForUri, timerSnippet, isTimersUnavailableError, isTimersUnsupported, isArmOutcomeUnknown, isDefiniteArmRefusal, isLiveTimer, countLiveTimers, timerPostUrl.
- Availability: timerAvailability(ctx) -> 'available'|'unavailable'|'unknown'; probeTimerAvailability(req, context:), where concurrent callers share one request; markTimersUnavailable; resetTimerAvailability.
- Reads: listTimers(req, history:, context:) async throws -> TimerList{rows, unavailable}; loadTimerUsage(req, scheduledRows:, exceptScheduledId:) -> TimerUsage?.
- Writes:
  - timerBody(uri:cid:extraUris:snippet:postedAt:rule:fit:now:timeZone:) -> TimerCreateBody? (.json). postedAt and the rule's pin are read in timeZone.
  - createTimer(req, uri:..., rule:, fit:, now:, preflight:, timeZone:, context:) -> CreateTimerOutcome{status 'armed'|'failed'|'confirming'|'none', row, error, adjusted, confirmation: Task<ArmConfirmation, Never>?}.
  - confirmArmAfterUnknown(req, body, firstError:, context:).
  - armAfterPublish(req, publishResult JSON {posts, root}, rule, snippet:, postedAt:, fit:, onConfirming:, now:, timeZone:, context:) -> ArmOutcome{status, row, error, adjusted, note}.
  - cancelTimer(req, id, context:) async throws -> JSONValue?.
- Events go out as virga:timers-changed through PostingEvents.emitPostingEvent, with detail {did, change, postUri?, id}.

TEST HELPERS (Tests/VirgaPostingTests/)
- TimerFixtures.cases(fixture, fn) caches large fixtures.
- ParityCase extensions: ms(_), zone, loose(_), fit.
- ScriptedRequester and scriptedError replay the generator's request scripts.
- TimerFuzzParityTests holds the port to timers.fuzz.
- Fixture corpus for new generators: ios/parity/cases/_timers.js. It exports RULES, GRID_RULES, PIN_RULES, FITS, MOMENTS, row sets, and atClock(now, fn), which holds Date.now() still.
- ios/parity/cases/timers.fuzz.js has seeded builders (rule, conditions, effects, allow, fit, rows, limits) for random loose inputs. Seed and size are its SEED and N constants.

## Known gaps and deliberate differences

- The calls to /api/self-destruct/* go through the TimerRequester seam. VirgaBackend is the TimerRequester and its BackendError is TimerErrorConvertible (VirgaPosting/Wiring.swift), so timerService.js is ported. The app arms a timer through it from the composer once a post goes out (VirgaUI's ComposerController+Timer.swift), from the posting pages' timer dialog (Posting/TimerDialog.swift), and from Drafts' and Scheduled posts' Post now (DraftActions, ScheduleModel+Picker).
- Deliberate divergences on corrupt input only, all documented in the Swift and avoided by fixtures. The port doesn't recognise names an object literal inherits ('constructor', 'toString', '__proto__') or arrays standing in for a table's key. Where the web throws (describeAllow given {} or 5; withClause, withMetric or withConditions given a null patch; a null fit), the port reads the value as empty. TimerCreateBody drops extraUris and cids that aren't strings.
- Functions without a timeZone parameter (pinnedDeadlineStatus, settleForPublish, toWireSpec, patchRule and the rest) read an offset-less pin in the active zone, or in the zone a caller up the stack bound. That is the web's behaviour when the active zone is the device's. TimerJS.localZone is internal, so code outside VirgaPosting can only choose a zone through the functions that take one.
- Fixture sizes: timers.fuzz about 2.0 MB, selfDestructRules about 1.6 MB, selfDestruct about 1.0 MB, lifespanModel about 0.95 MB, selfDestructWords about 0.8 MB, timerService about 0.26 MB.
- Web bugs to report (not fixed; web unchanged):
  - selfDestruct.js looks keys up in plain object literals, so inherited names count as members. normalizeClause({metric:'constructor', value:5}) keeps the clause, and describeClauses({clauses:[{metric:'toString',value:2},{metric:'likes',op:'valueOf',value:3}]}) gives '2 undefineds or undefined3 likes'.
  - clauseCountKey({metric:'quotes', from:'x'}) gives 'quotes|function match() { [native code] }'.
  - describeAllow({}) throws '(entries || []) is not iterable'.
  - withClause(c, m, null) throws "Cannot destructure property 'op' of 'patch' as it is null."; fitTimerToPost(t, null) and lifespanModel's withConditions(rule, null) also throw.
  - scheduledTimerProblem says the pinned time against Date.now() even when its caller (editorNotes, scheduledTimerToSend, scheduledRowTimerProblem) has a `now`.
  - Copy: with a limit of 0, timerSlotSentence and timerRoomProblem say 'This account can keep 0 plain timers at a time, counting scheduled posts, and all of them are in use.'

## What the audit found and fixed

- medium (fixed) src/posting/timers/selfDestruct.js normalizeTimer/parseDeleteAt, as reached from describeWhen, describeTimer, timerChipLabel, scheduledTimerProblem, scheduledTimerToSend, scheduledRowTimerProblem, scheduledRowDeadlineStatus; lifespanModel.js editorNotes, withPin, timerStart; timerService.js timerBody/createTimer: The functions that take a time zone read the rule they were handed in the active zone instead. normalizeTimer had no zone and always used AppLocale.activeTimeZone(). So a pin with no offset was read on one wall clock and said on another. For example, describeWhen({enabled:true, deleteAt:'2026-08-27T23:30'}) in America/New_York gave 'today at 7:30 PM' where the web says 'today at 11:30 PM'. The extend window, the scheduled refusals, the row statuses and the create body's deleteAt/lifespanSeconds drifted the same way. 123 new cases failed before the fix. Fix: TimerJS.localZone is a task-local that stands for the web's single local zone. Every function given a timeZone binds it for everything it calls, and normalizeTimer(_:timeZone:) also takes one. Held to new local-pin cases in four zones (UTC, New York, Kolkata, Chatham) for describeWhen, describeTimer, timerChipLabel, scheduledTimerProblem, scheduledTimerToSend, the two scheduled-row checks, editorNotes and timerBody.
- low (fixed) selfDestruct.js groupTimers / waitingTimerRows / withClause / normalizeEffects / withEffect (Array.prototype.sort): Above 63 elements, TimerJS.v8Sorted used a stable sort, but V8 merges runs there and gallops. The two give the same order only when the comparator is consistent. compareTimers is not consistent once a row's time can't be read, and the server's timer list can hold more than 100 rows. Ported V8's ArrayTimSortImpl comparison for comparison in a new file, TimerJS+Sort.swift: ComputeMinRunLength, CountAndMakeRun, BinaryInsertionSort, the pending-run stack with MergeCollapse/MergeForceCollapse, GallopLeft/GallopRight, MergeLow/MergeHigh and adaptive minGallop. Held to Node over 88 arrays of 2 to 513 elements under two inconsistent comparators, plus groupTimers over 64 to 250 rows and waitingTimerRows over 64 to 150 rows. The old stand-in fails 78 of those cases.
- low (fixed) selfDestruct.js describeDeleteAt: The Swift port took only a String?, so a null deleteAt read as undefined and said '' where the web says `new Date(null)`, which is 'Jan 1 at 12:00 AM'. Numbers, booleans and arrays also differed. Added a JSONValue? overload that reads values as `new Date(value)` does, and the String? overload now goes through it. Held to new cases (null, undefined, 0, a number, true, an array, an object) in UTC and Pacific/Chatham.
- low (fixed) src/lib/locale.js LOCALE_CHOICES (en-FR) used by describeFrom/describeDeleteAt/describeTimer: Coverage gap: en-FR is one of the formats Settings offers, and no timer fixture used it. It is now in the word generator's LOCALES and the fuzz locales. The port already passed in en-FR.
- low (fixed) selfDestruct.js, lifespanModel.js, timerService.js (whole surface): Coverage was thin for combinations of loose inputs. Added a seeded fuzz generator (ios/parity/cases/timers.fuzz.js) that builds random rules, conditions, clauses, actor filters, effects, allow lists, fits, moments, rows, scheduled rows, limits, counts, snippets and failure descriptors. It runs about 60 exported functions across the three files in several locales and zones. Three seeds at 300 cases per function (about 36,000 cases) found nothing beyond the describeAllow item below. 24 cases per function are kept as the timers.fuzz fixture, which is recorded in the module map for all three files. New Swift suite: TimerFuzzParity.
- low (open) selfDestruct.js describeAllow: For a truthy value that can't be iterated ({} or 5), the web throws '(entries || []) is not iterable', while the port's loose describeAllow says 'nobody'. Left as is because every caller passes a normalized array. It is documented in the overload's doc comment, and the fuzz feeds only iterable or falsy values.
- low (open) selfDestruct.js withClause, fitTimerToPost/keepHiddenRuleParts/describeFitChange (fit null), lifespanModel.js withMetric/withConditions (patch null): Given null where they destructure an argument, the web functions throw (`= {}` only covers undefined). The Swift typed parameters can't be null, and a JSONValue patch that isn't an object reads as {}. Left as is and documented on withClause. These are web bugs, listed below.
- low (open) selfDestruct.js METRIC_BY_KEY / OPERATOR_BY_KEY / ALLOW_BY_KEY / COUNTED_FROM / TIMER_SLOT_FEATURE_BUCKET lookups: This is the porter's deliberate divergence, which I checked. The web treats inherited names ('constructor', 'toString', '__proto__') and arrays whose text is a key (['likes']) as table members, and the port does not. This matters only for corrupt stored data, and reproducing it would make the typed model hold non-keys. It is documented in SelfDestruct.swift's header, and both fuzz and fixtures avoid such inputs.
- low (open) timerService.js armAfterPublish / timerBody (extraUris, cid): The web keeps truthy URIs and cids that aren't strings (`filter(Boolean)`, `cid || undefined`), while the port's TimerCreateBody drops them because its fields are [String] and String?. publish always returns strings, so no real input reaches this. Left as is.
