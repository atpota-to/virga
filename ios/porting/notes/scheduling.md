# scheduling: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported and audited (2026-11-22; wave 7, Chain A, step 2, after publishing): src/posting/schedule (the rest) and the pages' models in src/posting/pages.

Parity cases at port time: 2678; the audit added 223.

Tests at port time: swift test passes for the whole package: 194/32, 57/12, 466/89 (VirgaPostingTests, up from 403 tests in 77 suites before this chain's scheduling work), 99/26, 152/29, 140/24, 144/23, 176/31, 128/16 (tests/suites per target). PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 4 files, 171 tests pass. npx eslint ios is clean, prettier --check passes on every scheduling generator, and parity:drift lists no scheduling file.

Tests after the audit: swift test passes for the whole package. Tests/suites per target: 194/32, 57/12, 467/89 (VirgaPostingTests, up from 466 with the new TimerServiceError behaviour test), 99/26, 152/29, 140/24, 144/23, 176/31, 128/16. PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 4 files, 171 tests pass. npx eslint ios is clean, prettier --check passes on every scheduling generator, and parity:drift reports no drift. Scheduling fixtures hold 2901 cases, up from 2678. With the Swift source fixes stashed, the new cases fail (planQueueReorder, mergeSuggestionsIntoSchedule, missingSuggestions, groupByZonedDay and the others). I also ran every scheduling parity suite once with strictNulls on by default; there were no differences. Request bodies in recorded exchanges were already compared strictly, deadlines included. Commits on ios/w7-a: ce03f3f, c3ef35f, 14e7645.

## Files

- `src/posting/schedule/scheduledPostError.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Schedule/ScheduledPostError.swift. Errors are read as the web's object of members; the any-Error overloads build one first (ScheduledPostError.errorObject).
- `src/posting/schedule/queueSuggestions.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Schedule/QueueSuggestions.swift. The device zone is passed as localZone.
- `src/posting/schedule/queueReorder.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Schedule/QueueReorder.swift, ios/VirgaKit/Sources/VirgaPosting/Schedule/ScheduleJS.swift. The pin's words take now: where the web reads Date.now().
- `src/posting/schedule/queueCalendar.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Schedule/QueueCalendar.swift, ios/VirgaKit/Sources/VirgaPosting/Schedule/ScheduleJS.swift. Device days are in timeZone:. Instants are epoch ms.
- `src/posting/schedule/scheduleService.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Schedule/ScheduleService.swift. Calls go through ScheduleRequester, which VirgaBackend conforms to. Tested with recorded exchanges.
- `src/posting/schedule/scheduleSerialize.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Schedule/ScheduleSerialize.swift, ios/VirgaKit/Sources/VirgaPosting/Schedule/ScheduleSerialize+Reconstruct.swift. reconstructFromScheduled is async because it makes files through ComposerFiles. makePreviewUrl is injected. atob follows Node.
- `src/posting/pages/scheduleModel.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Pages/ScheduleModel.swift, ios/VirgaKit/Sources/VirgaPosting/Pages/ScheduleModel+Timers.swift, ios/VirgaKit/Sources/VirgaPosting/Pages/ScheduleModel+Picker.swift, ios/VirgaKit/Sources/VirgaPosting/Schedule/ScheduleJS.swift. postScheduledNow takes PostScheduledNowDeps<Target>; live(...) wires the app's services.
- `src/posting/pages/hubModel.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Pages/HubModel.swift, ios/VirgaKit/Sources/VirgaPosting/Schedule/ScheduleJS.swift. 
- `src/posting/pages/postedModel.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Pages/PostedModel.swift. Uses XRPCAgent and PublicAppView.getPosts over a transport. Tested with recorded exchanges.
- `src/posting/pages/draftActions.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Pages/DraftActions.swift. The actions take DraftActionDeps<Target>; live(...) wires them as DraftsPage.jsx does.

## API for the code that builds on it

### As the porter left it

All of this is in VirgaPosting (`import VirgaPosting`), under ios/VirgaKit/Sources/VirgaPosting/.

Conventions:
- Rows, schedules, limits and states are loose JSONValue with the web's member names.
- Instants are epoch-ms Doubles; NaN means an invalid date.
- `timeZone:` / `localZone:` is the device's zone (nil means AppLocale's active zone). A time without an offset is read in it.
- `locale:` nil means the active locale.
- Where the web reads Date.now(), the Swift function takes `now:`.
- A thrown error is read as the web's object by `ScheduledPostError.errorObject(_ error: any Error) -> JSONValue`, which covers BackendError's detail and payload. Every error type below conforms to `public protocol ScheduleErrorObject: Error { var errorObject: JSONValue { get } }`.
- Internal helpers are in Schedule/ScheduleJS.swift: instant, collapseSpace, first, count, startOfDay, setDate, dayKey, isoJSON.

SCHEDULE (Schedule/)

ScheduledPostError.swift, `enum ScheduledPostError`:
- `friendlyScheduleError(_ raw: JSONValue?, _ code: JSONValue? = nil) -> String`, plus a (String?, String?) form.
- `quotaMessage(_ payload: JSONValue?) -> String`.
- `scheduleErrorMessage(_ err: JSONValue?) -> String` and `scheduleErrorMessage(_ error: (any Error)?) -> String`.
- `reorderRefusal(_: JSONValue? | (any Error)?) -> String?`.
- `errorObject(_:)`.

QueueSuggestions.swift:
- `struct QueueSuggestion { dayKey, time; json }` and `QueueSuggestionsError`.
- `enum QueueSuggestions`:
  - `suggestionsFromBestTimes(_ best: JSONValue? = [], _ block: JSONValue? = 1) throws -> [QueueSuggestion]`, plus a `([(day: Int, col: Int)], Int)` form.
  - `missingSuggestions(_ schedule, _ suggestions: JSONValue?) throws -> [JSONValue]`, plus a typed `[QueueSuggestion]` form.
  - `mergeSuggestionsIntoSchedule(_ schedule, _:) throws -> JSONValue`, plus a typed form.
  - `scheduleFromSuggestions(_ suggestions, _ timezone: JSONValue?/String?, localZone:) -> JSONValue`.

QueueReorder.swift:
- Types:
  - `QueueRowsSplit { movable, occupied: [JSONValue]; json }`
  - `QueueMove { id: JSONValue?, scheduledFor: JSONValue; json }`
  - `QueueTimerConflict { id, message, problem; json }`
  - `QueueReorderPlan { assignment: [QueueAssignment], moves: [QueueMove], conflict: QueueTimerConflict?; json }`
- `enum QueueReorder`:
  - `splitQueueRows(_ rows: [JSONValue]?, now: Double, timeZone:) -> QueueRowsSplit`
  - `pendingMoves(_ assignment: JSONValue? | [QueueAssignment], timeZone:) -> [QueueMove]`
  - `queueTimerConflict(_ rows, _ assignment, now:, locale:, timeZone:) -> QueueTimerConflict?`
  - `planQueueReorder(_ schedule, _ rows, _ orderedIds: [JSONValue]? | [String], now:, locale:, timeZone:) throws -> QueueReorderPlan`

QueueCalendar.swift:
- Types:
  - `CalendarSlot { at, minute, row: JSONValue?, offSchedule }`
  - `CalendarDay { date (local midnight, ms), key, slots }`
  - `CalendarDays { days, laterCount, claimedCount; json }`
  - `CalendarZones { device, set, differs }`
- `enum QueueCalendar`:
  - `compactTime(_ ms: Double | JSONValue?, timeZone:) -> String`
  - `buildCalendarDays(_ schedule, _ rows: [JSONValue]? = [], _ dayCount: Double = 7, now:, timeZone:) throws -> CalendarDays`
  - `calendarZones(_ schedule, localZone:) -> CalendarZones`

ScheduleService.swift:
- `public protocol ScheduleRequester: Sendable { var did: String? { get }; func request(_ path: String, method: String, query: QueryParams?, body: JSONValue?, timeoutMs: Double) async throws -> JSONValue }`. `extension VirgaBackend: ScheduleRequester {}` is declared in this file.
- `ScheduleServiceError` (NEEDS_BACKEND, status 0).
- Result types:
  - `ScheduledList { rows, timerNotes, unavailable; json }`
  - `SkippedOccurrence { next, ended }`
  - `ReorderResult { moved: Double, fallback, failed: [Failure { id: JSONValue, error: any Error }], refusal: (any Error)?; json }`
- `enum ScheduleService`, constants and row checks:
  - Constants: maxPendingScheduled, maxReorderMoves, limitFeatures.
  - isActiveScheduledRow, countActiveScheduled, isTimerNoteRow, rowClientKey, canEditScheduledRow, canCancelScheduledRow, isRepeatingRow.
  - `isReorderUnsupported(JSONValue? | (any Error)?)`.
- `enum ScheduleService`, calls:
  - `listScheduled(_ req: (any ScheduleRequester)?, timeZone:) async throws -> ScheduledList`
  - `getScheduled(req, _ id: JSONValue?, timeZone:) -> JSONValue`
  - `getScheduledMedia(req, id) -> JSONValue`
  - `createScheduled(req, _ body: JSONValue, target: PostingEventBus? = .shared, timeZone:) -> JSONValue`
  - `updateScheduled(req, id, _ patch: JSONValue? = [:], target:, timeZone:) -> JSONValue`
  - `skipScheduled(...) -> SkippedOccurrence`
  - `stopRepeating`, `retryScheduled`, `acknowledgeTimerNote`: each `(req, id, target:, timeZone:)`
  - `reorderScheduled(req, _ moves: [JSONValue]? | [QueueMove], target:, timeZone:) -> ReorderResult`. Once the task is cancelled, the row-by-row fallback fails the remaining moves with CancellationError.
  - `cancelScheduled(req, id, target:) -> JSONValue`
- `enum ScheduleService`, limits:
  - `normalizeLimits(_ body: JSONValue?) -> JSONValue`
  - `getLimits(req) -> JSONValue`
  - `scheduledRoomProblem(_ limits, editing:)`
  - `scheduledUsageLine(_ limits)`

ScheduleSerialize.swift and ScheduleSerialize+Reconstruct.swift:
- Errors:
  - `ScheduleSerializeError(code, message, extra: [String: JSONValue])`, named ScheduleSerializeError. Its extras are postIndex, imageId, size and limit.
  - `ScheduleSerializeTypeError`
  - `Base64DecodeError`: Node's atob words.
- `ScheduleSerializeOptions(now: Double, scheduledFor: JSONValue? (nil is the state's time; .null too), queued: Bool?, tz: String?, repeat: JSONValue? (nil = undefined, .null = no repeat), repeatTz:, occurrence: Double?, resolveMention:, validationCache: = .shared, fit: TimerFit?, loadImage: (@Sendable (JSONValue) async throws -> ComposerFile?)?, media: PublishMedia (files read bytes; encoder + clock re-encode a card's own image), locale:, timeZone:)`.
- `ScheduleBody { scheduledFor: String, target, queued, payload: JSONValue, warnings: [JSONValue]; json (no warnings) }`.
- `enum ScheduleSerialize`:
  - Constants: `maxMediaBase64Chars` (Int) and `maxImageBytes` (Double).
  - `public static func blobToBase64(_ bytes: Data) -> String`. This is the adviser's call: AIService's fileprivate stand-in should be switched to it at the merge.
  - `blobToBase64(_ file: ComposerFile, files: any ComposerFiles) async throws -> String`
  - `atob(_ value: JSONValue?) throws -> Data`
  - `base64ToFile(_ base64: JSONValue?, _ type: JSONValue?, _ name: String, files:) async throws -> ComposerFile`
  - `serializeForSchedule(_ state: JSONValue? | ComposerState, _ options) async throws -> ScheduleBody`
  - `reconstructFromScheduled(_ row: JSONValue?, _ media: JSONValue? = [:], asDid: String?, files: any ComposerFiles, makePreviewUrl: (@Sendable (JSONValue) throws -> String?)? = nil, timeZone:) async throws -> ComposerState`

PAGES (Pages/)

ScheduleModel.swift, +Timers, +Picker, `enum ScheduleModel`:
- Types: ScheduledSections, RowReply, RowFacts, RowStatus, RowActions, TimerNoteArm, TimerNoteActions, ZonedDayGroup, TimerActed, TimerRowModel (json), CopyTarget, QuickPick, ScheduleModelError(code, message), ScheduleModelTypeError.
- The list and its rows:
  - `scheduledSections(_ rows, timeZone:)`
  - `rowReply(_)`
  - `rowFacts(_ row, now:, locale:, timeZone:)`
  - `rowTags(_ facts)`
  - `rowStatus(_ row, now:, timeZone:)`
  - `postNowCutoffMs`
  - `rowIsDueSoon(_, now:, timeZone:)`
  - `rowActions(_, now:, timeZone:)`
  - `timerNoteActions(_ row, now: = 0)`
- Times in a zone:
  - `zoneLabel(JSONValue?|String?)`
  - `formatInZone(_ value, _ tz: String?, now:, weekday:, locale:, timeZone:)`
  - `timeInZone(_ value, _ tz, locale:, timeZone:)`
  - `slotLabel(_ hhmm, locale:)`
  - `groupByZonedDay(_ rows, _ tz, now:, locale:, timeZone:) -> [ZonedDayGroup]`
- Reordering:
  - `previewOrder(_ rows, _ ids: [JSONValue])`
  - `moveId(_ ids: [JSONValue], _ id, _ delta: Double)`
  - `moveIdTo`
  - `movableIds(_ rows, now:, timeZone:)`
  - `applyAssignment(_ rows, JSONValue? | [QueueAssignment])`
- Limits:
  - `scheduledLimitsLine(_ limits)`
  - `timerLimitsLine(_ limits, _ fallback: JSONValue? | TimerUsage)`
  - `fullTimerBuckets(_ limits)`
- Timers:
  - `settledLabel`
  - `friendlyTimerError(_ code, _ raw)`
  - `ruleOfTimerRow(_ row, timeZone:) -> TimerRule`
  - `timerRowModel(_ row, now:, locale:, timeZone:) throws -> TimerRowModel`
  - `timerSections(_ groups: [TimerGroup], _ waiting) -> [TimerGroup]`
  - `deletedPostUris`
- The week:
  - `weeklyCount`
  - `weekSummary(_ schedule, locale:)`
  - `addSlot(_ schedule, _ day: String, _ time: JSONValue?, deviceZone: String?, localZone:) -> JSONValue?`
  - `removeSlot`, `clearDay`
  - `copyDay(_ schedule, _ from, _ to: [String], localZone:)`
  - `copyTargets`
  - `moveToZone(_ schedule, _ timezone: JSONValue?)`
  - `nextOpenSlots(_ schedule, _ rows, now:, count: Double = 5, timeZone:) throws -> [Double]`
  - `offScheduleRows(_ schedule, _ rows, now:, timeZone:) throws`
  - `isDefaultWeek`
- The picker:
  - `quickPicks(now:, _ tz: String?, min:, max:, localZone:) -> [QuickPick]`
  - `whenProblem(_ value, now:, min:, max:, timeZone:)`
- Posting a row now:
  - `postScheduledNow<Target>(_ row, did:, deps: PostScheduledNowDeps<Target>, now:, timeZone:) async throws -> PostScheduledNowResult { result, cancelled, timer: ArmOutcome?, notes }`
  - `PostScheduledNowDeps<Target>` holds closures: requester, getScheduledMedia, reconstructFromScheduled(row, media, asDid), targetFor, publish(state, target, resolveMention), resolveMention, cancelScheduled, skipScheduled?, emitPostsChanged(did, added), armTimer?.
  - `PostScheduledNowDeps<PublishTarget?>.live(requester:timers:files:media:targetFor:resolveMention:now:makePreviewUrl:target:timeZone:)` wires VirgaBackend, the reconstruct, Publish.publish, the bus and TimerService.armAfterPublish, as ScheduledPage.jsx does.

HubModel.swift, `enum HubModel`:
- Types: `ScheduledOverview { next, waiting, queued, atTime, failed; json }` and `TimersOverview { live, nextCheck }`.
- `countPhrase(_ n: Double? | JSONValue?, _ one, _ many?, locale:)`
- `scheduledOverview(_ rows: JSONValue?, limit: Double = 4, timeZone:)`
- `scheduledSnippet(_ row, max: Int = 120)`
- `draftRows(_ drafts: JSONValue?, deviceId:, limit: Double?, timeZone:) -> [JSONValue]`
- `rowFromPostView(_ view, _ did, timeZone:) -> JSONValue?`
- `mergePostRows(_ archive, _ feed, removed: [JSONValue], timeZone:)`
- `timersOverview(_ rows: JSONValue?, timeZone:)`
- `whenLabel(_ iso, now:, weekday:, locale:, timeZone:)`

PostedModel.swift, `enum PostedModel`:
- Types: PostedModelError(code?, message), PostedFilter, PostNow, PostAgainSeed (init(json:), json), PostedImageFile, PostedImages, PostAgainIntent, PostRowActions.
- `postedFilters`
- `isReplyRow(_ row, _ did)`
- `filterPostRows(_ rows, did:, filter:, query:)`
- `readPostNow(_ uri: String, agent: XRPCAgent?, transport:) async throws -> PostNow` (throws GONE)
- `readPostGates(_ uri, agent: XRPCAgent) async throws -> PostGates`
- `deletePost(_ uri, agent:)`
- `textForComposer`, `templateSeedFrom -> JSONValue`
- `postAgainSeed(_ record) -> PostAgainSeed`
- `fetchPostImages(_ images: [PostAgainSeed.Image]?, did:, pdsUrl:, transport:, files:) async -> PostedImages`
- `postAgainIntent(_ seed, did:, files: [PostedImageFile], missing: Int) -> PostAgainIntent`
- `postRowActions(_ row, canPost:, canSchedule:)`
- `gatesQuotesOnlyFor(_ offer: PostRowActions?, _ record)`

DraftActions.swift, `enum DraftActions`:
- Types:
  - DraftActionError(code, message)
  - DraftScheduleRequest { now, scheduledFor, queued, resolveMention, loadImage }
  - PreparedDraft { state, notes }
  - PostedDraft { result, notes, timer: ArmOutcome?, deleted }
  - ScheduledDraft { row, notes, deleted }
  - `DraftActionDeps<Target>` holds closures: openDraft(view, asDid, defaults) -> DraftMedia.Loaded; resolveDefaultGates(settings, XRPCAgent?) -> ResolvedDefaultGates; timerRoom?; targetFor; publish(state, target, resolveMention, requireAltText); emitPostsChanged; deleteDraft(XRPCAgent?, id); resolveMention; armTimer?; serializeForSchedule(state, DraftScheduleRequest) -> body JSON; createScheduled(req, body); requester?; loadImage?.
  - `DraftActionDeps<PublishTarget?>.live(did:target:requester:timers:media:draftMedia:makePreviewUrl:resolveMention:now:events:timeZone:)` wires them as DraftsPage.jsx does.
- `draftMeta(_ row, now:, locale:, timeZone:) -> [String]`
- `editedLabel(_ iso, now:, locale:, timeZone:)`
- `draftScheduleBlock(_ row, canSchedule:)` and `draftPostBlock(_ row, canPost:)`
- `prepareDraft`, `postDraftNow` and `scheduleDraft(view, did:, settings:, agent: XRPCAgent?, [scheduledFor:, queued:, now:], deps:)`
- `blobImageLoader(did:pdsUrl:transport:files:) -> @Sendable (JSONValue) async throws -> ComposerFile?`
- `draftActionMessage(_: JSONValue? | (any Error)?, action:)`

Test helpers (Tests/VirgaPostingTests):
- `ScheduleServiceFixture.requester(c, transport)`
- `HeardEvents(name)`: a fresh bus that records what it hears.
- `SerializeFixture`: hold bytes for `bytes:<base64>` refs, settle results (file lastModified and ref left out, long base64 as length plus sha256), previews, options from a case.
- `ScheduleModelParity.Script` and `DraftActionsParity.Script`: scripted deps that record every call.
- `ScheduleModelParity.ScriptedSchedule`: a requester that is only an account.
- `PostedModelParity.agent(transport)`.

### After the audit

The porter's summary still holds, with these changes. Everything is in VirgaPosting (`import VirgaPosting`), under ios/VirgaKit/Sources/VirgaPosting/.

Conventions: rows, schedules, limits and states are loose JSONValue with the web's member names. Instants are epoch-ms Doubles, and NaN is an invalid date. `timeZone:` or `localZone:` is the device's zone (nil means AppLocale's active zone); a time without an offset is read in it. `locale:` nil means the active locale. Where the web reads Date.now(), the Swift takes `now:`. A thrown error is read as the web's object by `ScheduledPostError.errorObject(_ error: any Error) -> JSONValue`. That covers BackendError (detail, payload), PublishError (problems) and every ScheduleErrorObject. CHANGED: it now also covers TimerServiceError (code, status, name, payload, with detail rebuilt as the body's string `error`), so `scheduleErrorMessage(outcome.error)` on an ArmOutcome or CreateTimerOutcome error says what the web says. Internal helpers are in Schedule/ScheduleJS.swift.

SCHEDULE (Schedule/)

ScheduledPostError, `enum ScheduledPostError`:
- `friendlyScheduleError(_ raw: JSONValue?, _ code: JSONValue? = nil)`, plus a (String?, String?) form.
- `quotaMessage(_ payload: JSONValue?)`.
- `scheduleErrorMessage(_: JSONValue? | (any Error)?)`.
- `reorderRefusal(_: JSONValue? | (any Error)?) -> String?`.
- `errorObject(_:)`.
- `protocol ScheduleErrorObject: Error { var errorObject: JSONValue { get } }`.

QueueSuggestions, `enum QueueSuggestions` (`struct QueueSuggestion { dayKey, time; json }`, `QueueSuggestionsError`):
- `suggestionsFromBestTimes(_ best: JSONValue? = [], _ block: JSONValue? = 1) throws -> [QueueSuggestion]`, plus a `([(day:Int, col:Int)], Int)` form.
- `missingSuggestions(_ schedule, _ suggestions: JSONValue?) throws -> [JSONValue]`.
- `mergeSuggestionsIntoSchedule(_ schedule, _ suggestions: JSONValue?) throws -> JSONValue`.
- CHANGED: the JSON forms now throw QueueSuggestionsError with the web's TypeError words for a day whose times are neither a list nor a string, and keep one undefined (null) per day, sorted last, for suggestions without a time. The typed `[QueueSuggestion]` forms of missing and merge don't throw and read such a day as empty.
- `scheduleFromSuggestions(_ suggestions, _ timezone: JSONValue?/String?, localZone:)`.

QueueReorder, `enum QueueReorder`:
- Types: QueueRowsSplit, QueueMove, QueueTimerConflict, QueueReorderPlan.
- `splitQueueRows(_ rows, now:, timeZone:)`.
- `pendingMoves(_ assignment: JSONValue? | [QueueAssignment], timeZone:)`.
- `queueTimerConflict(_ rows, _ assignment, now:, locale:, timeZone:) -> QueueTimerConflict?` (non-throwing).
- `planQueueReorder(_ schedule, _ rows, _ orderedIds: [JSONValue]? | [String], now:, locale:, timeZone:) throws -> QueueReorderPlan`.
- NEW: `public struct QueueReorderError: Error, ScheduleErrorObject (message; errorObject name 'TypeError')`. planQueueReorder throws it ("Cannot read properties of null (reading 'id')") when rows contain null.

QueueCalendar, `enum QueueCalendar` (CalendarSlot, CalendarDay, CalendarDays, CalendarZones): unchanged.
- `compactTime(_ ms: Double | JSONValue?, timeZone:)`.
- `buildCalendarDays(_ schedule, _ rows = [], _ dayCount: Double = 7, now:, timeZone:) throws`.
- `calendarZones(_ schedule, localZone:)`.

ScheduleService, `enum ScheduleService`:
- `public protocol ScheduleRequester: Sendable { var did: String? { get }; func request(_ path: String, method: String, query: QueryParams?, body: JSONValue?, timeoutMs: Double) async throws -> JSONValue }`, with `extension VirgaBackend: ScheduleRequester {}` declared in this file.
- `ScheduleServiceError` (NEEDS_BACKEND, status 0).
- Result types: ScheduledList, SkippedOccurrence, ReorderResult.
- Constants: maxPendingScheduled, maxReorderMoves, limitFeatures.
- Row checks: isActiveScheduledRow, countActiveScheduled, isTimerNoteRow, rowClientKey, canEditScheduledRow, canCancelScheduledRow, isRepeatingRow, isReorderUnsupported.
- Calls: `listScheduled(req, timeZone:)`, `getScheduled`, `getScheduledMedia`, `createScheduled(req, body, target: PostingEventBus? = .shared, timeZone:)`, `updateScheduled(req, id, patch, target:, timeZone:)`, `skipScheduled`, `stopRepeating`, `retryScheduled`, `acknowledgeTimerNote`, `reorderScheduled(req, [JSONValue]? | [QueueMove], target:, timeZone:)`, `cancelScheduled`.
- Limits: `normalizeLimits`, `getLimits`, `scheduledRoomProblem(_, editing:)`, `scheduledUsageLine`.
- CHANGED: a listed row that is an array spreads into its indices. The reorder fallback's announced ids leave out failed moves by position (a failed object id isn't announced).

ScheduleSerialize, `enum ScheduleSerialize`: unchanged.
- Errors: ScheduleSerializeError(code, message, extra: postIndex, imageId, size, limit), ScheduleSerializeTypeError, Base64DecodeError.
- `ScheduleSerializeOptions(now:, scheduledFor:, queued:, tz:, repeat:, repeatTz:, occurrence:, resolveMention:, validationCache:, fit:, loadImage:, media: PublishMedia, locale:, timeZone:)`.
- `ScheduleBody { scheduledFor, target, queued, payload, warnings; json }`.
- Constants: maxMediaBase64Chars, maxImageBytes.
- `public static func blobToBase64(_ bytes: Data) -> String` (the adviser's call), and `blobToBase64(_ file: ComposerFile, files:) async throws -> String`.
- `atob(_:) throws -> Data` and `base64ToFile(_, _, _, files:) async throws -> ComposerFile`.
- `serializeForSchedule(_ state: JSONValue? | ComposerState, _ options) async throws -> ScheduleBody`.
- `reconstructFromScheduled(_ row, _ media = [:], asDid:, files:, makePreviewUrl: = nil, timeZone:) async throws -> ComposerState`.

PAGES (Pages/)

ScheduleModel, `enum ScheduleModel` (ScheduledSections, RowReply, RowFacts, RowStatus, RowActions, TimerNoteArm, TimerNoteActions, ZonedDayGroup, TimerActed, TimerRowModel, CopyTarget, QuickPick, ScheduleModelError, ScheduleModelTypeError):
- The list: `scheduledSections`, `rowReply`, `rowFacts(_, now:, locale:, timeZone:)`, `rowTags`, `rowStatus(_, now:, timeZone:)`, `postNowCutoffMs`, `rowIsDueSoon`, `rowActions`, `timerNoteActions(_, now: = 0)`.
- Times in a zone: `zoneLabel`, `formatInZone(_, _ tz: String?, now:, weekday:, locale:, timeZone:)`, `timeInZone`, `slotLabel(_, locale:)`.
- `groupByZonedDay(_ rows, _ tz: String?, now:, locale:, timeZone:)`. CHANGED: tz nil now groups in the device's zone (timeZone), as the web's undefined does.
- Reordering: `previewOrder`, `moveId`, `moveIdTo`, `movableIds`, `applyAssignment`.
- Limits: `scheduledLimitsLine`, `timerLimitsLine(_, JSONValue? | TimerUsage)`, `fullTimerBuckets`.
- Timers: `settledLabel`, `friendlyTimerError`, `ruleOfTimerRow`, `timerRowModel(_, now:, locale:, timeZone:) throws`, `timerSections`, `deletedPostUris`.
- The week: `weeklyCount`, `weekSummary(_, locale:)`, `addSlot(_, _ day, _ time, deviceZone:, localZone:)`, `removeSlot`, `clearDay`, `copyDay(_, _, _, localZone:)`, `copyTargets`, `moveToZone`, `nextOpenSlots(_, _, now:, count: = 5, timeZone:) throws -> [Double]`, `offScheduleRows`, `isDefaultWeek`.
- The picker: `quickPicks(now:, _ tz, min:, max:, localZone:)`, `whenProblem(_, now:, min:, max:, timeZone:)`.
- Posting a row now: `postScheduledNow<Target>(_ row, did:, deps: PostScheduledNowDeps<Target>, now:, timeZone:) async throws -> PostScheduledNowResult { result, cancelled, timer: ArmOutcome?, notes }`, with `PostScheduledNowDeps<PublishTarget?>.live(requester:timers:files:media:targetFor:resolveMention:now:makePreviewUrl:target:timeZone:)`. Refusal codes NOT_CANCELLABLE and NOT_SKIPPABLE now match by code unit.

HubModel, `enum HubModel`: unchanged.
- `countPhrase`, `scheduledOverview(_, limit:, timeZone:)`, `scheduledSnippet(_, max:)`, `draftRows(_, deviceId:, limit:, timeZone:)`, `rowFromPostView`, `mergePostRows(_, _, removed:, timeZone:)`, `timersOverview`, `whenLabel(_, now:, weekday:, locale:, timeZone:)`.

PostedModel, `enum PostedModel`: unchanged.
- Types: PostedModelError, PostedFilter, PostNow, PostAgainSeed (init(json:)), PostedImageFile, PostedImages, PostAgainIntent, PostRowActions.
- `postedFilters`, `isReplyRow`, `filterPostRows`.
- `readPostNow(_ uri, agent:, transport:) async throws`, `readPostGates(_, agent:)`, `deletePost(_, agent:)`.
- `textForComposer`, `templateSeedFrom`, `postAgainSeed`.
- `fetchPostImages(_, did:, pdsUrl:, transport:, files:) async`, `postAgainIntent(_, did:, files:, missing:)`, `postRowActions(_, canPost:, canSchedule:)`, `gatesQuotesOnlyFor`.

DraftActions, `enum DraftActions`:
- Types: DraftActionError, DraftScheduleRequest, PreparedDraft, PostedDraft, ScheduledDraft, and `DraftActionDeps<Target>` with `.live(did:target:requester:timers:media:draftMedia:makePreviewUrl:resolveMention:now:events:timeZone:)`.
- `draftMeta(_, now:, locale:, timeZone:)`, `editedLabel`, `draftScheduleBlock(_, canSchedule:)`, `draftPostBlock(_, canPost:)`.
- `prepareDraft`, `postDraftNow` and `scheduleDraft(view, did:, settings:, agent:, [scheduledFor:, queued:, now:], deps:)`.
- `blobImageLoader(did:pdsUrl:transport:files:)`.
- `draftActionMessage(_: JSONValue? | (any Error)?, action:)`. Its codes (MEDIA_MISSING, NEEDS_BACKEND, DRAFT_LIMIT, MISSING_SCOPE) now match by code unit.

Test helpers (Tests/VirgaPostingTests), unchanged: ScheduleServiceFixture.requester, HeardEvents, SerializeFixture, ScheduleModelParity.Script and ScriptedSchedule, DraftActionsParity.Script, PostedModelParity.agent.

## Gaps and deliberate differences

At port time:

- The four page files have no React hooks, so no @Observable model was made. What holds state there is a set of async flows over injected deps: postScheduledNow, prepareDraft, postDraftNow and scheduleDraft, and readPostNow, readPostGates, deletePost and fetchPostImages. They are held to scripted-dep fixtures or recorded exchanges, plus behaviour tests over the live() wirings and MockTransport. The pages' own state (hubParts.jsx useLoad, ScheduledPage.jsx's reorder and optimistic redraws) belongs to ui-posting in VirgaUI.
- ScheduleRequester is a new seam beside timers' TimerRequester, because the schedule calls need timeoutMs. `extension VirgaBackend: ScheduleRequester {}` lives in Schedule/ScheduleService.swift. The merge should check that no other chain adds it too.
- The adviser chain's fileprivate blobToBase64(_ bytes: Data) -> String in Adviser/AIService.swift should be switched to ScheduleSerialize.blobToBase64(_:) at the merge.
- reconstructFromScheduled is async (files are made through ComposerFiles). makePreviewUrl defaults to none, because URL.createObjectURL has no logic-side equivalent; VirgaUI must pass its own. A made file's lastModified is the files' clock, so fixtures leave it out on both sides (Node's File reads the machine clock).
- slotLabel and weekSummary format in `locale:` (nil means the active locale). The web uses the browser's own locale (toLocaleTimeString(undefined)); that is already in WEB-BUGS.md.
- The live() wirings pass a timer snippet of .null where timerSnippet gives nothing; the web passes timerSnippet's null. They also use Publish.publish's shared duplicate guard, as the web does.
- Divergences on corrupt input only, documented in the Swift: (1) plain-object prototype lookups: a code of 'constructor' in scheduleErrorMessage, a cell day of 'length' or an array method in suggestionsFromBestTimes; (2) a day's slots that aren't a list in weekSummary, addSlot and copySlots, where the web throws spreading or sorting; (3) suggestions that are numbers or strings; (4) draftPostBlock on a row without text, where the web throws (summarizeDraft rows always have text); (5) a non-File `file` reaching blobToBase64 throws the web's TypeError words, but a typed ComposerFile can't be fed a Blob-like object.
- VirgaDemo's demo server answers /api/schedule/* (merging separately). These tests use recorded exchanges and MockTransport only, not the demo server.

Still open after the audit:

- VirgaPosting/Schedule/PostingQueue.swift (composer domain, not edited): zonedWallTime(_, nil) and zonedWallTimeToUtc(_, _, nil) read a nil zone as the name "undefined" and return nil. The web passes undefined to Intl and reads it as the device's zone (checked: zonedWallTime(ms, undefined) gives the local wall time). groupByZonedDay now works around this; other callers that pass nil get nil. The composer domain should fix it.
- Documented corrupt-input divergences still stand. (1) Plain-object prototype lookups: code 'constructor' in scheduleErrorMessage, cell day 'length' or an array method in suggestionsFromBestTimes. (2) A day's slots that aren't a list in weekSummary, addSlot and copySlots, where the web throws spreading or sorting. (3) draftPostBlock on a row without text. (4) The standalone queueTimerConflict and pendingMoves don't throw where the web does. (5) In rowFacts and weeklyCount, a `length` member that is a string or a fraction (the web concatenates or keeps the fraction).
- TimerServiceError (Timers/TimerService.swift, timers domain) has no `detail` member. errorObject rebuilds detail from payload, which matches requestError. A TimerServiceError built with a payload but no server body would gain a detail it shouldn't have; none is built that way today.
- No @Observable model was made. scheduleModel.js, hubModel.js, postedModel.js and draftActions.js export only functions (no hooks), so the porter's choice of async flows over injected deps is correct.
- The merge should check that ScheduleRequester (`extension VirgaBackend: ScheduleRequester {}` in Schedule/ScheduleService.swift) isn't declared twice, and should switch AIService's fileprivate blobToBase64 stand-in to ScheduleSerialize.blobToBase64(_:).
- The porter's web bugs, all reproduced in Node and none yet in ios/porting/WEB-BUGS.md. (1) Pacific/Chatham, Sunday slots 02:45 and 03:45: enumerateSlots gives 2026-09-26T14:00Z twice. (2) timerRowModel throws reading toLowerCase for an acted step with a detail but no action. (3) scheduleErrorMessage({code:'constructor'}) returns a function. (4) suggestionsFromBestTimes([{day:'length',col:9}]) gives dayKey 7. (5) rowFacts counts a string images member's characters. (6) fetchPostImages keeps Content-Type parameters in the file extension. (7) draftPostBlock throws on a row without text. No new web bugs found beyond these.

## Audit

- **medium** `src/posting/schedule/scheduledPostError.js scheduleErrorMessage, as TimerDialog.jsx and TimersPage.jsx call it on a timer outcome's error` ScheduledPostError.errorObject didn't recognise TimerServiceError, which the timer service hands back in an ArmOutcome or CreateTimerOutcome, or throws. It read the error by its message alone, so the code, status, payload and detail were lost. A full timer bucket (QUOTA_EXCEEDED with feature postTimers) said 'Quota.' instead of the slot sentence. NEEDS_BACKEND said the service's own words instead of Virga's sentence. A 400 carrying the server's sentence said 'That didn't work. Try again.'. Fixed in Schedule/ScheduledPostError.swift: errorObject now reads the code, status, name and payload, and rebuilds detail the way requestError does (the body's error when it is a string). The new behaviour test ScheduledPostErrorBehaviour.aTimerRefusalReadsAsTheRequestersError checks each kind of refusal against the BackendError it came from. *Fixed:* True
- **low** `src/posting/pages/scheduleModel.js groupByZonedDay(rows, undefined, now)` With no zone (nil), the Swift grouped every row as 'No time', because PostingQueue read nil as the zone name "undefined". The web passes undefined to Intl, which uses the device's zone. Fixed: nil now means the device's zone. Cases added for undefined and null zones in three device zones. The parity test now passes null as the name 'null'. *Fixed:* True
- **low** `src/posting/schedule/queueSuggestions.js missingSuggestions / mergeSuggestionsIntoSchedule` Two corrupt-input divergences. (1) A day whose times are a number, an object or true: the web throws a TypeError ('(slots[s.dayKey] || []).includes is not a function' or 'existing.includes is not a function'), while the Swift silently overwrote or skipped the day. (2) A suggestion without a time: the web adds one undefined per day, which sorts last and which includes(undefined) finds again. The Swift added a second null every time and sorted it as the string 'null'. Fixed for the JSON forms; the typed overloads still read such a day as empty. Cases added: 4 weeks and 3 suggestion sets, crossed with all the others. *Fixed:* True
- **low** `src/posting/schedule/queueReorder.js planQueueReorder (via queueTimerConflict's Object.fromEntries(rows.map(r => [r.id, r])))` When rows contain null, the web throws "Cannot read properties of null (reading 'id')" after the re-pack. The Swift returned a plan. Fixed: it now throws the new QueueReorderError, which carries the web's words and is named TypeError. Cases added, including one with a bad zone, which throws its own zone error first. *Fixed:* True
- **low** `src/posting/schedule/scheduleService.js normalizeRow (listScheduled, getScheduled, create, update)` A row that is an array is spread by the web into an object of its indices. The Swift passed it through as an array. Fixed, with a recorded case ('a-list-row'). *Fixed:* True
- **low** `src/posting/schedule/scheduleService.js reorderScheduled fallback (failed.some((f) => f.id === m.id))` The web compares ids by reference, so a failed move whose id is an object is left out of the announced ids, while another move with an equal-looking id is kept. Swift's strictEquals never equates objects, so the failed object id was announced as moved. Fixed by matching failed moves by position as well as by value. Recorded case 'fallback-object-ids' added. *Fixed:* True
- **low** `src/posting/pages/draftActions.js draftActionMessage; src/posting/pages/scheduleModel.js postScheduledNow` The error code was compared with JSONValue's ==, which uses Swift's canonical equivalence. A code spelled with a Kelvin sign (NEEDS_BACKEND, NOT_SKIPPABLE) therefore counted as the refusal it only resembles; the web's === compares code units (PORTING's rule). Fixed with strictEquals, with one case for each function. *Fixed:* True
- **low** `src/posting/schedule/queueReorder.js queueTimerConflict / pendingMoves (standalone)` Left as documented, on corrupt input only. With a null row, the standalone queueTimerConflict reads it as a row with no id, and pendingMoves reads an assignment that isn't a list as no moves; the web throws in both cases. Making them throwing would break the published, non-throwing API, and the pages only call planQueueReorder, which now throws. This is recorded in the module map and the file header. *Fixed:* False

## Web bugs noticed

- src/posting/schedule/postingQueue.js (enumerateSlots, as reached by recomputeQueueAssignment / queueReorder.js planQueueReorder): Suppose a week holds both a wall time that a spring-forward gap skips and the time that gap resolves to. The slot walk then gives the same instant twice, and re-packing gives two queued posts the same minute. For example: Pacific/Chatham, Sunday slots 02:45 and 03:45. The reorder planned on 2026-09-26 assigned both 'c3' and 'c2' to 2026-09-26T14:00:00.000Z (fixture scheduling.queueReorder, the Chatham planQueueReorder case). The Swift keeps the web's behaviour.
- src/posting/pages/scheduleModel.js timerRowModel (actedText): Take a settled timer whose `acted` step has a detail but no string action, for example { ok: true, detail: 'replies limited' }. It throws "Cannot read properties of undefined (reading 'toLowerCase')", so the row model fails instead of saying 'Acted: replies limited.'. This is held in the fixture, and the Swift throws the same words.
- src/posting/pages/postedModel.js fetchPostImages: when the PDS's Content-Type carries parameters ('IMAGE/GIF; charset=x'), the picture is named 'posted-image-3.gif;charset=x'. The extension is cut from the whole type, parameters included.
- src/posting/schedule/scheduledPostError.js scheduleErrorMessage: BY_THROWN_CODE[err.code] is a plain-object lookup. An error with code 'constructor' returns Object's function in place of a sentence (checked in Node: typeof result is 'function').
- src/posting/schedule/queueSuggestions.js suggestionsFromBestTimes: DAY_KEYS[cell.day] reads the array's own 'length'. A cell { day: 'length', col: 9 } becomes { dayKey: 7, time: '09:00' }.
- src/posting/pages/draftActions.js draftPostBlock throws reading `row.text.trim()` for a row without text. Rows from summarizeDraft always have text, so only hand-made rows reach it.
- src/posting/pages/scheduleModel.js rowFacts counts a string `images` member's characters as images (`embed.images?.length`). An embed with images 'abc' reads as 3 images. This happens on corrupt rows only.
