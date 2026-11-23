# publish: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported and audited (2026-11-22; wave 7, Chain A, step 1): src/posting/lib (publish.js, publishRecord.js, linkCard.js) and src/posting/drafts.

Parity cases at port time: 522; the audit added 51.

Tests at port time: The whole package passes under swift test on Linux (Swift 6.4.2): per target 194/32, 57/12, 406/75 (VirgaPostingTests, was 358/65), 99/26, 152/29, 140/24, 144/23, 176/31, 128/16 tests/suites. The new suites (Publish*, LinkCard*, Draft*: 75 tests in 18 suites) passed 5 runs in a row with --parallel. PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 161 of 161 passed (all generators, which shows the module reset in my generators doesn't disturb the later ones). npx eslint ios is clean and prettier --check passes on every new generator. All five web files are stamped, and parity:drift reports nothing for them.

Tests after the audit: The whole package passes under swift test on Linux (Swift 6.4.2). Per target, tests/suites: 194/32, 57/12, 407/75 (VirgaPostingTests, was 406/75), 99/26, 152/29, 140/24, 144/23, 176/31, 128/16. The domain's suites (Publish*, LinkCard*, Draft*: 76 tests in 18 suites) passed three runs in a row with --parallel. PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 161 of 161 passed. npx eslint ios is clean, and prettier --check passes on every publish generator. Commits on ios/w7-a: 6d3eefb (blob type and the uploadCardThumb deadline), ca20275 (undefined members, strict event check), d35c3c4 (isDraftLimitError by code unit), a073b88 (video file check, more error shapes), bd9c6b9 (DraftsError as a JS error). The d35c3c4 message says five new cases; it added four.

## Files

- `src/posting/lib/publishRecord.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Lib/PublishRecord.swift. Every export ported. Timeouts are waits on a NetworkClock; a write that loses its race isn't called off (as the web's isn't), and the race waits for its cleared timer so the wait is recorded before it returns.
- `src/posting/lib/linkCard.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Lib/LinkCard.swift. normalizeAssociatedRefs forwards to posting-text's Embeds.normalizeAssociatedRefs (no second copy). The web's signal is `deadlineMs` plus task cancellation. The File API seam is the new Lib/ComposerFiles.swift (no web module of its own).
- `src/posting/lib/publish.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Lib/Publish.swift. fetch/compress/decode/signal map to PublishMedia (transport, ImageEncoder, clock) and task cancellation; record keys come from an injected mintTid. A non-string post text reads as '' where the web throws TypeError.
- `src/posting/drafts/draftMedia.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Drafts/DraftMedia.swift. IndexedDB is FileStoreDraftMedia over VirgaCore's FileStore (DraftMedia.storage, set at launch); without it MemoryDraftMedia for the run. makePreviewUrl defaults to none (no createObjectURL).
- `src/posting/drafts/drafts.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Drafts/Drafts.swift, ios/VirgaKit/Sources/VirgaPosting/Drafts/Drafts+Shapes.swift. All exports ported. The SDK's output validation isn't ported (a page's broken entries are filtered where the web would refuse the page). isDraftLimitError doesn't read constructor.name (the SDK's DraftLimitReachedError is an XRPCError whose `error` it reads).

## API for the code that builds on it

### As the porter left it

All in VirgaPosting (import VirgaPosting), under ios/VirgaKit/Sources/VirgaPosting/. Values are JSON in and JSON out with the web's member names. nil means undefined.

FILES (Lib/ComposerFiles.swift, the web's File/Blob)
- `protocol ComposerFiles: Sendable`:
  - `bytes(of: ComposerFile) async throws -> Data`
  - `makeFile(_ data: Data, name: String?, type: String, lastModified: Double?) async throws -> ComposerFile`
  - `storedFile(at path: String, in store: any FileStore, name:type:size:lastModified:) async throws -> ComposerFile?` (by default it reads the bytes and calls makeFile; the app can override it to point at the file where it lies)
- `actor InMemoryComposerFiles(zeroFilled: Bool = true, now:)`: hold(_:ref:), snapshot. A file without a ref reads as `size` zero bytes.
- `ComposerFileGoneError`.
- VirgaUI must implement ComposerFiles over temporary files, with `ref` the path.

PUBLISH RECORD (Lib/PublishRecord.swift, `enum PublishRecord`)
- Constants: defaultTimeoutMs 30000, defaultAttempts 2.
- Error checks:
  - isTransientNetworkError(JSONValue?) throws -> Bool, and (any Error)? -> Bool
  - isRetriablePublishError (the same two forms)
  - errorObject(any Error) -> JSONValue: the web's Error object {name, message, code?, status?, error?, timedOut?, canceled?}
- Repo calls: getRecord(agent, repo:collection:rkey:), createRecord(agent, repo:collection:rkey:record:), applyWrites(agent, repo:validate:writes: [ApplyWritesCreate]). Each returns the answer's data.
- publishWithIdempotentRetry(_ agent: XRPCAgent, repo:, collection:, rkey: String? = nil, timeoutMs:, attempts:, clock: NetworkClock = HTTP.clock, mintTid: @Sendable (Double) throws -> String = ThreadBatch.nextTid, _ doWrite: @escaping @Sendable (String) async throws -> JSONValue) async throws -> JSONValue
- createRecordIdempotent(agent, repo:collection:record:rkey:timeoutMs:attempts:clock:mintTid:)
- needsThreadgateRecord / needsPostgateRecord, each taking [JSONValue]? or JSONValue?
- buildGateWrites(did:rkey:threadgateRules: [JSONValue]?, postgateRules:, createdAt: JSONValue? (nil = now), now: Double) -> [ApplyWritesCreate]
- createPostWithGates(agent, repo:, collection: = "app.bsky.feed.post", record:, threadgateRules:, postgateRules:, rkey:, timeoutMs:, attempts:, clock:, mintTid:) -> JSONValue (the post's data)
- Errors: PublishTimeoutError(timedOut), MissingCreateResultError, NothingThrownError, TransientCheckTypeError.
- `ApplyWritesCreate.json`.

LINK CARDS (Lib/LinkCard.swift, `enum LinkCard`)
- Constants: cardybOrigin, cardTitleMax, cardDescriptionMax, maxAssociatedRefs.
- normalizeAssociatedRefs (Embeds').
- fetchLinkCard(_ url: String?, deadlineMs: Double? = nil, transport:) async throws -> JSONValue? (the card {url,title,description,thumb,associatedRefs?}). It throws only when the caller cancelled, or when the caller's deadline, if no later than 10 s, ran out.
- fetchLinkCard(transport:) -> @Sendable (String) async throws -> JSONValue? is the library's FetchLinkCard: pass `LinkCard.fetchLinkCard(transport: t)` at the merge.
- fetchCardThumbnail(_:media:deadlineMs:) -> ComposerFile
- uploadCardThumb(_ target: PublishTarget, _ card: JSONValue?, media:, deadlineMs:) -> JSONValue? (the blob)
- LinkCardError.

PUBLISH (Lib/Publish.swift)
- `struct PublishTarget(did:, agent: XRPCAgent, pdsUrl:)`
- `struct PublishMedia(files: any ComposerFiles, encoder: any ImageEncoder, transport: = HTTP.transport, clock: = HTTP.clock)`. Its clock times every write, check, compress and video poll, so give it a clock whose sleep really waits. NetworkClock.instant would fire the 30 s write timeouts at once.
- `struct PublishError: JSErrorConvertible, CancelMarkedError`: name "PublishError", code, message, problems: [ComposerProblem]?, cause, status (0 becomes nil). ComposerSubmit.publishErrorView reads it.
- `struct PublishResult: Codable`: posts [Ref{uri,cid}], root, written [{uri,cid,record}], warnings [JSONValue].
- `final class DuplicateGuard(windowMs:now:)`: isDuplicate, remember, clear.
- `enum Publish`:
  - imageUploadConcurrency, duplicateWindowMs, createDuplicateGuard, defaultDuplicateGuard
  - `typealias UploadVideo = @Sendable (PublishTarget, ComposerFile, @escaping @Sendable (VideoProgress) -> Void) async throws -> UploadedVideo`
  - defaultUploadVideo(media:now:randomBytes:)
  - publishSignature(JSONValue? | ComposerState, String?) -> String
  - buildPostRecords(_ state: JSONValue, nowMs:, blobs: [JSONValue], texts: [JSONValue]) throws -> [JSONValue], plus a (ComposerState, now: Date, blobs:, texts: [FacetedText]) form
  - publish(_ state: JSONValue? | ComposerState, _ target: PublishTarget?, media:, onProgress: (@Sendable (JSONValue) -> Void)?, resolveMention:, now: @Sendable () -> Double, requireAltText:, duplicateGuard: DuplicateGuard? = .defaultDuplicateGuard, uploadVideo: UploadVideo? = nil, validationCache: = .shared, mintTid: = ThreadBatch.nextTid, timeZone:) async throws -> PublishResult
  - Progress events have the web's shapes: {phase: uploading|uploaded|video|writing, kind, postIndex, id, blob, blobDid, jobId, step, progress, done, total, count}. Image events arrive in completion order.

DRAFT MEDIA (Drafts/DraftMedia.swift)
- `struct DraftMediaEntry`: ref, file/name/type/size/savedAt as JSONValue?; json; init(json:).
- `protocol DraftMediaStore`: persistent, put throws, get, remove, refs. get, remove and refs never throw (the web's guarded handle).
- `actor MemoryDraftMedia`.
- `struct DraftMediaStorage(store: any FileStore, files: any ComposerFiles)`.
- `struct FileStoreDraftMedia(did:storage:)`: lays files out under `<escaped postingDbName(did)>/media/<escaped ref>/{file, entry.json}`. A put is all or none; refs come back sorted by code unit.
- `enum DraftMedia`:
  - postingDbPrefix, localRefPrefix, postingDbName, isVirgaLocalRef, randomUUID, newLocalRef(uuid:)
  - `storage: Locked<DraftMediaStorage?>`: the APP MUST SET IT AT LAUNCH (DiskFileStore plus its ComposerFiles)
  - openDraftMedia(did, storage:) (cached per DID), resetDraftMedia
  - stateLocalRefs -> [String]
  - storeDraftMedia(did, state, media:, now:, newRef:) async throws -> Stored{state, refs}
  - loadDraftMedia(did, state, media:, makePreviewUrl: (@Sendable (JSONValue) throws -> String?)?) -> Loaded{state, missing}
  - missingDraftMedia -> [JSONValue]
  - removeDraftMedia(did, [JSONValue]? | [String], media:)
  - pruneDraftMedia(did, keep: [JSONValue]?, media:, savedBefore:) -> [String]

DRAFTS (Drafts/Drafts.swift, Drafts+Shapes.swift, `enum Drafts`)
- Constants: limits, deviceNameDefault, postingDeviceKey, draftLimitMessage, orphanMediaMinAgeMs, cardWaitMs.
- postingDeviceId(_ store: KeyValueStore?, uuid:) -> String?
- isDraftLimitError(JSONValue? | any Error?)
- Reading: listDrafts(_ agent: XRPCAgent?, cursor: JSONValue?, limit: JSONValue?) -> DraftPage{drafts, cursor} and listAllDrafts(agent, maxPages: 50) -> DraftList{drafts, complete}. Both always go through withBlueskyAppView().
- Writing:
  - createDraft(agent, state: JSONValue, DraftSaveOptions) -> SavedDraft{id, state, draft, recreated; json}
  - updateDraft(agent, id: String?, state, opts) -> SavedDraft
  - deleteDraft(agent, id, localRefs: [JSONValue]?, media:, target:)
- Opening: openDraft(view, asDid:, defaults:, media:, makePreviewUrl:, fetchCard: DraftCardFetch? = networkCardFetch(), readId:) -> DraftMedia.Loaded, with completeDraftCards(state, fetchCard:, timeoutMs:) -> [JSONValue?]? and networkCardFetch(transport:).
- pruneOrphanedDraftMedia(agent, did, media:, now:, minAgeMs:, store:, session: AutosaveSession)
- Shapes: composerStateToDraft(state, texts:, deviceId:, deviceName:, owner:, locale:) throws -> JSONValue; draftToComposerState(view, asDid:, defaults:, readId:) -> JSONValue (not normalized: load it with the composer's load action); draftLocalRefs -> [JSONValue]; summarizeDraft(view, deviceId:) -> JSONValue; readId.
- `struct DraftsError{message, code (DRAFT_TOO_LONG/DRAFT_LIMIT), postIndex, cause}`.
- `struct DraftSaveOptions(texts:, resolveMention:, validationCache:, device: .thisDevice(store:) | .given(String?), deviceName:, media:, target: PostingEventBus? = .shared, now:, newRef:, uuid:, locale:)`. The app passes `.thisDevice(store: its KeyValueStore)`; the default store is nil, which means no device id.
- `typealias DraftCardFetch = @Sendable (String, Double?) async throws -> JSONValue?`
- Seams: for ComposerSubmit.finishSource's deleteDraft, pass `{ agent, id in try await Drafts.deleteDraft(agent, id.stringValue) }`. ComposerLoaders.loadDraftTarget can open with Drafts.openDraft.

TEST HELPERS (Tests/VirgaPostingTests)
- PublishTestSupport.swift:
  - PublishFixture (server, token, me, now, agent(transport, did:))
  - FixedTIDs (_publish.js's tidClock, clock id 7)
  - ScriptedTimers(fired, transport: CountingTransport): it records waits and holds a fired wait until the recorded number of requests has been sent
  - CountingTransport
  - replayTransport (understands {$hang})
  - checkReplay, publishOutcome
  - PublishEncoder (_publish.js's scriptedImages), publishMedia
- DraftMediaParityTests.swift: CountingUUIDs, storeJSON.
- DraftsParityTests.swift: DraftsFixture.canon, which names read ids and new ids.
- Generator helpers are in ios/parity/cases/_publish.js:
  - agentFor (an Agent over createBackendFetchHandler; make it inside the recorded function)
  - pds(script), a fake PDS
  - withTimers(fire, fn, {sent, fired}), which leaves blobs.js's deadlines out
  - loadFresh(paths): vi.resetModules, with tid.js's nextTid replaced by a fixed clock
  - withFixedDate, withUuids, scriptedImages, ok/fail, methodOf/inputOf/paramsOf

### After the audit

All in VirgaPosting (import VirgaPosting), under ios/VirgaKit/Sources/VirgaPosting/. Values are JSON in and JSON out with the web's member names. nil means undefined.

FILES (Lib/ComposerFiles.swift, the web's File and Blob)
- `protocol ComposerFiles: Sendable`:
  - `bytes(of: ComposerFile) async throws -> Data`
  - `makeFile(_ data: Data, name: String?, type: String, lastModified: Double?) async throws -> ComposerFile`
  - `storedFile(at path: String, in store: any FileStore, name:type:size:lastModified:) async throws -> ComposerFile?`. By default it reads the bytes and calls makeFile; the app can override it to point at the file where it lies.
- `actor InMemoryComposerFiles(zeroFilled: Bool = true, now:)`: hold(_:ref:), snapshot. A file without a ref reads as `size` zero bytes.
- `ComposerFileGoneError`.
- VirgaUI must implement ComposerFiles over temporary files, with `ref` the path.

PUBLISH RECORD (Lib/PublishRecord.swift, `enum PublishRecord`)
- Constants: defaultTimeoutMs 30000, defaultAttempts 2.
- Error checks:
  - isTransientNetworkError, in two forms: (JSONValue?) throws -> Bool, and (any Error)? -> Bool.
  - isRetriablePublishError, in the same two forms.
  - errorObject(any Error) -> JSONValue: the web's Error object {name, message, code?, status?, error?, timedOut?, canceled?}.
- Repo calls, each returning the answer's data:
  - getRecord(agent, repo:collection:rkey:)
  - createRecord(agent, repo:collection:rkey:record:)
  - applyWrites(agent, repo:validate:writes: [ApplyWritesCreate])
- publishWithIdempotentRetry(_ agent: XRPCAgent, repo:, collection:, rkey: String? = nil, timeoutMs:, attempts:, clock: NetworkClock = HTTP.clock, mintTid: @Sendable (Double) throws -> String = ThreadBatch.nextTid, _ doWrite: @escaping @Sendable (String) async throws -> JSONValue) async throws -> JSONValue
- createRecordIdempotent(agent, repo:collection:record:rkey:timeoutMs:attempts:clock:mintTid:)
- needsThreadgateRecord and needsPostgateRecord, each taking [JSONValue]? or JSONValue?.
- buildGateWrites(did:rkey:threadgateRules: [JSONValue]?, postgateRules:, createdAt: JSONValue? (nil = now), now: Double) -> [ApplyWritesCreate]
- createPostWithGates(agent, repo:, collection: = "app.bsky.feed.post", record:, threadgateRules:, postgateRules:, rkey:, timeoutMs:, attempts:, clock:, mintTid:) -> JSONValue (the post's data)
- Errors: PublishTimeoutError(timedOut), MissingCreateResultError, NothingThrownError, TransientCheckTypeError.
- `ApplyWritesCreate.json`.

LINK CARDS (Lib/LinkCard.swift, `enum LinkCard`)
- Constants: cardybOrigin, cardTitleMax, cardDescriptionMax, maxAssociatedRefs.
- normalizeAssociatedRefs forwards to Embeds' (no second copy).
- fetchLinkCard(_ url: String?, deadlineMs: Double? = nil, transport:) async throws -> JSONValue?: the card {url,title,description,thumb,associatedRefs?}. It throws only when the caller cancelled, or when the caller's deadline ran out (counted only if it is no later than 10 s). The request's deadline is the sooner of deadlineMs and 10 s.
- fetchLinkCard(transport:) -> @Sendable (String) async throws -> JSONValue? is the library's FetchLinkCard. Pass `LinkCard.fetchLinkCard(transport: t)` at the merge.
- fetchCardThumbnail(_:media:deadlineMs:) -> ComposerFile. Its type is the response's as Node's fetch reads it: Fetch's extract-a-MIME-type and MIME Sniffing's parse and serialize, lower-cased as the Blob constructor does, then 'image/jpeg' unless the type starts with image/.
- uploadCardThumb(_ target: PublishTarget, _ card: JSONValue?, media:, deadlineMs:) -> JSONValue? (the blob). It throws when the caller cancelled, or when deadlineMs (no later than 10 s) ran out while the page's image was fetched. Otherwise it is nil on any failure. The deadline doesn't reach the upload.
- LinkCardError.
- Internal: blobType, extractMimeType, parseMimeType, serializeMimeType, splitHeaderValue, collectQuotedString.

PUBLISH (Lib/Publish.swift)
- `struct PublishTarget(did:, agent: XRPCAgent, pdsUrl:)`
- `struct PublishMedia(files: any ComposerFiles, encoder: any ImageEncoder, transport: = HTTP.transport, clock: = HTTP.clock)`. Its clock times every write, check, compress and video poll, so give it a clock whose sleep really waits and returns when cancelled. NetworkClock.instant would fire the 30 s write timeouts at once.
- `struct PublishError: JSErrorConvertible, CancelMarkedError`: name "PublishError", code, message, problems: [ComposerProblem]?, cause, status (0 becomes nil). ComposerSubmit.publishErrorView reads it.
- `struct PublishResult: Codable`: posts [Ref{uri,cid}], root, written [{uri,cid,record}], warnings [JSONValue].
- `final class DuplicateGuard(windowMs:now:)`: isDuplicate, remember, clear.
- `enum Publish`:
  - imageUploadConcurrency, duplicateWindowMs, createDuplicateGuard, defaultDuplicateGuard
  - `typealias UploadVideo = @Sendable (PublishTarget, ComposerFile, @escaping @Sendable (VideoProgress) -> Void) async throws -> UploadedVideo`
  - defaultUploadVideo(media:now:randomBytes:)
  - publishSignature(JSONValue? | ComposerState, String?) -> String
  - buildPostRecords(_ state: JSONValue, nowMs:, blobs: [JSONValue], texts: [JSONValue]) throws -> [JSONValue], plus a (ComposerState, now: Date, blobs:, texts: [FacetedText]) form
  - publish(_ state: JSONValue? | ComposerState, _ target: PublishTarget?, media:, onProgress: (@Sendable (JSONValue) -> Void)?, resolveMention:, now: @Sendable () -> Double, requireAltText:, duplicateGuard: DuplicateGuard? = .defaultDuplicateGuard, uploadVideo: UploadVideo? = nil, validationCache: = .shared, mintTid: = ThreadBatch.nextTid, timeZone:) async throws -> PublishResult
  - A video `file` that isn't a ComposerFile is checked with Video.validateVideoFile first (VIDEO_MISSING and the rest, as video.js does).
  - Progress events have the web's shapes, with a member the web leaves undefined absent: {phase: uploading|uploaded|video|writing, kind, postIndex, id (absent when the image has none), blob, blobDid, jobId (null when none), step, progress, done, total, count}. Image events arrive in completion order.
  - Cancelling the caller's task is the web's signal, and is checked once, after the uploads (PublishError ABORTED, "Cancelled."), as the web checks it. The texts are resolved in a task of their own, and the write and its landed-check run in PublishRecord.withTimeout's unstructured tasks, so a cancel that comes after that check reaches neither: a post cancelled while its mentions are still resolving once the uploads are done, or while it is written, still goes out, as on the web. PublishBehaviour.cancelledDuringTheWriteStillPosts holds this.

DRAFT MEDIA (Drafts/DraftMedia.swift)
- `struct DraftMediaEntry`: ref, file/name/type/size/savedAt as JSONValue?; json; init(json:).
- `protocol DraftMediaStore`: persistent, put throws, get, entry, remove, refs. get, entry, remove and refs never throw (the web's guarded handle). `entry(_:)` is the entry as stored, its `file` only the file's fields, without the bytes handed back as a file; the default calls get, and FileStoreDraftMedia's reads only entry.json. storeDraftMedia's check that a ref is held and pruneDraftMedia's savedAt read use it, so of DraftMedia's own functions only loadDraftMedia copies the bytes (VirgaUI's submitSchedule still reads a draft's image with get).
- `actor MemoryDraftMedia`.
- `struct DraftMediaStorage(store: any FileStore, files: any ComposerFiles)`.
- `struct FileStoreDraftMedia(did:storage:)`: lays files out under `<escaped postingDbName(did)>/media/<escaped ref>/{file, entry.json}`. A put is all or none; refs come back sorted by code unit.
- `enum DraftMedia`:
  - postingDbPrefix, localRefPrefix, postingDbName, isVirgaLocalRef, randomUUID, newLocalRef(uuid:)
  - `storage: Locked<DraftMediaStorage?>`. The app must set it at launch (DiskFileStore plus its ComposerFiles).
  - openDraftMedia(did, storage:) (cached per DID), resetDraftMedia
  - isPostingDbName(_:) and deleteDatabase(_ name:, files:) async -> Bool: `indexedDB.deleteDatabase` for `virga-posting:<did>`. It forgets only that account's open store (as the web's handle closes and forgets itself on the delete's versionchange) and deletes its folder from `files`; false for another name or when the delete throws. The app's session deleteDatabase sends posting names here. A draft-media save already under way during the delete could make the folder again: FileStoreDraftMedia has no queue like the archive store's.
  - stateLocalRefs -> [String]
  - storeDraftMedia(did, state, media:, now:, newRef:) async throws -> Stored{state, refs}
  - loadDraftMedia(did, state, media:, makePreviewUrl: (@Sendable (JSONValue) throws -> String?)?) -> Loaded{state, missing}. A kept file without a size leaves the item without its own `size`, as the web's undefined does.
  - missingDraftMedia -> [JSONValue]
  - removeDraftMedia(did, [JSONValue]? | [String], media:)
  - pruneDraftMedia(did, keep: [JSONValue]?, media:, savedBefore:) -> [String]

DRAFTS (Drafts/Drafts.swift, Drafts+Shapes.swift, `enum Drafts`)
- Constants: limits, deviceNameDefault, postingDeviceKey, draftLimitMessage, orphanMediaMinAgeMs, cardWaitMs.
- postingDeviceId(_ store: KeyValueStore?, uuid:) -> String?
- isDraftLimitError(JSONValue? | any Error?): the message is searched by code unit.
- Reading: listDrafts(_ agent: XRPCAgent?, cursor: JSONValue?, limit: JSONValue?) -> DraftPage{drafts, cursor}, and listAllDrafts(agent, maxPages: 50) -> DraftList{drafts, complete}. Both always go through withBlueskyAppView().
- Writing:
  - createDraft(agent, state: JSONValue, DraftSaveOptions) -> SavedDraft{id, state, draft, recreated; json}
  - updateDraft(agent, id: String?, state, opts) -> SavedDraft
  - deleteDraft(agent, id, localRefs: [JSONValue]?, media:, target:)
- Opening: openDraft(view, asDid:, defaults:, media:, makePreviewUrl:, fetchCard: DraftCardFetch? = networkCardFetch(), readId:) -> DraftMedia.Loaded, with completeDraftCards(state, fetchCard:, timeoutMs:) -> [JSONValue?]? and networkCardFetch(transport:).
- pruneOrphanedDraftMedia(agent, did, media:, now:, minAgeMs:, store:, session: AutosaveSession)
- Shapes:
  - composerStateToDraft(state, texts:, deviceId:, deviceName:, owner:, locale:) throws -> JSONValue
  - draftToComposerState(view, asDid:, defaults:, readId:) -> JSONValue. It is not normalized: load it with the composer's load action.
  - draftLocalRefs -> [JSONValue]
  - summarizeDraft(view, deviceId:) -> JSONValue
  - readId
- `struct DraftsError: JSErrorConvertible {message, code (DRAFT_TOO_LONG/DRAFT_LIMIT), postIndex, cause}`. JSErrorFields(error) reads its message and code.
- `struct DraftSaveOptions(texts:, resolveMention:, validationCache:, device: .thisDevice(store:) | .given(String?), deviceName:, media:, target: PostingEventBus? = .shared, now:, newRef:, uuid:, locale:)`. The app passes `.thisDevice(store: its KeyValueStore)`; the default store is nil, which means no device id.
- `typealias DraftCardFetch = @Sendable (String, Double?) async throws -> JSONValue?`
- Seams:
  - For ComposerSubmit.finishSource's deleteDraft, pass `{ agent, id in try await Drafts.deleteDraft(agent, id.stringValue) }`.
  - ComposerLoaders.loadDraftTarget can open with Drafts.openDraft.

TEST HELPERS (Tests/VirgaPostingTests)
- PublishTestSupport.swift:
  - PublishFixture (server, token, me, now, agent(transport, did:))
  - FixedTIDs (_publish.js's tidClock, clock id 7)
  - ScriptedTimers(fired, transport: CountingTransport): it records waits and holds a fired wait until the recorded number of requests has been sent.
  - CountingTransport
  - replayTransport (understands {$hang})
  - checkReplay, publishOutcome
  - PublishEncoder (_publish.js's scriptedImages), publishMedia
- DraftMediaParityTests.swift: CountingUUIDs, storeJSON. Its loadDraftMedia cases read `input.state` when a case has one.
- DraftsParityTests.swift: DraftsFixture.canon, which names read ids and new ids.
- PublishParity compares progress events with nulls strict.
- Generator helpers are in ios/parity/cases/_publish.js:
  - agentFor (an Agent over createBackendFetchHandler; make it inside the recorded function)
  - pds(script), a fake PDS
  - withTimers(fire, fn, {sent, fired}), which leaves blobs.js's deadlines out
  - loadFresh(paths): vi.resetModules, with tid.js's nextTid replaced by a fixed clock
  - withFixedDate, withUuids, scriptedImages, ok/fail, methodOf/inputOf/paramsOf

## Gaps and deliberate differences

At port time:

- Upload deadlines from blobs.js aren't on the NetworkClock: VirgaNetwork's uploadBlob keeps its own withDeadline. The fixtures leave those setTimeouts out of `waits`, and the deadline isn't checked.
- The SDK's lexicon check on answers isn't ported. Swift filters a getDrafts page's broken entries where the web would refuse the whole page, and reads a createDraft answer without an id with drafts.js's own message where the web throws XRPCInvalidResponseError. The fixtures answer only with what the lexicon accepts.
- Image upload progress events (and with several images, the order of requests) come in completion order on both sides. The fixtures compare them as a multiset.
- loadDraftMedia's and openDraft's makePreviewUrl default to none, because URL.createObjectURL has no logic-side equivalent. VirgaUI must pass its own.
- FileStoreDraftMedia (the IndexedDB stand-in) is held by behaviour tests: layout, round trip, all-or-none put, key order and prune. It isn't in the fixtures, whose store is the web's memory handle. By default its get() copies the bytes through ComposerFiles.storedFile; entry() doesn't.
- Divergences on malformed input (Swift reads the value as empty where the web throws a TypeError): a post text that isn't a string in publishSignature and buildPostRecords, and a post's `images` that isn't a list in draftMedia's helpers.
- LinkCard.blobType follows Fetch's MIME extraction for the content types a card image server sends. Quoted parameters with escapes are approximated.
- isDraftLimitError doesn't read the error's constructor name. The SDK's DraftLimitReachedError is an XRPCError whose `error` is DraftLimitReached, which it does read.
- Wired in VirgaUI since (DraftMedia's storage, ComposerFiles, the device id and PublishMedia's clock): see the same line below.
- Commit 9a8a37e (titled WIP) was finished by e2b3ee2 and 3305d2e. It is not an interrupted attempt.

Still open after the audit:

- Upload deadlines from blobs.js aren't on the NetworkClock: VirgaNetwork's uploadBlob keeps its own withDeadline. The fixtures leave those setTimeouts out of `waits`, and the deadline isn't checked.
- uploadCardThumb's deadlineMs bounds only the fetch of the page's image. On the web the caller's signal also reaches prepareImage's upload (uploadBlob aborts), and here the upload keeps its own size-based deadline. A caller deadline is not a fixture case: the recorder can't abort a hung answer. A behaviour test holds it instead.
- The SDK's lexicon check on answers isn't ported. Swift filters a getDrafts page's broken entries where the web would refuse the whole page. It reads a createDraft answer without an id with drafts.js's own message, and doesn't forget the minted files, where the web throws XRPCInvalidResponseError after forgetting them. The fixtures answer only with what the lexicon accepts.
- Image upload progress events (and, with several images, the order of requests) come in completion order on both sides. The fixtures compare them as a multiset.
- loadDraftMedia's and openDraft's makePreviewUrl default to none, because URL.createObjectURL has no logic-side equivalent. VirgaUI must pass its own. A closure returning nil writes previewUrl null, as a web function returning null does; one returning undefined can't be told apart.
- FileStoreDraftMedia (the IndexedDB stand-in) is held by behaviour tests, not fixtures. A put that fails deletes the folders it wrote. If one of those replaced an existing entry, the old entry goes too, where IndexedDB's transaction would keep it. storeDraftMedia only puts refs the store doesn't hold, so this is reachable only when a get failed.
- Divergences on malformed input, where Swift reads the value as empty and the web throws a TypeError: a post text that isn't a string (publishSignature, buildPostRecords); a post's `images` that isn't a list (draftMedia's helpers); `posts` or `embedImages` that are non-iterable objects (draftLocalRefs). A video `file` that passes validateVideoFile but isn't a File fails with the TypeError's words; the web would go on to the network.
- summarizeDraft's `first.embedExternals?.[0]?.uri` on an object keyed '0' reads the member on the web; Swift reads only arrays.
- Embeds.hasLength (posting-text's file, not mine) reads `{ length: -1 }` as no length, where the web's `facets?.length` is truthy. Left for posting-text.
- isDraftLimitError doesn't read the error's constructor name. The SDK's DraftLimitReachedError is an XRPCError whose `error` is DraftLimitReached, which it does read.
- Wired in VirgaUI since: wherever the app opens an account's draft media (the composer, the posting pages) it passes `openDraftMedia` a DraftMediaStorage over its own FileStore and TemporaryComposerFiles, so the static DraftMedia.storage is left unset. Drafts carry `.thisDevice(store:)`, the Drafts page's prune gets `store:` (the app's key-value store), loadDraftMedia gets the composer's makePreviewUrl, and PublishMedia gets the session's clock. The demo installs its own HTTP.clock.
- Library merge: LinkCard.fetchLinkCard(transport:) has the library's FetchLinkCard type, `@Sendable (String) async throws -> JSONValue?`. Pass `LinkCard.fetchLinkCard(transport: t)` where LibraryModel takes `fetchLinkCard:`. This port doesn't use LocaleCompare.

## Audit

- **medium** `src/posting/lib/linkCard.js fetchCardThumbnail (res.blob().type)` LinkCard.blobType only approximated Fetch's MIME extraction, unlike Node's fetch. It split the Content-Type at every ',' and ';' before reading quotes, so 'image/webp;a="x;y"' and 'image/png;a="x,y"' broke. It never carried a charset over to a later value with the same essence: 'image/png;charset=a, image/png;x=1' should give 'image/png;x=1;charset=a'. It cut quoted values at an escaped quote. It counted the backtick as a token code point, which undici doesn't, so 'image/png`' should give ''. Fixed by porting the algorithms themselves (getting, decoding and splitting; extract a MIME type; parse and serialize a MIME type), in code units. Held to 26 new fetchCardThumbnail cases recorded from Node; the type shows in the re-encoder's call. There is also a behaviour table of 50 types measured in Node 22. The old code fails 14 entries of that table. *Fixed:* True
- **low** `src/posting/lib/linkCard.js uploadCardThumb` uploadCardThumb rethrew only on task cancellation. When the caller's deadline (deadlineMs, the web's AbortSignal.timeout) ran out while the page's image was fetched, Swift returned no image; the web rethrows, because `signal.aborted` is true. It now reads the error with callerAborted, as fetchLinkCard does. A behaviour test covers a 3 s deadline (throws), a 20 s deadline and no deadline (nil), and the request deadlines 3000/10000/10000. The old code fails it. *Fixed:* True
- **low** `src/posting/lib/publish.js uploadMedia (video branch)` publish with a video whose `file` isn't a File: video.js's uploadVideo runs validateVideoFile first, so the web throws PublishError VIDEO_MISSING, 'Choose a video to add.'. Swift went straight to reading bytes and gave VIDEO_FAILED with 'data.arrayBuffer is not a function'. It now runs Video.validateVideoFile on the JSON first. Recorded as the publish case video-not-a-file. image-not-a-file was added beside it and already matched. *Fixed:* True
- **low** `src/posting/drafts/drafts.js isDraftLimitError` isDraftLimitError tested the message with Swift's String.contains, which compares Characters, so 'DraftLimitReached' followed by a combining mark wasn't found; the web's /DraftLimitReached/ matches the code units. It now uses jsIndexOf. Four new cases. *Fixed:* True
- **low** `src/posting/drafts/draftMedia.js loadDraftMedia` loadDraftMedia's patch sets `size: entry.size ?? entry.file.size`. When the kept file has no size, that is undefined, which takes the item's own size away. Swift kept the item's size. withItem now takes the members the web sets to undefined. New fixture case sizes-unknown; the Swift test reads a case's own state when it has one. This is unreachable through Virga's own entries, which always carry a numeric size. *Fixed:* True
- **low** `src/posting/lib/publish.js uploadMedia` publish's 'uploaded' image event wrote `id: null` when the image had none; the web's `id: image.id` leaves it undefined, so the member is absent. Fixed. The events are now compared with nulls strict, so a member the web leaves undefined must be absent and one it sets to null must be null. I first changed jobId the same way, then put it back: video.js gives `jobId || null`. As an experiment I made every comparison in the domain's tests strict about nulls. Everything passed, so the port keeps null and absent apart throughout. *Fixed:* True
- **low** `src/posting/drafts/drafts.js asDraftError/textProblem` DraftsError carried `code` (DRAFT_TOO_LONG, DRAFT_LIMIT) but wasn't JSErrorConvertible, so JSErrorFields(error), which reads an error the web's way, saw no code. It now conforms (message and code). A test checks that a limit error made from the AppView's refusal isn't read as the refusal again. *Fixed:* True
- **low** `src/posting/lib/publishRecord.js isTransientNetworkError/isRetriablePublishError` Coverage was thin for the error shapes isTransientNetworkError and isRetriablePublishError read. Added 9 shapes for each of the two functions (18 cases): a code that is a list, a list with the match later, an object, zero with a cause, a cause code that is a list, statusCode 429, a string status, a fractional status, and a cause that is only a string. All matched the existing port. *Fixed:* True
- **low** `all five files` Checked and found faithful, no change: every export of the five files, branch by branch. That covers the retry loop and landed-check order, withTimeout (the work is not called off, the timer is cleared and waited for), the gate rules, createPostWithGates' reply and collection rules, publishSignature's JSON, the duplicate guard, buildPostRecords, uploadMedia (AsyncPool keeps the other workers going after a first failure, as the web does), writeFailure, the thread path with its per-post postgates, the drafts paging, create/update/delete with what each forgets, openDraft and completeDraftCards, pruneOrphanedDraftMedia, the device id, and the draftMedia store operations. Every user-visible string in the five files appears word for word in the Swift. No drift. The module map's statuses and notes are true, and the headers name their web files. *Fixed:* False
- **low** `src/posting/drafts/drafts.js listDrafts (porter's report)` Web bugs: I confirmed each of the porter's seven against the code or the fixtures. The lexicon check is real: getDrafts requires id (format tid) and posts (minLength 1), so drafts.js's filter is dead code. No new web-app bugs found. Not the web's code, but worth knowing: Node's undici leaves the backtick out of HTTP token code points, against the Fetch spec, and the port follows Node. *Fixed:* False

## Web bugs noticed

- src/posting/lib/publishRecord.js isTransientNetworkError: an error whose message (or whose cause's message) is a truthy non-string, such as a number, throws TypeError '(...).toLowerCase is not a function'. Inside publishWithIdempotentRetry's catch, that TypeError replaces the write's own error. Low.
- src/posting/lib/linkCard.js fetchLinkCard: it checks safeExternalUrl(url), which trims, but sends encodeURIComponent(url) untrimmed and keeps the untrimmed url in the card. A link with surrounding spaces goes to cardyb as '%20%20https…' (fixture case untrimmed-url). Low.
- src/posting/drafts/drafts.js listDrafts: the SDK checks getDrafts' answer against the lexicon, so one malformed draft another app wrote (no posts, an id that isn't a TID) makes the whole page fail. listAllDrafts then throws: pruning stops, and update and delete go unverified. The `filter(d => d?.id && isObject(d.draft))` can never run on an answer the SDK accepts. Low.
- src/posting/drafts/drafts.js composerStateToDraft: with neither `owner` nor `state.asDid`, owned(blob, blobDid, null) counts a blob whose blobDid is null as this account's (null === null) and writes it into the draft's embed. Low.
- src/posting/drafts/draftMedia.js mediaOf: a post whose `images` is a truthy non-array, such as a string, throws TypeError in stateLocalRefs, missingDraftMedia, storeDraftMedia and loadDraftMedia (`(post?.images || []).forEach`). Low.
- src/posting/drafts/drafts.js summarizeDraft: `(first.embedImages || []).length` is undefined for a truthy non-array such as an object, so `images` is NaN (null in JSON). Low.
- src/posting/lib/publish.js publishSignature and buildPostRecords: `(p.text || '').trim()` throws TypeError for a post text that isn't a string. Low.
