# composer: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited (2026-11-22). The adviser's setup.js and analysis.js came with it.
Parity cases at port time: 5099, plus 139 added by the audit.
Tests at the time: The whole package passes under `swift test` on Linux (Swift 6.4.2), with no issues recorded. Per target, in tests/suites: 194/32, 57/12, 358/65, 99/26, 152/29, 140/24, 144/23, 176/31 and 126/16. VirgaPostingTests went from 352 to 358 tests. It gained ComposerStateModelBehaviour's three new tests, GatesAgentWiring's three, a pastedImageFiles parity loop and an intentLoadsPlan loop. `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity` passes 156 of 156, `npx eslint ios` is clean, prettier --check passes on every composer generator, and `npm run parity:drift` reports no drift. I checked that the new cases catch the old code: I stashed the Swift source fixes and re-ran the composer parity suites, and the new cases failed in videoParity, flow, editor, loaders, storage, schedule and the rest. The fixtures now hold 5238 composer cases (they held 5099). Commits on ios/w6-a: 7417b3e, d449f6b, 6324a43, 77c7afd and 542561e.

## API for the code that builds on it

All of this is in VirgaPosting (`import VirgaPosting`), under ios/VirgaKit/Sources/VirgaPosting/.

CONVENTIONS
- Each web module is an enum with the web's function names.
- Loose web values are JSONValue.
- Composer shapes are JSON-backed ComposerObject views, each with `.json`: ComposerState, PostDraft, ComposerImage, ComposerVideo, ComposerRecord, ComposerCard, ComposerGates, ComposerSchedule, ComposerSource, ComposerReply, ComposerAction, ComposerTargetRef, ComposerIntentPlan.
- Files are ComposerFile: `{ $file: true, name, type, size, lastModified, ref }`, where `ref` is the app's handle on the bytes.
- Times are epoch ms Doubles; NaN means an invalid date.
- `timeZone`/`localZone: TimeZone?` is the device zone; nil means AppLocale's active zone.
- Schedule zones are IANA names, read as Intl reads them (`PostingQueue.timeZone(named:)`).
- Stores are `(any KeyValueStore)?`, with the web's keys and JSON.
- Loose comparisons go through the internal ComposerJS.jsLessThan/less/greater/greaterOrEqual (JS IsLessThan: two strings compare by code unit).
- Never write `cond ? x : nil` into a JSONValue? (nil becomes .null).
- Test helpers: ComposerFixtures.canonIds/checkCanon (Tests/VirgaPostingTests/ComposerTestSupport.swift), ScriptStore (quota/refuse/plant), ManualTimers, ScriptedEncoder, ScriptedAuthAgent, checkPart.

COMPOSER STATE
- Lib/ComposerModel*.swift, `ComposerModel`:
  - Constants: maxPosts, maxImages, maxLangs, scheduleMinLeadMs, scheduleMaxDays, selfLabels.
  - newId, emptyPost, normalizePost, normalizeComposerState, emptyComposerState(asDid:defaults:), postHasContent, isEmptyComposer, labelsToSelfLabels, selfLabelsToLabels.
  - composerReducer(ComposerState, ComposerAction); the actions are ComposerAction.setText, .addPost … .load, .reset.
  - validateComposer(state, now:, forSchedule:, requireAltText:, lifespanProblem:, timeZone:) -> [ComposerProblem{postIndex, code, message}].
  - resolvePostTexts.
- Composer/ComposerStateModel.swift: `@MainActor @Observable ComposerStateModel(ComposerState | asDid:defaults:, autosaver: Autosaver?, now: () -> Double, session: AutosaveSession = .shared)`.
  - dispatch(_:), load(_:touched:), chooseLifespan(_:) (the writer's timer: touched, set, and kept at once even when unchanged, as the web's reducer always makes a new state), problems(now:…), actions(defaultAction:queue:caps:…), isEmpty, lifespanTouched, cancelAutosave().
  - typed(index:text:) and textChangeCount(_:) (iOS only; the web's textarea is the post's text): typed hands a post editor's words on, and every other change to a post's text, through dispatch or load, counts for that post. The post editor puts the post's text in its field only when the count has moved (notes/ui.md, "CI's screenshots against each other").
  - It follows Composer.jsx's autosave effect. A change with content is debounced to the autosaver and kept in the session layer. An empty state only clears an account this composer wrote for (wroteFor). load cancels the waiting write and forgets wroteFor.

SCHEDULE (Schedule/)
- `PublishActions`:
  - post, schedule, queue, draft; publishActionOptions; the hints; needsBackendHint.
  - normalizePublishAction, getPublishActionLabel.
  - scheduleBlockReason(canSchedule:video:authMode:), queueBlockReason(reply:).
  - resolvePrimaryPublishAction(preferred:canSchedule:canSaveDraft:), publishActionBlockReason(_:queueEmpty:scheduleBlock:queueBlock:).
- `PostingQueue`:
  - queueHorizonDays, minLeadMs, defaultPostingQueue (JSON), weekdays.
  - dayDiff, dateBucketLabel, groupByDateBucket(…, now:, locale:, timeZone:).
  - resolveTimezone(_:localZone:), intlName(TimeZone), timeZone(named:).
  - isScheduleEmpty, isShippedDefaultSchedule.
  - zonedWallTimeToUtc(date, time, tz) -> Double?, zonedWallTime(value, tz, timeZone:) -> ZonedWallTime?. The offsets read years as the web does, so instants before the year 100 come out as the web's do.
  - slotWalk/enumerateSlots(schedule, fromMs, tz?, localZone:) throws PostingQueueError (Intl's words).
  - nextOpenSlot(schedule, rows, now:, localZone:) throws -> Double?; recomputeQueueAssignment(…occupied:) -> [QueueAssignment].
  - summarizeQueue, relativeWhen, postSnippet, queueSlotMoveNote.
- `Repeat`:
  - repeatEvery, maxRepeatCount, repeatOptions, the hints.
  - normalizeRepeat -> RepeatRule?, repeatEnds, repeatProblem(raw, at, tz, occurrence:, timeZone:), repeatForServer, anchoredRepeat.
  - occurrenceTime -> RepeatOccurrenceTime?, nextOccurrence(_:_:nowMs:).
  - repeatLabel; repeatProgress, repeatSummary and rowRepeat(…, now:, locale:, timeZone:), where `now` gives 'this year'; repeatClause.

COMPOSER MODULES (Composer/)
- ComposerEditing: replaceRange, insertMention, pasteAsInlineLink -> InlineLinkPaste(.linked(TextEdit) | .refused), misleadingLinkNotes, removeLinkFromText, limitAnnouncement, nearLimitLeft.
- Highlight: facetRanges, highlightSegments -> [HighlightSegment{text, kind}].
- ThreadEdits: splitTexts; planSplit/planRenumber -> ThreadPlan{action, undo}; undoStands, undoAction, undoLine.
- ComposerMedia: imageInputAccept, pastedImageFiles([PastedItem]?, text:, now:) (held to the fixture), sortIncomingFiles -> IncomingFiles, formatDuration, missingAltCount.
- ComposerLanguages: languageCodes, languageName, searchLanguages, langsSummary, labelsSummary, adultLabelOptions, graphicLabel. compareNames is the one sort helper. The English names come from ComposerLanguageNames (ComposerLanguages+Names.swift: english 1061, regional 25, regions 630, scripts 204, from Node 22's ICU 78.3).
- ComposerActions: postFacts, composerActions(state, defaultAction:queue:caps: ComposerCaps…) -> ComposerActionSet, actionLabel, draftMaxGraphemes, the hints.
- ComposerDefaults: defaultTimerFor(settings, canSchedule:limitsStatus:limits:fit:) -> DefaultTimer, gatesSourceLine, gatesSummary, gatesShortSummary.
- BlueskyGatesCache (Composer/BlueskyGatesCache.swift) is Composer.jsx's blueskyGates, readBlueskyGates and resolveGatesFor: one entry per account, a good read kept 5 minutes (`cacheMs`) and a failed one 30 seconds (`failureCacheMs`), an agent that can't be had counting as a failed read. `read(did, agent:)`; `resolve(settings, did:, agent:)` goes through PostingSettingsStore.resolveDefaultGates, and an empty did skips the read. VirgaUI's ComposerController holds one, so the Replies row and the post that goes out agree.
- GatesModel: ruleOptions, replyMode, hasRule, toggleRule, rulesNote, isForeignListRule, gatesForAccount -> AccountGates, unlistedRules.
- ComposerIntent: readTargetRef -> ComposerTargetRef?, normalizeIntent(_:activeDid:) -> ComposerIntentPlan, intentLoads (reads members by truthiness), seedFromIntent(base, plan, emptyPost:).
- ComposerSubmit:
  - PublishWatch/createPublishWatch(…, setTimer:clearTimer:), progressLine, publishErrorView(any Error) -> PublishErrorView.
  - accountLabel, postedToast, whenWords/scheduledMessage(…, now:, locale:, timeZone:, localZone:), queueSlotRows.
  - finishSource(source, asDid:agentFor:backendFor:deleteDraft:cancelScheduled:wait:) -> FinishSourceResult; status(of:).
  - CancelMarkedError. VideoError, VideoCancelledError and ComposerCancelledError are JSErrorConvertible.
- ComposerRestore: restoredTouched, keptPostFor -> KeptPost, clearKept, setAsideState, setAsideKept, isUntouchedSeed, worthSettingAside, mediaPatches -> [ComposerAction] (posts matched by id as a Map matches them), otherKeptAccount. All take store:, now:, session:.
- ComposerLoaders:
  - ComposerReads(.network(transport:)), refUri, replyFromView.
  - loadReplyTarget, loadRecordTarget (400/404 read from any error's status).
  - loadDraftTarget<Agent, Opened>, loadScheduledTarget<Requester, State> -> ScheduledTarget.
  - continueCandidates (a negative limit slices from the end).
  - Errors are ComposerLoadError{code, message}.

STORAGE
- Autosave.swift, `Autosave`:
  - autosaveKey, serializeComposerState, hasAutosaveContent, deserializeComposerState(_:base:now:).
  - writeAutosave, readAutosave, clearAutosave(did, …, store:, now:).
  - setAside, countSetAside, takeSetAside(…, session:).
  - saveSessionDraft, loadSessionDraft, clearSessionDraft, forgetSessionDrafts, clearAllSessionDrafts; collectPreviewUrls, previewUrlIsHeld.
  - Autosave+Files.swift: collectFileRefs(state) and fileRefIsHeld(ref, state), collectPreviewUrls and previewUrlIsHeld applied to the local files a state holds (the images' and the video's file refs, a card's thumbFile, and `file:` previews). On iOS a preview is the file itself, so VirgaUI deletes a temporary file on this test where the web revokes an object URL.
  - AutosaveSession (.shared) is the in-memory layer.
  - `Autosaver(store:now:debounceMs:currentDid:setTimer:clearTimer:)`: save, flush, cancel, pending, dispose. The app calls flush() when its scene goes to the background. `Autosaver.mainActorTimers()` gives timers whose callback runs on the main actor; the composer builds its autosaver with them, so the debounced write can't land between its own cancel() and what it does next (clearKept after a send, a set-aside).
- Settings.swift:
  - `PostingSettingsStore`: postingSettingsKey, baseLanguage, defaultPostingSettings(language:) -> PostingSettings (typed: langs, gates: PostGates?, lifespan: TimerRule, queue: QueueSettings, defaultAction, requireAltText, showThreadSuggestion, threadNumbering, adviser: AdviserSettings, suggestBestTimes; `.json`).
  - readPostingSettings(did, store:, language:), writePostingSettings(did, patch, store:, target:) throws PostingSettingsError{field, message}, resetPostingSettings.
  - resolveDefaultGates, in two forms: (JSON, readDefaultGates:) async throws, and (PostingSettings, agent: GatesAgent?) (pass `xrpcAgent.gatesAgent`).
  - `@MainActor @Observable PostingSettingsModel(did:store:language:target:)`: settings, update(_:) throws, reset(_:), setDid, settle() (awaits bus deliveries), stop().
- Lib/PendingCompose.swift: isComposePath, rememberPendingCompose(path, search, store:, now:), takePendingCompose(store:now:).
- Adviser/Analysis.swift, `AdviserAnalysis`: normalizeAdviserScope, adviserScopeAllowsDraft, adviserScenarioFor, enabledWritingChecks, fixableWritingIssues, applyWritingFixes, applyWritingFixesToThread -> AppliedThreadFixes{posts: JSONValue? (nil is the web's undefined), applied}.
- Adviser/Setup.swift, `AdviserSetup`: AdviserSettings and its parts, defaultAdviserSettings, normalizeAdviserSettings, normalizeStyleSampleSize, isPostingAdviserPristine, nextPostingAdviserState, adviserTextLimits.

MEDIA
- Lib/Images.swift, `Images`:
  - prepareImage(ComposerFile, budget:, encoder: any ImageEncoder, timeoutMs:, sleep:) throws ImageProcessingError -> PreparedImage{file, mime, size, aspectRatio}.
  - compressOptions, jpegName, isImageFile, imageBudget, cardThumbBudget, uploadImage(agent:image:data:).
  - `protocol ImageEncoder { compress(ComposerFile, ImageCompressOptions) async throws -> ComposerFile?; decodeSize(ComposerFile) async throws -> ImageSize? }`. VirgaUI implements it over ImageIO (ImageIOEncoder), copying no metadata (no EXIF).
  - Lib/Images+Compress.swift: `compress(longSide:originalSize:options:png:render:)` is browser-image-compression 2.0.2's compress loop over an encoder's single render, and ImageIOEncoder walks it. The longer side is always capped at maxWidthOrHeight. The first render, at initialQuality, is the answer when it is within maxSizeMB (MiB) and no larger than the original. Otherwise at most `maxIteration` (10) more renders follow, each at the quality × 0.95 (× 0.85 for PNG), and at 0.95 of the side (truncated) only when alwaysKeepResolution is off and the first render was over budget. The last render is the answer even when still over, so prepareImage's own 1.9 MB check decides. So an original under 1.9 MB whose re-encode quality alone can't bring under 1.9 MB is refused, as on the web (a full-size HEIC photo is the likely case; not yet tried with real photos on a device).
- Lib/Video.swift, `Video`:
  - validateVideoFile, normalizeJobStatus (an array jobStatus stands in for the status), isUsableVideoBlob, videoLimitMessage, videoServiceUrl(route, [(key, JSONValue?)]).
  - getVideoUploadLimits, pollVideoJobStatus(…, options: VideoPollOptions, transport:, clock:).
  - uploadVideo(VideoTarget{did, pdsUrl, agent: VideoServiceAuthAgent}, VideoFile, onProgress:, now:, poll: VideoPollTuning, transport:, clock:, randomBytes:) -> UploadedVideo. XRPCAgent is a VideoServiceAuthAgent.

WIRING (Wiring.swift)
- `extension VirgaBackend: TimerRequester` and `extension BackendError: TimerErrorConvertible`.
- `Mentions.useNetwork(transport:)` and `networkFetch(transport:)`. The app calls useNetwork once at launch, in AppModel.init (device and demo alike, over archiveEnvironment.transport), so Drafts' and Scheduled posts' Post now resolve mentions through the network as the composer does. Tests that set Mentions.defaultFetch belong in the serialized MentionResolverBehaviour suite.
- `PostingEvents.postsChangedListener(target:) -> PostsChangedListener`: pass it as ArchiveEnvironment(postsChanged:).
- New: `public struct XRPCGatesAgent: GatesAgent` (getPreferences, getRecord, putRecord, deleteRecord as gates.js calls them), `XRPCAgent.gatesAgent`, and `extension XRPCError: XRPCErrorDescribing` (xrpcError = error, so RecordNotFound reads as none). Use these with Gates.readDefaultGates, Gates.updatePostGates and PostingSettingsStore.resolveDefaultGates(_, agent:).

## Known gaps and deliberate differences

- languages.js (partial): variants ICU names are not named ('de-AT-1996' is 'Austrian German (German orthography of 1996)' on the web; the port writes the variant's code). Also not reproduced: dialect names reached through three-letter, numeric or deprecated aliases ('eng-US', 'en-840', 'ab-SU'), extlang tags ('zh-yue'), and non-English locales, which go through Foundation. compareNames still calls VirgaPosting's LocaleCompare; the merge should point that one helper at VirgaCore's consolidated localeCompare.
- images.js (partial): the pixel work is VirgaUI's ImageIOEncoder (over ImageIO, through Images.compress). The prepared file keeps the encoder's lastModified, where the web's new File takes the clock's.
- media.js (partial): VirgaUI must build PastedItem values from UIPasteboard.
- loaders.js: isOwnThreadRow is a private stand-in in Composer/ComposerLoaders.swift; the merge replaces it with the library chain's port.
- postingQueue.js: when an instant's wall clock in its zone is past the end of time (within a day of 8.64e15, east of UTC), zonedWallTime gives nil where the web gives 'NaN-NaN-NaN'.
- The documented divergences on malformed input still stand: the web throws a TypeError and Swift reads the value as empty. This covers a non-list day in isShippedDefaultSchedule, a non-string post text in postSnippet, a null row in nextOpenSlot, non-array images in autosave serialization, a null post in applyWritingFixesToThread and a null rule in GatesModel.sameRule. Plain-object prototype lookups ('constructor' and the like) are not reproduced either.
- writePostingSettings checks a patch's keys in sorted order: JSONValue objects don't keep the web's insertion order. The two differ only in which error is thrown first when a patch carries two invalid keys.
- The merge should check that no other chain also adds a GatesAgent conformance or XRPCError: XRPCErrorDescribing (both are now in VirgaPosting/Wiring.swift).

## The audit (2026-11-22)

- **medium**, src/posting/composer/Composer.jsx autosave effect (wroteFor), loadState: ComposerStateModel autosaved every change, empty states included. Autosaver.save → writeAutosave → clearAutosave meant that opening a composer, or switching it to an account with a post kept for it, wiped that post. Composer.jsx has a wroteFor rule against exactly this: an empty state only clears an entry the composer itself wrote. The model also never kept the session draft (saveSessionDraft) and had no loadState. Fixed: it now has the web's wroteFor rule, keeps the session layer (session: and now: are injectable), has load(_:touched:) (cancels the waiting write, forgets wroteFor, sets lifespanTouched), and keeps a state that holds something when it opens, as the web effect does on mount. Three behaviour tests added.
- **medium**, src/posting/schedule/postingQueue.js tzOffsetMs / zonedWallTime / enumerateSlots: tzOffsetMs computed the true UTC offset. The web reads the wall clock back through formatToParts and Date.UTC instead. formatToParts gives the era's year without the era (1 BC is "1") and Date.UTC reads 0–99 as 1900–1999, so on the web instants before the year 100 come out centuries off. Examples: zonedWallTime('0050-06-01T12:00Z','UTC') is 1950-06-01, and -8.64e15 is the year 271822. enumerateSlots from such a `from` gives no slots on the web, while Swift gave a full week. Fixed: the offset is now rebuilt from the wall parts as the web does, including wall times past either end of the Date range (read via the 400-year cycle). Cases added in four zones, plus the enumerateSlots ones.
- **medium**, src/posting/composer/languages.js languageName (Intl.DisplayNames): languageName's English table held only the 184 picker codes plus 20 dialect names. A device language that baseLanguage keeps as three letters came out as the bare code instead of ICU's name: 'fil' instead of 'Filipino', 'yue' instead of 'Cantonese'. Legacy codes ('iw') did the same. Tags with both a script and a region were named from the second subtag only, and through Foundation's region names ('China mainland', 'Hong Kong' where ICU says 'China', 'Hong Kong SAR China'). Fixed with tables generated from Node 22's ICU 78.3, in a new Composer/ComposerLanguages+Names.swift: 1061 language codes; dialect names, with en-UK, sr-ME, mo-MD, sw-ZR and nds-NL added; and 630 region and 204 script names taken from inside a language's name ("Myanmar [Burma]"). Unknown subtags are written as their codes and tags DisplayNames refuses come back as the code. Thirty-four cases added.
- **low**, src/posting/settings.js checkReplyRule (AT_LIST_URI): The settings list-rule check used AtUri.parseExact, which rejects a record key containing '?' or '#'. AT_LIST_URI (/^at:\/\/[^/]+\/app\.bsky\.graph\.list\/[^/]+$/) allows both, so a list rule the web keeps threw 'One of the reply rules isn’t one Bluesky knows.' Fixed to the regex's exact shape. Eight URI cases added.
- **low**, src/posting/lib/composerModel.js validateComposer: validateComposer counted langs with Array.isArray. The web uses `(state.langs || []).length`, so a string langs 'abcd' gives TOO_MANY_LANGS. Fixed, with cases.
- **low**, src/posting/lib/video.js normalizeJobStatus: normalizeJobStatus treated an array jobStatus as absent and fell back to the result. In JS `typeof [] === 'object'`, so the array becomes the status and the answer is null. Fixed, with cases.
- **low**, src/posting/composer/restore.js mediaPatches: mediaPatches keyed posts by String(id). The web's Map keys by the value itself (SameValueZero): 1 and '1' are different posts, and an object id never matches. Fixed, with cases.
- **low**, src/posting/composer/editing.js, highlight.js, submit.js progressLine: Loose offsets were compared as numbers. JS relational operators compare two strings by code unit ('10' < '9'), and only a number === the text's end in byteToCharIndex. This affected pasteAsInlineLink, removeLinkFromText, facetRanges, highlightSegments (whose marks now keep the raw offsets) and progressLine's done >= total. Fixed with ComposerJS.jsLessThan/less/greater/greaterOrEqual, which Repeat's comparison now shares. Cases added.
- **low**, src/posting/composer/languages.js searchLanguages, loaders.js continueCandidates: A negative limit sliced from the end in the web (slice(0, -n)), but Swift clamped it to 0 in searchLanguages and continueCandidates. Fixed, with cases.
- **low**, src/posting/composer/intent.js intentLoads: intentLoads tested the plan's members for nil, not for truthiness, so a plan with scheduledId '' or attach false loaded them. Fixed, with an intentLoadsPlan fixture.
- **low**, src/posting/composer/loaders.js loadRecordTarget: loadRecordTarget took a 400 or 404 as 'gone' only from a PublicXrpcError. The web reads `err?.status` from any error. Fixed through JSErrorFields (ComposerSubmit.status(of:)).
- **low**, src/posting/adviser/analysis.js applyWritingFixesToThread: applyWritingFixesToThread with posts undefined returned posts: null. The web returns { posts: undefined }, which JSON drops. AppliedThreadFixes.posts is now JSONValue?.
- **low**, src/posting/composer/media.js pastedImageFiles: pastedImageFiles (media.js) had no test of any kind. composer.editor now records the web's answers for 16 scripted clipboards: text or none, string items, non-image types, missing files, a type without a subtype, a file whose type differs from its item's, several items. The Swift side runs PastedItem values over them.
- **low**, src/posting/lib/gates.js readDefaultGates/updatePostGates, src/posting/settings.js resolveDefaultGates: The posting-text notes left a wave-2 seam that the composer's settings need: an XRPC agent conforming to GatesAgent, and XRPCError recognised as XRPCErrorDescribing for RecordNotFound. Without it, resolveDefaultGates(settings, agent:) and updatePostGates had no real agent. Added XRPCGatesAgent (a wrapper, because XRPCAgent's template putRecord and deleteRecord already return a body), XRPCAgent.gatesAgent, and XRPCError: XRPCErrorDescribing in Wiring.swift, tested over MockTransport.
- **low** (left as the web has it), src/posting/composer/submit.js whenWords: New web bug, kept in the port: whenWords' 'tomorrow' is now + 24 hours, not the next calendar day, so it misses across a clock change. At 23:30 on the eve of New York's spring-forward day, a post at 10:00 the next day reads 'Sun, Mar 8 at 10:00 AM'. At 00:30 on the fall-back day, a post the next day reads 'Mon, Nov 2 at 10:00 AM'. Both should read 'tomorrow at 10:00 AM'.
- **low** (left as the web has it), src/posting/schedule/postingQueue.js tzOffsetMs, src/posting/schedule/repeat.js parseDate: New web bug, kept in the port: postingQueue.js tzOffsetMs puts instants before the year 100 centuries off, for the formatToParts and Date.UTC reasons above. zonedWallTimeToUtc('0050-06-01','12:00','UTC') is 1950-06-01T12:00Z. zonedWallTime(8.64e15, 'Asia/Kolkata') gives { date: 'NaN-NaN-NaN', time: 'NaN:NaN' }; the Swift gives nil there, which is the one case not reproduced. repeat.js parseDate also reads years 0000–0099 through Date.UTC as 19xx.
- **low** (left as the web has it), src/posting/settings.js writePostingSettings: New web bug, not reproduced (the known prototype class): writePostingSettings looks checkers up with CHECKERS[key]. A patch key 'constructor' therefore calls Object(value) and writes a 'constructor' member into the stored settings and into the returned ones.
