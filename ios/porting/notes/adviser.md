# adviser: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported and audited (2026-11-22; wave 7, Chain B): src/posting/adviser and src/posting/ui (backendAccess.js, postPreview.js).

Parity cases at port time: 2671; the audit added 93.

Tests at port time: The whole package passes `swift test` on Linux with Swift 6.4.2. Tests and suites per target: 194/32, 57/12, 454/81 (VirgaPostingTests, up from 358/65), 99/26, 152/29, 140/24, 144/23, 176/31 and 128/16. New suites: AdviserUsageParity, AdviserAIServiceParity, AdviserAltTextParity, AdviserSheetParity, PostPreviewParity, AdviserContextParity, AdviserStyleParity, AdviserGateParity, StyleSessionBehaviour, AdviserGateReadBehaviour, AdviserReaderBehaviour, AdviserReadModelBehaviour, AdviserGateControllerBehaviour, AdviserGateModelBehaviour, AdviserAIServiceBehaviour and AdviserContextBehaviour. I ran the adviser suites 20 times in a row and none failed. `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity` passes 164 of 164, `npx eslint ios` is clean, and prettier --check passes on every adviser generator.

Tests after the audit: Every command ran from /home/user/virga/.worktrees/w7-b with Swift 6.4.2 on Linux.

- `swift test` on the whole package passed with no issues. Tests and suites per target: 194/32, 57/12, 455/81 (VirgaPostingTests), 99/26, 152/29, 140/24, 144/23, 176/31 and 128/16.
- After that run I added one test, theCountIsHeardBeforeTheDescriptionComesBack, so VirgaPostingTests now has 456. The whole package built with it, and the adviser filter passes: `swift test --filter "Adviser|StyleSession|PostPreview"` runs 100 tests in 17 suites.
- I ran that filter about 20 times, including 4 runs with extra CPU hogs and 3 pinned to one core with two hogs (about 83 s each). All passed.
- `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity` passes 164 of 164.
- `npx eslint ios` is clean, and `npx prettier --check` passes on the adviser generators.
- `npm run parity:drift` reports nothing for the adviser.
- The adviser fixtures now hold 2764 cases (the porter's 2671 plus 93).

Commits on ios/w7-b: 13d87c2, 8a26169, a90773f and 7a8de5e.

## Files

- `src/posting/adviser/aiService.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/AIService.swift. Through AIRequester (VirgaBackend conforms). Recorded-fetch parity through the web's own createBackendRequester. blobToBase64 is a fileprivate stand-in until the scheduling port merges.
- `src/posting/adviser/altTextFollowUp.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/AltTextFollowUp.swift. 
- `src/posting/adviser/altTextModel.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/AltTextModel.swift. 
- `src/posting/adviser/context.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/Context.swift. gatherReplyContext replayed from recorded AppView reads, with the 4 s wait checked. A non-list `posts` reads as empty where the web throws.
- `src/posting/adviser/gate.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/Gate.swift. 
- `src/posting/adviser/gateController.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/GateController.swift. Whole checks played against the web's own controller (fixture adviser.gate) and the port. Keeps the web's undecidable-second-sheet bug.
- `src/posting/adviser/sheet.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/Sheet.swift. 
- `src/posting/adviser/sheetView.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/SheetView.swift. 
- `src/posting/adviser/style.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/Style.swift. 
- `src/posting/adviser/styleSession.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/StyleSession.swift. StyleSession is a @MainActor @Observable model.
- `src/posting/adviser/usage.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/Usage.swift. 
- `src/posting/adviser/useAdviserGate.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/UseAdviserGate.swift. AdviserGateModel. Behaviour tests only, since it is a hook.
- `src/posting/adviser/useAdviserRead.js` (ported): ios/VirgaKit/Sources/VirgaPosting/Adviser/UseAdviserRead.swift. AdviserReader (createAdviserReader) and AdviserReadModel (the hook).
- `src/posting/ui/backendAccess.js` (ported): ios/VirgaKit/Sources/VirgaPosting/UI/BackendAccess.swift. 
- `src/posting/ui/postPreview.js` (ported): ios/VirgaKit/Sources/VirgaPosting/UI/PostPreview.swift. A displayName that isn't a string reads as nil where the web throws.

## API for the code that builds on it

### As the porter left it

Everything is in VirgaPosting (`import VirgaPosting`), at ios/VirgaKit/Sources/VirgaPosting/Adviser/ unless noted.

CONVENTIONS
- Web values that are loosely typed are JSONValue in, and the typed results have `.json`, the web's object.
- Clocks are injected: `now: Double` for pure functions, and `now: @Sendable () -> Double` (default `AIService.systemNow`) where the time is read after an await.
- Stores are `(any KeyValueStore)?`, with the web's keys.
- The read's abort signal is `AdviserAbortSignal` (Gate.swift). It is a Sendable class with `aborted`, `abort()` and `run { … }`, where `run` is the port of `fetch(…, { signal })`: an already-aborted signal sends nothing, and an abort cancels the work's task. Requests already sent through AIService are never cancelled by it.
- Errors are `AIServiceError` (name, message, status: Int?, code: JSONValue?, detail, payload, canceled, found, minimum, cause). It conforms to JSErrorConvertible and has `.json` and `codeString`.
- `AIErrorFields(error)` reads those fields from any error (AIServiceError, BackendError, the rest through JSErrorFields). Its `isAbort` is the web's `isAbort`.
- Test helpers, internal to VirgaPostingTests:
  - Tests/VirgaPostingTests/AdviserTestSupport.swift: AdviserGateLatch<T> (wait/open), AdviserScript<T> (next/called/answer: gated answers in turn) and ManualMainTimers (main-actor setTimeout run by hand).
  - AdviserFixtureServer.requester(transport, did:) gives a VirgaBackend for https://server.example.
  - IdleRequester, CodeUnitKeyValueStore (localStorage keyed by code unit) and HangingSleep.

USAGE (Usage.swift)
- `enum AdviserUsageFeature: adviser | altText | style`, with `.checked(name) throws AdviserUsageError` (the web's TypeError).
- `struct AdviserUsage { month, used, limit: Double }`.
- `enum AdviserUsageStore`, every function taking `store: (any KeyValueStore)?`:
  - Constants: adviserUsageKeyPrefix, usageFeatures, freeMonthlyLimits.
  - adviserUsageKey(did), currentMonthKey(now:), usageResetsAt(now:) -> ms.
  - readAdviserUsage(did, feature:, now:, store:) -> AdviserUsage?
  - recordAdviserUsage(did, usage: JSONValue?, feature:, now:, store:) -> AdviserUsage?
  - clearAdviserUsage(did, feature:, store:)
  - markAdviserLimitReached(did, limit: JSONValue?, feature:, now:, store:)
  - isAdviserAtLimit(did, feature:, now:, store:) -> Bool
  - adviserUsesLeft(...) -> Double?
  - adviserUsageLine(usage: JSONValue? | AdviserUsage?, feature:, now:, locale:) -> String

AI SERVICE (AIService.swift)
- `protocol AIRequester: Sendable { var did: String? { get }; func postAI(_ path: String, body: JSONValue, timeoutMs: Double) async throws -> JSONValue }`. `extension VirgaBackend: AIRequester` (POST, so `SessionModel.backendFor(did)` is one).
- `enum AIService`:
  - Constants: aiRequestTimeoutMs (30 000), altTextMimeTypes, maxAltTextBase64, systemNow.
  - aiErrorMessage(JSONValue?) -> String? and aiErrorMessage(any Error) -> String.
  - analyzePost(req, payload: JSONValue?, signal:, store:, now:) async throws -> JSONValue.
  - synthesizeStyle(req, payload, signal:, store:, now:) -> StyleSynthesis{summary, analyzedCount, usage?}.
  - generateAltText(req, payload, onUsage: ((AIUsageCount{used, limit}) -> Void)?, signal:, store:, now:) -> String.
  - generateAltTextForFile(req, ComposerFile?, read: (ComposerFile) async throws -> Data, payload:, onUsage:, signal:, store:, now:) -> String. VirgaUI supplies `read` from ComposerFile.ref.

ALT TEXT
- `AltTextFollowUp`:
  - Constants: altTextQuickNotes [AltTextQuickNote{id,label,hint,sentence}], altTextImageKinds [AltTextImageKind{id,label,short,hint}], itsA, altTextNoteMax, altTextFollowUpMax, cardQuickNotesCount.
  - toggleQuickNote([String], id), quickNoteIds, composeFollowUp(selected, note), hasFollowUpDraft, appendItsA, describeRequest, normalizeImageKind(JSONValue?|String?).
  - looksTranscribed, rankQuickNotes(text:kind:lastAsked:) -> [RankedQuickNote{id,score}], cardQuickNotes.
- `AltTextModel`:
  - Constants: altTextMaxGraphemes, generatedAltMax, altContextMax.
  - altTextCount(text, locale:) -> AltTextCount{count,over,label}.
  - altGenerationRequest(mode:alt:selected:note:kind:context:) -> AltGenerationRequest? (`.json` is the payload for generateAltTextForFile).
  - afterGeneration(before:generated:mode:selected:) -> AltGenerationResult?{alt,undo,rankedAgainst,lastAsked,revised}.
  - revisingLine, altTextUsageLine(usage, now:, locale:).

SHEET
- `AdviserSheet` (sheet.js):
  - adviserVerdict(JSONValue?) -> String?
  - placeAdviserMarks(posts, spans: [AdviserMarkSpan{key,excerpt}], fixes: [AdviserMarkFix{key,found}]) -> AdviserPlacedMarks{posts: [AdviserMarkedPost{text, segments: [AdviserSegment .text/.fix(key,text)/.span(keys,children)]}], placed: [String] in Set order}.
  - adviserSheetModel(result, posts) -> AdviserSheetModel{verdict, tone, posts, marks [(key, AdviserSheetMark{number,tone})] + mark(key), notes [AdviserSheetNote{key,kind,tone,label?,type?,detail?,number?}], met [JSONValue], fixes [AdviserSheetFix{key, issue: JSONValue}], writingNoteCount, writingRequested}.
  - adviserWritingTally(model, taken:) -> String?, adviserDraftLabel(scenario, readWithContext).
- `AdviserSheetView` (sheetView.js), each taking the read as JSON (`AdviserSheetRead.json`):
  - verdictCopy, statusWords, writingTypeLabels.
  - sheetTitle, readFoundSomething(model, taken).
  - sheetActions(read, canPublish:, canSaveDraft:) -> AdviserSheetActions{closeOnly, publish: {label}?, draft, primary}.
  - sheetContextLine, postIndexLabel(index,total), fixAllLabel.

CONTEXT (Context.swift, `AdviserContext`)
- Constants: readMinMs, slowReadAfterMs, contextParentHeight.
- adviserGoalItems(JSONValue?|AdviserSettings) -> [AdviserGoalItem{key,label,detail}], adviserGoalCount, readExpectation(Double|JSONValue?).
- adviserDraftFacts(state JSONValue?|ComposerState, asDid:) -> AdviserDraftFacts. An `asDid` of nil means the state's own.
- adviserSource -> AdviserSource{posts,text}.
- adviserReadPlan(adviser, state, canUseAi:, atLimit:, asDid:) -> AdviserReadPlan{available, gate, reviewMode, hasSomething, scenario, goals, goalItems, writingChecks: JSONValue?, context: String?, expectedChecks, source, facts}.
- gatherReplyContext(state, kind, signal:, timeoutMs: 4000, sleep:, appview:, transport:) async -> AdviserReplyContext?{kind, thread: [AdviserContextLine{author,text}], target}.
- analyzePayload(plan, context) -> JSONValue, adviserShouldInterrupt(result, reviewMode).

STYLE
- `AdviserStyle` (Style.swift):
  - Constants: minStylePosts, maxStylePosts.
  - extractStyleTexts(feed, did).
  - fetchStylePostTexts(did, sampleSize: JSONValue?, onPage: (Int) -> Void, signal:, appview:, transport:) async throws -> [String].
  - synthesizeStyleFromTexts(req, texts:, guidance:, previousSummary:, now:, signal:, store:) -> StyleReading{summary, analyzedCount, updatedAt, usage?}.
  - learnWritingStyle(req, sampleSize:, onPage:, guidance:, previousSummary:, now:, signal:, store:, appview:, transport:).
  - styleProfileFrom(result, guidance) -> AdviserStyleProfile, forgetStyleProfile.
- `StyleSessionWords`: styleStages, writeStageFlipMs, initialStyleView, styleErrorMessage(JSONValue?|Error), styleProfileLine(analyzedCount:updatedAt:locale:countLocale:timeZone:) and styleProfileLine(AdviserStyleProfile?, …).
- `@MainActor @Observable StyleSession(did:requester:profile:onChange:fetchTexts:synthesize:store:transport:now:setTimer:clearTimer:)`:
  - `view: StyleView{phase, stage, postCount, summary, analyzedCount, updatedAt, error: Failure{code,message}?, usage, fresh}`.
  - start(sampleSize:guidance:previousSummary:again:) async, edit(_:), hasPosts, dispose().
  - Its timers are MainActorSetTimer/MainActorClearTimer, and AdviserMainTimers.live() is the default.

GATE AND READS
- `AdviserGate` (Gate.swift):
  - Constants: adviserGateTimeoutMs, adviserContextTimeoutMs, adviserChoices, adviserChoiceLabels, adviserTimeoutMessage.
  - adviserReadChoices(gate) -> [AdviserChoice .publish/.edit].
  - startAdviserRead(work: (AdviserAbortSignal) async throws -> R, timeoutMs:, setTimer:, clearTimer:) -> AdviserRead<R>. AdviserRead has `value` async -> AdviserReadEnded{outcome .result/.error/.timeout/.cancelled, result, error, choice}, plus cancel(choice) -> Bool, isSettled and signal.
  - withinMs(ms, sleep:, work) throws AdviserDeadlineError("timed out after <ms>ms").
  - Timers are PublishWatch.SetTimer/ClearTimer (ComposerSubmit).
- `@MainActor AdviserReader(analyze: (text, automatic, signal) async throws -> JSONValue, setIsCheckingPost:, onChange:, gateTimeoutMs:, setTimer:, clearTimer:)`:
  - readAdviser(text, gate:) starts at once and returns Task<AdviserReadEnded<JSONValue>, Never>.
  - chooseAdviser, setAnalyze, dispose, revive, `state: AdviserReaderState{adviserChoices, adviserReadInterrupted}`.
- `@MainActor @Observable AdviserReadModel` (the hook): adviserChoices, adviserReadInterrupted, readAdviser, chooseAdviser, update(analyze:setIsCheckingPost:), setGateTimeout, revive, dispose.
- `AdviserGateRules`: sheetStatuses, initialAdviserView, adviserGateEnabled(settings:hasRequester:canUseAi:), adviserUsageLineFor(did, readUsage:, now:, locale:).
- `@MainActor AdviserGateController(analyzePost:gatherReplyContext:atLimit:readUsage:now:sleep:gateTimeoutMs:readMinMs:onChange:store:transport:setTimer:clearTimer:)`. Defaults are AIService, AdviserContext over transport, and the usage kept in store.
  - configure(did:settings: JSONValue?, requester:, canUseAi:, onApplyFixes: ([String]) -> Void).
  - check(state JSONValue?|ComposerState, mode: "gate"|"manual") starts at once and returns AdviserCheck, whose `decision` async is AdviserDecision .publish/.edit/.draft.
  - choose(AdviserChoice), decide(String|AdviserDecision), applyFix([AdviserSheetFix]|AdviserSheetFix?) -> Int, cancel(), isEnabled, usageLine().
  - `view: AdviserView{busy: AdviserBusy{mode,goals,startedAt,choices}?, sheet: AdviserSheetRead?, usageVersion}`. AdviserSheetRead has `.json`, the web's sheet object, and `.model`.
- `@MainActor @Observable AdviserGateModel(controller:store:transport:)` (useAdviserGate):
  - State: busy, sheet, enabled, usageLine.
  - configure(did:settings: JSONValue?|AdviserSettings?, requester:, canUseAi:, onApplyFixes:), or configure(did:settings:session: SessionModel, onApplyFixes:), which gives a requester only when capabilitiesFor(did).canUseAi, as Composer.jsx does.
  - check(state, mode:), canPublishAnyway/publishAnyway/keepEditing.
  - sheetOpen/closeSheet/keepEditingFromSheet/publishFromSheet/saveDraftFromSheet, applyFix, dispose.
  - `AdviserGateModel.applyFixes(to: ComposerStateModel)` is the composer's onApplyFixes.

UI (Sources/VirgaPosting/UI/)
- BackendAccess.backendAccess(account: JSONValue?|SessionAccount?, authMode:, canSchedule:) -> BackendAccessState{ready, action}.
- PostPreview.embedSummary(embed, locale:) -> String?, and PostPreview.postPreviewModel(view:record:uri:compact:locale:) -> PostPreviewModel{uri, url, author: PostPreviewAuthor?, text, at, embed, counts: PostPreviewCounts?, isReply}.

WIRING FOR THE MERGE
- AIService's fileprivate blobToBase64 (Data.base64EncodedString) should switch to the scheduling port's blobToBase64.
- Nothing calls the library chain. LocaleCompare and JSCollation are not used.

### After the audit

Everything is in VirgaPosting (`import VirgaPosting`), at ios/VirgaKit/Sources/VirgaPosting/Adviser/ unless noted.

CONVENTIONS
- Web values that are loosely typed are JSONValue in, and the typed results have `.json`, the web's object.
- Clocks are injected: `now: Double` for pure functions, and `now: @Sendable () -> Double` (default `AIService.systemNow`) where the time is read after an await.
- Stores are `(any KeyValueStore)?`, with the web's keys. nil means no store, not the default one, so callers pass the app's store.
- The read's abort signal is `AdviserAbortSignal` (Gate.swift). It is a Sendable class with `aborted`, `abort()` and `run { … }`, where `run` is the port of `fetch(…, { signal })`: an already-aborted signal sends nothing (CancellationError), and an abort cancels the work's task. Requests already sent through AIService are never cancelled by it.
- Errors are `AIServiceError` (name, message, status: Int?, code: JSONValue?, detail, payload, canceled, found, minimum, cause). It conforms to JSErrorConvertible and has `.json` and `codeString`.
- `AIErrorFields(error)` reads those fields from any error (AIServiceError, BackendError, the rest through JSErrorFields, where CancellationError is AbortError). Its `isAbort` is the web's `isAbort`.
- Callbacks the web calls before it answers are awaited closures: fetchStylePostTexts' `onPage` and generateAltText's `onUsage` are `@Sendable (…) async -> Void`, so a main-actor listener can `await MainActor.run { … }` and has heard by the time the call returns. Synchronous closures still convert.
- AdviserGateController, AdviserReader and AdviserReadModel default to real task timers for the 10 s gate deadline. Tests should inject setTimer/clearTimer (ManualTimers in Tests/VirgaPostingTests/ComposerBehaviourTests.swift); the adviser tests now do.
- Test helpers, internal to VirgaPostingTests:
  - Tests/VirgaPostingTests/AdviserTestSupport.swift: AdviserGateLatch<T> (wait/open), AdviserScript<T> (next/called/answer: gated answers in turn) and ManualMainTimers (main-actor setTimeout run by hand).
  - AdviserFixtureServer.requester(transport, did:) gives a VirgaBackend for https://server.example.
  - IdleRequester, CodeUnitKeyValueStore (localStorage keyed by code unit) and HangingSleep.

USAGE (Usage.swift)
- `enum AdviserUsageFeature: adviser | altText | style`, with `.checked(name) throws AdviserUsageError` (the web's TypeError from checkFeature; nil reads as "undefined").
- `struct AdviserUsage { month, used, limit: Double }` (`.json`).
- `enum AdviserUsageStore`, every function taking `store: (any KeyValueStore)?`:
  - Constants: adviserUsageKeyPrefix, usageFeatures, freeMonthlyLimits.
  - adviserUsageKey(did), currentMonthKey(now:), usageResetsAt(now:) -> ms (NaN for an invalid time).
  - readAdviserUsage(did, feature:, now:, store:) -> AdviserUsage?
  - recordAdviserUsage(did, usage: JSONValue?, feature:, now:, store:) -> AdviserUsage?
  - clearAdviserUsage(did, feature:, store:)
  - markAdviserLimitReached(did, limit: JSONValue?, feature:, now:, store:)
  - isAdviserAtLimit(did, feature:, now:, store:) -> Bool
  - adviserUsesLeft(...) -> Double?
  - adviserUsageLine(usage: JSONValue? | AdviserUsage?, feature:, now:, locale:) -> String

AI SERVICE (AIService.swift)
- `protocol AIRequester: Sendable { var did: String? { get }; func postAI(_ path: String, body: JSONValue, timeoutMs: Double) async throws -> JSONValue }`. `extension VirgaBackend: AIRequester` (POST), so `SessionModel.backendFor(did)` is one.
- `enum AIService`:
  - Constants: aiRequestTimeoutMs (30 000), altTextMimeTypes, maxAltTextBase64, systemNow.
  - aiErrorMessage(JSONValue?) -> String? and aiErrorMessage(any Error) -> String.
  - analyzePost(req, payload: JSONValue?, signal:, store:, now:) async throws -> JSONValue.
  - synthesizeStyle(req, payload, signal:, store:, now:) -> StyleSynthesis{summary, analyzedCount, usage?}.
  - generateAltText(req, payload, onUsage: (@Sendable (AIUsageCount{used, limit}) async -> Void)?, signal:, store:, now:) -> String. onUsage is awaited before the description is returned.
  - generateAltTextForFile(req, ComposerFile?, read: @Sendable (ComposerFile) async throws -> Data, payload:, onUsage: (same type), signal:, store:, now:) -> String. The file's bytes and type (else image/jpeg) override any image in the payload.

ALT TEXT
- `AltTextFollowUp`:
  - Constants: altTextQuickNotes [AltTextQuickNote{id,label,hint,sentence}], altTextImageKinds [AltTextImageKind{id,label,short,hint}], itsA, altTextNoteMax, altTextFollowUpMax, cardQuickNotesCount.
  - toggleQuickNote([String], id), quickNoteIds, composeFollowUp(selected, note), hasFollowUpDraft, appendItsA, describeRequest, normalizeImageKind(JSONValue?|String?).
  - looksTranscribed, rankQuickNotes(text:kind:lastAsked:) -> [RankedQuickNote{id,score}], cardQuickNotes.
- `AltTextModel`:
  - Constants: altTextMaxGraphemes, generatedAltMax, altContextMax.
  - altTextCount(text, locale:) -> AltTextCount{count,over,label}.
  - altGenerationRequest(mode:alt:selected:note:kind:context:) -> AltGenerationRequest? (`.json` is the payload for generateAltTextForFile).
  - afterGeneration(before:generated:mode:selected:) -> AltGenerationResult?{alt,undo,rankedAgainst,lastAsked,revised}.
  - revisingLine, altTextUsageLine(usage, now:, locale:).

SHEET
- `AdviserSheet` (sheet.js):
  - adviserVerdict(JSONValue?) -> String?
  - placeAdviserMarks(posts, spans: [AdviserMarkSpan{key,excerpt}], fixes: [AdviserMarkFix{key,found}]) -> AdviserPlacedMarks{posts: [AdviserMarkedPost{text, segments: [AdviserSegment .text/.fix(key,text)/.span(keys,children)]}], placed: [String] in Set order, has(key)}.
  - adviserSheetModel(result, posts) -> AdviserSheetModel{verdict, tone, posts, marks [(key, AdviserSheetMark{number,tone})] + mark(key), notes [AdviserSheetNote{key,kind,tone,label?,type?,detail?,number?}], met [JSONValue], fixes [AdviserSheetFix{key, issue: JSONValue}], writingNoteCount, writingRequested}.
  - adviserWritingTally(model, taken: [String]) -> String?, adviserDraftLabel(scenario, readWithContext).
- `AdviserSheetView` (sheetView.js), each taking the read as JSON (`AdviserSheetRead.json`):
  - verdictCopy, statusWords, writingTypeLabels.
  - sheetTitle, readFoundSomething(model, taken).
  - sheetActions(read, canPublish:, canSaveDraft:) -> AdviserSheetActions{closeOnly, publish: {label}?, draft, primary}.
  - sheetContextLine, postIndexLabel(index,total), fixAllLabel.

CONTEXT (Context.swift, `AdviserContext`)
- Constants: readMinMs, slowReadAfterMs, contextParentHeight.
- adviserGoalItems(JSONValue?|AdviserSettings) -> [AdviserGoalItem{key,label,detail}], adviserGoalCount, readExpectation(Double|JSONValue?).
- adviserDraftFacts(state JSONValue?|ComposerState, asDid:) -> AdviserDraftFacts. An `asDid` of nil means the state's own.
- adviserSource -> AdviserSource{posts,text}.
- adviserReadPlan(adviser, state, canUseAi:, atLimit:, asDid:) -> AdviserReadPlan{available, gate, reviewMode, hasSomething, scenario, goals, goalItems, writingChecks: JSONValue?, context: String?, expectedChecks, source, facts}.
- gatherReplyContext(state, kind, signal:, timeoutMs: 4000, sleep:, appview:, transport:) async -> AdviserReplyContext?{kind, thread: [AdviserContextLine{author,text}], target}.
- analyzePayload(plan, context) -> JSONValue, adviserShouldInterrupt(result, reviewMode).

STYLE
- `AdviserStyle` (Style.swift):
  - Constants: minStylePosts, maxStylePosts.
  - extractStyleTexts(feed, did).
  - fetchStylePostTexts(did, sampleSize: JSONValue?, onPage: (@Sendable (Int) async -> Void)?, signal:, appview:, transport:) async throws -> [String]. onPage is awaited after each page, so every running count arrives in order before the texts do.
  - synthesizeStyleFromTexts(req, texts:, guidance:, previousSummary:, now:, signal:, store:) -> StyleReading{summary, analyzedCount, updatedAt, usage?}. Throws InvalidTimeError for an invalid `now`.
  - learnWritingStyle(req, sampleSize:, onPage: (same type), guidance:, previousSummary:, now:, signal:, store:, appview:, transport:).
  - styleProfileFrom(result, guidance) -> AdviserStyleProfile, forgetStyleProfile.
- `StyleSessionWords`: styleStages, writeStageFlipMs, initialStyleView, styleErrorMessage(JSONValue?|Error), styleProfileLine(analyzedCount:updatedAt:locale:countLocale:timeZone:) and styleProfileLine(AdviserStyleProfile?, …).
- `@MainActor @Observable StyleSession(did:requester:profile:onChange:fetchTexts:synthesize:store:transport:now:setTimer:clearTimer:)`:
  - `view: StyleView{phase, stage, postCount, summary, analyzedCount, updatedAt, error: Failure{code,message}?, usage, fresh}`.
  - start(sampleSize:guidance:previousSummary:again:) async, edit(_:), hasPosts, dispose().
  - FetchTexts' onPage is a main-actor `(Int) -> Void`. The default work awaits it for each page, so the view hears every count, as on the web.
  - Its timers are MainActorSetTimer/MainActorClearTimer, and AdviserMainTimers.live() is the default.

GATE AND READS
- `AdviserGate` (Gate.swift):
  - Constants: adviserGateTimeoutMs, adviserContextTimeoutMs, adviserChoices, adviserChoiceLabels, adviserTimeoutMessage.
  - adviserReadChoices(gate) -> [AdviserChoice .publish/.edit].
  - startAdviserRead(work: (AdviserAbortSignal) async throws -> R, timeoutMs:, setTimer:, clearTimer:) -> AdviserRead<R>. AdviserRead has `value` async -> AdviserReadEnded{outcome .result/.error/.timeout/.cancelled, result, error, choice}, plus cancel(choice) -> Bool, isSettled and signal.
  - withinMs(ms, sleep:, work) throws AdviserDeadlineError("timed out after <ms>ms").
  - taskSleep.
  - Timers are PublishWatch.SetTimer/ClearTimer (ComposerSubmit).
- `@MainActor AdviserReader(analyze: @Sendable (text, automatic, signal) async throws -> JSONValue, setIsCheckingPost:, onChange:, gateTimeoutMs:, setTimer:, clearTimer:)`:
  - readAdviser(text, gate:) starts at once and returns Task<AdviserReadEnded<JSONValue>, Never>.
  - chooseAdviser, setAnalyze, dispose, revive, `state: AdviserReaderState{adviserChoices, adviserReadInterrupted}`.
- `@MainActor @Observable AdviserReadModel(analyze:setIsCheckingPost:gateTimeoutMs:setTimer:clearTimer:)` (the hook): adviserChoices, adviserReadInterrupted, readAdviser, chooseAdviser, update(analyze:setIsCheckingPost:), gateTimeoutMs/setGateTimeout, revive, dispose.
- `AdviserGateRules`: sheetStatuses, initialAdviserView, adviserGateEnabled(settings:hasRequester:canUseAi:), adviserUsageLineFor(did, readUsage:, now:, locale:).
- `@MainActor AdviserGateController(analyzePost:gatherReplyContext:atLimit:readUsage:now:sleep:gateTimeoutMs:readMinMs:onChange:store:transport:setTimer:clearTimer:)`. Defaults are AIService, AdviserContext over transport, the usage kept in store, and task timers.
  - configure(did:settings: JSONValue?, requester:, canUseAi:, onApplyFixes: ([String]) -> Void), or configure(Config). It replaces the whole config; the web merges, and Composer always passes every field.
  - check(state JSONValue?|ComposerState, mode: "gate"|"manual") starts at once and returns AdviserCheck, whose `decision` async is AdviserDecision .publish/.edit/.draft.
  - choose(AdviserChoice), decide(String|AdviserDecision), applyFix([AdviserSheetFix]|AdviserSheetFix?) -> Int, cancel(), isEnabled, usageLine().
  - `view: AdviserView{busy: AdviserBusy{mode,goals,startedAt,choices}?, sheet: AdviserSheetRead?, usageVersion}`. AdviserSheetRead has `.json`, the web's sheet object, and `.model`.
  - The fast-answer hold lets go only of its own hold. The web's bug where a second sheet can't be decided is kept on purpose.
- `@MainActor @Observable AdviserGateModel(controller:store:transport:)` (useAdviserGate):
  - State: busy, sheet, enabled, usageLine.
  - configure(did:settings: JSONValue?|AdviserSettings?, requester:, canUseAi:, onApplyFixes:). A new did cancels what's in progress and re-reads the usage line.
  - Or configure(did:settings:session: SessionModel, onApplyFixes:), which gives a requester only when capabilitiesFor(did).canUseAi, as Composer.jsx does (canSchedule and canUseAi are both longSession). It reads the caps of the did passed, so did nil (a closed composer) is disabled.
  - check(state, mode:), canPublishAnyway/publishAnyway/keepEditing.
  - sheetOpen/closeSheet/keepEditingFromSheet/publishFromSheet/saveDraftFromSheet, applyFix, dispose.
  - `AdviserGateModel.applyFixes(to: ComposerStateModel)` is the composer's onApplyFixes.

UI (Sources/VirgaPosting/UI/)
- BackendAccess.backendAccess(_ account: JSONValue?|SessionAccount?, authMode:, canSchedule:) -> BackendAccessState{ready, action}.
- PostPreview.embedSummary(embed, locale:) -> String?, and PostPreview.postPreviewModel(view:record:uri:compact:locale:) -> PostPreviewModel{uri, url, author: PostPreviewAuthor?, text, at, embed, counts: PostPreviewCounts?, isReply}.

WIRING FOR THE MERGE
- AIService's fileprivate blobToBase64 (Data.base64EncodedString) should switch to the scheduling port's blobToBase64.
- Nothing calls the library chain. LocaleCompare and JSCollation are not used.

## Gaps and deliberate differences

At port time:

- AIService.generateAltTextForFile uses a fileprivate blobToBase64 stand-in (bytes.base64EncodedString(), which is what btoa of the bytes gives). The merge should switch it to the scheduling chain's port of scheduleSerialize.js blobToBase64. It takes a `read` closure for the file's bytes, which VirgaUI supplies from ComposerFile.ref.
- The recorded fetch can't play a timeout from Virga's server: _fetch.js has no timeouts, and its setTimeout runs at once. TIMEOUT ('That took too long. Try again.') is covered by a behaviour test over MockTransport `.timeout`, and the context read's 4-second give-up by one over `.hang`. The race against the context deadline in the fixture (the fetch won) is replayed with a recording sleep that never ends on its own.
- Divergences on malformed input, documented in the module map: context.js adviserSource with a `posts` that isn't a list reads as empty (the web throws calling .map), and postPreview's non-string displayName reads as none (the web throws calling .trim). sheet.js's DRAFT_LABELS and CONTEXT_LABELS don't reproduce prototype keys ('constructor'). AdviserChoice is an enum, so the web's handling of junk choice strings in choose() (a '' choice in the hold opens the sheet) isn't modelled.
- AdviserReader captures `analyze` when readAdviser is called; the web reads it a microtask later. The controller sets it just before, so nothing differs.
- StyleSession drops a running count that hops over from the network after the posts came back; on the web every onPage call comes first. The controller's usage line uses its injected clock; the web's sheetFor/usageLine call adviserUsageLineFor without `now`, so it reads the real clock. The two agree in the app.
- No notes file was written (ios/porting/notes/adviser.md): the brief didn't name it. The map's notes carry the deliberate differences, and the API above can become the notes.
- AdviserGateModel isn't yet wired into the composer's publish flow: Composer.jsx's submitPost and the 'Check this post' button belong to the composer UI chain. The model offers configure(did:settings:session:) and applyFixes(to:) for that.

Still open after the audit:

- AIService's fileprivate blobToBase64 (Data.base64EncodedString) is a stand-in. The merge should switch it to the scheduling chain's port of scheduleSerialize.js blobToBase64. generateAltTextForFile takes a `read` closure for the file's bytes, which VirgaUI supplies from ComposerFile.ref.
- My first run of the adviser suites failed with 6 issues. The output was lost and about 20 later runs never reproduced it, including one-core starvation runs of the porter's original test files. The real-timer deadlines I removed were the only clock dependence I found, but they are not confirmed as the cause.
- I wrote no ios/porting/notes/adviser.md and no ios/STATUS.md row. Earlier notes were written in separate commits after each merge, and STATUS.md is shared with the chain working on publish, drafts and scheduling. apiForDownstream below is meant to become those notes.
- These divergences on malformed input stay, and the module map documents them. adviserSource with a `posts` that isn't a list reads as empty (the web throws). postPreview's non-string displayName reads as none (the web throws). sheet.js DRAFT_LABELS/CONTEXT_LABELS don't reproduce prototype keys. AdviserChoice is an enum, so junk choice strings aren't modelled. aiErrorMessage and styleErrorMessage always answer a string: a non-string message comes back as String(value) or ''.
- The controller's sheet usage line uses its injected clock, where the web's sheetFor/usageLine read the real clock. They agree in the app.
- AdviserGateModel.configure(did:settings:session:) reads capabilities for the `did` it is given. A closed composer (did nil) therefore reads as disabled, while the web computes caps from asDid even when closed. Nothing on screen differs.
- AdviserGateModel is not yet wired into the composer's publish flow: Composer.jsx's submitPost and the 'Check this post' button belong to the composer UI chain. It offers configure(did:settings:session:) and applyFixes(to:) for that.
- Two signature changes for VirgaUI. onPage (fetchStylePostTexts/learnWritingStyle) and onUsage (generateAltText/generateAltTextForFile) are now async closure types; synchronous closures still convert. The tests were only built on Linux: Xcode's Swift 6.2 checker has not compiled the adviser tests. AdviserGateParity.play and AdviserReadModelBehaviour capture local vars in main-actor closures; ArchiveModelTests has merged precedent for that.

## Audit

- **medium** `tests only (gate.js startAdviserRead / gateController.js check)` Several adviser tests ran the 10 s gate deadline on real task timers: AdviserGateModelBehaviour.model, AdviserGateParity.play, AdviserReadModelBehaviour (the two gate reads) and AdviserGateReadBehaviour.theSignalStaysLiveOnAnAnswerOrAFailure. On a machine starved for that long, the deadline could fire before the scripted answer, which breaks the brief's rule that tests stay deterministic under load. They now run the deadline on ManualTimers that never fire. Separately, my very first run of the adviser suites failed with 6 issues. Its output was lost, and about 20 later runs never reproduced it, including 3 pinned to one core with two CPU hogs (about 83 s each) and one of the porter's original test files under the same starvation. So the real-timer deadline is not confirmed as that cause. It was the only real-clock dependence I found in these tests. *Fixed:* True
- **low** `src/posting/adviser/style.js fetchStylePostTexts, styleSession.js start` StyleSession's default work passed each running post count to the main actor through an unstructured `Task { @MainActor }`, and dropped any count that arrived after the posts did. On the web, fetchStylePostTexts calls onPage inside its page loop, so every count reaches the dialog, in order, before the texts come back. fetchStylePostTexts and learnWritingStyle now take `onPage: (@Sendable (Int) async -> Void)?` and await it on each page. StyleSession sets each count only while its run is the current one (the web's `alive()`), with no stage guard. Added behaviour test theDefaultWorkCountsEveryPageBeforeTheReading (two AppView pages: counts [0, 3, 6, 6, 6]) and updated the module map note. *Fixed:* True
- **low** `src/posting/adviser/aiService.js generateAltText` generateAltText's onUsage was a synchronous callback called off the main actor, so a main-actor dialog had to make a hop of its own, which could land after the description returned. The web calls onUsage before it answers. generateAltText and generateAltTextForFile now take `onUsage: (@Sendable (AIUsageCount) async -> Void)?` and await it. Added behaviour test theCountIsHeardBeforeTheDescriptionComesBack. *Fixed:* True
- **low** `src/posting/adviser/gateController.js holdFastAnswer` AdviserGateController.holdFastAnswer set `hold = nil` unconditionally after its await. On the web, microtask order guarantees that line runs before any later check can hold again. In the port it now clears only its own hold (`if hold === held`), so the outcome no longer depends on main-actor job order. I left the web's undecidable-second-sheet bug in decided() as it is, on purpose. *Fixed:* True
- **low** `src/posting/ui/postPreview.js embedSummary; altTextFollowUp.js looksTranscribed; aiService.js generateAltTextForFile` Coverage was thin in three places, so I added 93 fixture cases: the link card's host as URL reads it, in every locale (default port dropped, credentials, IPv6 in brackets, upper case, a bare `www.`, data: and mailto: with no host, a numeric uri); descriptions broken by CRLF and by label lines (looksTranscribed and rankQuickNotes); and a file whose own bytes and type win over an imageBase64/mimeType in the payload. The port matched the web on all of them. I compared all 15 web files with their ports export by export (UTF-16 indexing, ASCII regex classes, truthiness, default parameters, stable sorts, `===` string comparisons, copy, locales and zones) and found no logic discrepancy in the pure functions. *Fixed:* True
- **low** `src/posting/adviser/styleSession.js start` New web bug, kept in the port. In styleSession.js start, a success sets `usage: result.usage || view.usage`. Say a monthly_limit failure has already set view.usage to {used: limit, limit} in this sitting. If a later reading succeeds with no usage (the account is now unlimited, or the server didn't count it), the stale used-up count stays. StyleDialog.jsx prefers v.usage over the store, so it says 'No free style readings left this month…' right after a reading that worked. *Fixed:* False
- **low** `gateController.js, styleSession.js, usage.js, context.js, aiService.js` I checked all 6 of the porter's web bugs and each holds: the second sheet in gateController that can't be answered, the mixed locales in styleProfileLine, the raw fractional counts in adviserUsageLine, years 0–99 in usageResetsAt, the 'someone' target in gatherReplyContext, and aiErrorMessage giving undefined for NEEDS_BACKEND. The port keeps each one. *Fixed:* False

## Web bugs noticed

- low, src/posting/adviser/gateController.js openSheet: if a manual check of an empty post (needsText) or one with nothing set up (empty) starts while another check's sheet is open, the first sheet's decision promise settles through endCurrent. Its `.then(() => { sheetDecision = null })` then runs after the new check has already opened its sheet synchronously. That clears the new sheet's sheetDecision, so decide() does nothing and the new sheet can't be answered from the sheet; only cancel() or another check ends it. The port keeps this. It is hard to reach because the sheet is modal.
- low, src/posting/adviser/styleSession.js styleProfileLine: the count is formatted with activeLocale() but the date with the `locale` option. With locale 'en-GB' while the app is in 'en-IN', the line mixes the two locales. Kept.
- low, src/posting/adviser/usage.js adviserUsageLine: the line uses the usage's raw `limit - used`, while readAdviserUsage floors the counts. A fractional count passed straight from a server answer reads '28.5 of 30 free checks left this month.' readAdviserUsage's own results are whole numbers. Kept.
- low, src/posting/adviser/usage.js usageResetsAt: it uses Date.UTC(getUTCFullYear(), …), which reads years 0–99 as 1900–1999 (now in year 50 resets in 1950). This is the same class as the known postingQueue/repeat bug and can't be reached. Kept.
- low, src/posting/adviser/context.js gatherReplyContext: when the composer has the replied-to post's text but not its author, the target is '{ author: someone }' even when the thread read returned the author's handle for the same post. The composer's line always wins over the thread's (fixture case self-reply). Kept.
- low, src/posting/adviser/aiService.js aiErrorMessage: for an error with code NEEDS_BACKEND it returns `err.message` as it is, which is undefined for an object without one. Inside aiService that message always exists. Kept (the port answers nil).
