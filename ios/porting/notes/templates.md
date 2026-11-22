# templates: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited (2026-11-21).

Parity cases at port time: 2854, plus 1287 added by the audit.
Tests at the time: Whole package, swift test on Linux (Swift 6.4.2): all suites pass on a clean run (Core 194, 57, Posting 275 in 45 suites, Network 99, 79, 69, Defense 144, 172, placeholder 1). One of three whole-package runs had the unrelated Defense ScorerBehaviour timing flake; it passed alone 4/4 and on the rerun. VirgaPostingTests went from 264 tests in 44 suites to 275 in 45: the new TemplatesRandomParity suite (9 tests), TemplateUsageBehaviour.aTimeNoJavaScriptDateHoldsStampsNow and TemplatesModelBehaviour.aNewAccountBeforeTheEffectRunsIsPending. I re-ran every new case against the porter's Swift with my source fixes stashed, and they fail there: patchVariable x4, addBlank x2, draftFromReply x2, draftFromTemplate x3, syncDraftVariables x2, templateUsage scripts and the date test. PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 3 files, 116 tests pass. npx eslint ios: clean. prettier --check on every templates generator: clean. Commits on ios/w5-a: 1f88997, eefb1db, 6b748cd. The template fixtures now hold 4,141 cases (2,854 before).

## API for the code that builds on it

All in VirgaPosting (`import VirgaPosting`). Paths are under ios/VirgaKit/Sources/VirgaPosting/.

CONVENTIONS
- Each web function is a static on an enum named after its module. Web names are unchanged.
- Template functions take `some TemplateFields`.
  - Protocol: `templateField(_ name) -> JSONValue?` (nil means undefined), `templateIsPresent` (truthiness) and `templateObject: [String: JSONValue]?` (what `{...t}` spreads for the service).
  - Conformers: JSONValue (read exactly as the web reads a plain object), PostTemplate and TemplateDraft.
- The JSONValue overloads are `@_disfavoredOverload`, so `nil` and string literals pick the typed one.
- Answers are `some TemplateAnswers`. Conformers: JSONValue (own members, `String(v ?? '').trim()`) and `[String: String]` (looked up by code unit).
- Strings compare by code unit throughout.
- Internal helpers:
  - `TemplateJS.spread(_:)`: `{ ...v }` as the web spreads, an array's or a string's indexes included. Used by the editor-draft and editor-model functions.
  - `JSObjectMap`: a JS object as a map; `__proto__` is never held.
- localeCompare goes through the internal `LocaleCompare` (Support/LocaleCompare.swift: Foundation ICU plus a trailing tab).
  - `LocaleCompare.compare(_:_:locale:sensitivity: .base | .variant)`.
  - nil locale means `AppLocale.activeLocale()`.

TYPES (Templates/PostTemplates+Types.swift)
- `PostTemplate` (Codable to the web's object, nulls included):
  - Fields: `uri: String?`, `cid: String?`, `rkey`, `name`, `text`, `variables: [TemplateVariable]`, `embed: JSONValue?`, `use`, `group`, `shortcut`, `keywords`, `langs`, `createdAt?`, `updatedAt?`.
  - Also `.json` and `init(json:)`.
  - `TemplateVariable` is VirgaCore's. It gains `.templateJSON` and `init?(templateJSON:)`.
- `TemplateContext`:
  - `their: Their?{name, firstName, handle}`, `my: My?{handle}`, `today`.
  - `init?(json:)`: lenient; a falsy member is absent.
- `TemplateQuestion`: `{key, label, hint, kind, choices, optional, defaultValue, note, isContext}`.
- `TemplateSegment`: `.text(String)` or `.blank(key:)`.
- `TemplatePart`: `{text, kind, key?}`.
- `TemplateDescription`: `{questions, quotes, fillsContext}`.
- `TemplateLimits`: TEMPLATE_LIMITS.
- `TemplateFieldErrors`: ordered `{field: message}`. Members: subscript, `entries`, `fields`, `firstMessage`, `isEmpty`, `.json`.

POSTTEMPLATES (Templates/PostTemplates.swift)
- `enum PostTemplates`, constants:
  - `templateCollection`, `templateLimits`, `templateUses`, `templateRecordFields`, `templateVariableFields`, `contextKeys`, `contextLabels`.
- Blanks and context:
  - `isContextKey(String?)`, `placeholderKeys(String?)`, `splitTemplateText(String?)` (each has a JSONValue overload).
  - `buildTemplateContext(replyTo: JSONValue?, self: JSONValue?, now: Date = Date(), locale: String? = nil, timeZone: TimeZone? = nil) -> TemplateContext`
  - `contextValue(String?, TemplateContext?) -> String?`
- Questions and answers:
  - `templateQuestions(_ t, _ ctx) -> [TemplateQuestion]`
  - `initialAnswers([TemplateQuestion]?) -> [String: String]`
  - `missingAnswers(_ qs, _ answers) -> [String]`
- Filling and preview:
  - `tidyTemplateParts([TemplatePart]?)`, plus a JSONValue? overload that keeps extra fields.
  - `fillTemplate(_ t, _ answers, _ ctx) -> String`
  - `templatePreviewParts(_ t, _ answers, _ ctx) -> [TemplatePart]`
  - `describeTemplate(_ t, _ ctx)`
- Matching:
  - `templateOffered(_ t, replying: Bool)`
  - `keywordMatches(_ t, _ text: String?) -> [String]`. It reproduces the web's split at combining marks (see WEB BUG).
  - `normalizeShortcut(String?)`
  - `matchShortcut<T: TemplateFields>(_ [T]?, _ query: String?, replying: false, limit: 5) -> [T]`
  - `blankKeyFromLabel(String?)`
- Records:
  - `normalizeTemplateRecord(JSONValue?) -> PostTemplate`, and `normalizeTemplateRecord(uri:cid:value:)`.
  - `templateToRecord(_ t, now: Date = Date(), isUpdate: false) -> JSONValue`: the record, with `$type`.
  - `validateTemplate(_ t, _ others: [O]) -> TemplateFieldErrors`, plus a one-argument form.

TEMPLATEUSAGE (Templates/TemplateUsage.swift)
- `enum TemplateUsage`:
  - `templateUsagePrefix`, `templateUsageKey(did)`
  - `readTemplateUsage(_ did: String?, store: (any KeyValueStore)?) -> TemplateUsageCounts`
  - `@discardableResult recordTemplateUse(_ rkey: String?, _ did: String?, _ now: Date = Date(), store:, timeZone: TimeZone? = nil) -> TemplateUseEntry?`. A time no JS Date holds is stamped now.
  - `sortTemplatesForShelf<T: TemplateFields>(_ [T]?, _ usage: TemplateUsageCounts?, locale: String? = nil) -> [T]`, plus a JSONValue usage overload.
- `TemplateUsageCounts`: ordered like a JS object.
  - Members: subscript(rkey), `entries[{rkey, use}]`, `jsonText` (JSON.stringify byte-exact).
  - A `__proto__` rkey is kept aside as the web's prototype is: readable through the subscript, never in `entries`, `count` or `jsonText`.
- `TemplateUseEntry`: `{count: Double, lastUsedAt: String?}`.
- The key is already in VirgaSession's `Accounts.localDataKeys`.

EDITOR DRAFTS (Templates/EditorDrafts.swift, EditorDrafts+Typed.swift)
- Pure. Nothing is stored, despite what the brief said.
- `enum EditorDrafts`:
  - `recordEmbed`, `externalEmbed`
  - `templateEmbedKind(JSONValue?) -> String?`
  - `blankTemplate: PostTemplate`, `blankTemplateJSON`
- Typed forms:
  - `syncDraftVariables(TemplateDraft) -> TemplateDraft`
  - `draftFromTemplate(PostTemplate?)`, and `draftFromTemplate(TemplateDraft)` (the editor's seed.draft path).
  - `draftFromReply(text:replyTo: JSONValue?, recordEmbed: JSONValue?, linkUrl: String?) -> (draft: TemplateDraft, note: String?)`
  - `templateFromDraft(TemplateDraft) -> PostTemplate`
- JSONValue versions of each:
  - `draftFromReply(JSONValue?)` takes the web's args object, with defaults applied only for absent args.
  - Spreads copy array and string indexes as the web does, and a string `langs` stays a string.
- `TemplateDraft`:
  - The template's fields plus `keywordsText`, `quoteMode` ('none'|'post'|'link'|'other'), `quoteUrl`, `quoteView: JSONValue?` and `extra`.
  - `init(json:)`, `.json`.
- `DraftVariable`: `{key, label, hint, kind, default, optional, choices, choicesText, extra}`.

EDITOR MODEL (Library/TemplateEditorModel.swift)
- `enum TemplateEditorModel`:
  - `useOptions: [TemplateEditorOption{value,label}]`, `contextInserts: [ContextInsert{key,label}]`
  - `insertAtSelection(_ text: String, _ token: String, _ sel: TextSelection? = nil) -> TextInsertion{text, caret}`. Also `(start: Double?, end: Double?)` and JSONValue forms.
  - `addBlank(TemplateDraft, String, TextSelection?) -> AddedBlank?{draft, caret, key}`
  - `patchVariable(TemplateDraft, key, [String: JSONValue]) -> TemplateDraft`
  - `blanksIn(TemplateDraft) -> TemplateBlanks{asked: [DraftVariable], context: [ContextBlank{key,label}]}`
  - `editorHasChanges(TemplateDraft, TemplateDraft) -> Bool`. It compares by value, a deliberate difference.
  - `editorProblems(TemplateDraft, [PostTemplate] = []) -> TemplateFieldErrors`. It adds `quote` for an unread link.
- Each also has a JSONValue form.
- The editor passes `others = templates.filter { !$0.rkey.jsEquals(template?.rkey ?? \"\") }`, as the web does.

SERVICE (Templates/TemplateService.swift)
- `protocol TemplateRepoAgent: Sendable`:
  - `did: String?`
  - `listRecords(repo:collection:limit:cursor:)`, `createRecord(repo:collection:record:)`, `putRecord(repo:collection:rkey:record:)`, `deleteRecord(repo:collection:rkey:)`
  - Each is `async throws -> JSONValue`, the response body.
  - `XRPCAgent` conforms, so `session.agentFor(did)` works directly.
  - Note: Lib/Gates.swift's `GatesAgent` declares putRecord/deleteRecord with the same arguments but returning Void. If XRPCAgent is ever made a GatesAgent too, call sites on a concrete XRPCAgent need a type context.
- `TemplateAccount(did:agent:)`, and `TemplateAccount(did:agentFor: @MainActor @Sendable (String) async throws -> (any TemplateRepoAgent)?)`.
- `TemplateServiceError(message, fieldErrors: TemplateFieldErrors?, permission: Bool, cause:)`:
  - It is LocalizedError and VirgaSession `JSErrorConvertible`; the cause's fields are kept.
  - Validation refusals carry `fieldErrors`, and the message is the first one. Permission refusals have `permission == true`.
  - Other refusals are rethrown untouched (an XRPCError, for instance).
- `@MainActor final class TemplateService`:
  - `init(store: (any KeyValueStore)?, target: PostingEventBus? = .shared, locale: String? = nil, now: @MainActor () -> Date = { Date() })`
  - `static var shared`: the app must set `TemplateService.shared = TemplateService(store: UserDefaultsKeyValueStore())` at launch. Until then it caches nothing.
  - Statics: `templatesCachePrefix`, `templatesCacheKey(did)`, `templatePermissionMessage`, `isRecordNotFound(_:)`, `isPermissionError(_:)` (all nonisolated).
  - Methods:
    - `load(_ account) async throws -> [PostTemplate]`
    - `loadTask(_:) -> Task<[PostTemplate], Error>` (the shared in-flight load)
    - `list(_ did)`, `isLoaded(_ did)`, `primeFromCache(_ did)`
    - `create(_ t: some TemplateFields, _ account) async throws -> PostTemplate`
    - `update(_ rkey: String?, _ t, _ account)`, `remove(_ rkey: String?, _ account)`
    - `subscribe(@MainActor (String?, [PostTemplate]) -> Void) -> @MainActor () -> Void`
    - `reset(_ did: String? = nil)`
  - It emits `virga:templates-changed` `{did, templates}` on `target`.

MODEL (Templates/TemplatesModel.swift)
- `@MainActor protocol TemplatesSession: AnyObject { templateAgent(for:) }`. SessionModel conforms.
- `@MainActor @Observable final class TemplatesModel(session:did:enabled: true, service: TemplateService? = nil /* .shared */)`:
  - Observed: `forDid`, `templates`, `loading`, `error`, `ready`.
  - Lifetime: `start()` (effect; call from `.task`), `setAccount(_ did:, enabled:)` (the effect runs again at once if started; before start it shows the hook's PENDING state), `stop()` (disappear).
  - Actions: `reload() async -> [PostTemplate]` (never throws), `create(_:)`, `update(_:_:)`, `remove(_:)` (these rethrow).
- One model per view that the web gave `useTemplates(did)`: composer, library, TemplateEditor, TemplatesPage, HubPage.

FIXTURES
- templates.postTemplates, templates.fill, templates.templateUsage, templates.editorDrafts, templates.editorModel, templates.templateService.
- templates.random (new): seeded random cases over postTemplates, editorDrafts, templateUsage and templateEditorModel. Its Swift test is VirgaPostingTests/TemplatesRandomParityTests.swift.

Test support (internal to VirgaPostingTests):
- `FakeRepo`: a TemplateRepoAgent with scripted closures that records its calls.
- `Gate`: an actor latch.
- `slowRepo`, `entry(rkey,name,did:,text:)`, `settle()`, `obj()`, `fixtureDate()`, `FakeTemplatesSession`.
- `TemplateScript`: replays templates.templateService scripts.

## Known gaps and deliberate differences

- The deliberate differences recorded in ios/parity/modules/templates.json still stand: a shape the web throws a TypeError on reads as absent; a non-string label, hint, choice, keyword, handle, URI or CID comes out as its String form; editorHasChanges compares by value; the service cache sorts each record's keys; TemplateService listeners can't throw.
- Accepted, not fixed. JSONValue objects lose key order, so the cache can't be byte-exact with the web's. Reaching it would need OrderedJSON through XRPCResponse in VirgaNetwork.
- Accepted, not fixed. templateToRecord given a NaN Date writes createdAt '' where the web throws RangeError; the app's clock never gives one.
- Accepted, not fixed. sanitize checks lastUsedAt with Date.parse in UTC where the web uses the runtime zone; they differ only at the ±8.64e15 edge.
- Accepted, not fixed. TemplateService.emitChanged walks a snapshot of its listeners, so one subscribed during an emit isn't called; a JS Set would call it. Nothing subscribes from inside a listener.
- Collation (sortTemplatesForShelf, TemplateService.list) is Foundation's ICU with a trailing tab, in the given or active locale. It is checked against Node on Linux only; Apple's Foundation needs CI's iOS job.
- SDK lexicon output checks aren't ported (VirgaNetwork's gap). Malformed listRecords or createRecord answers that the web refuses as InvalidResponse are read leniently; the lenient filtering has behaviour tests over FakeRepo.
- App wiring: at launch, set TemplateService.shared = TemplateService(store: UserDefaultsKeyValueStore()). Make one TemplatesModel per view that the web gave useTemplates (Composer, LibraryPanel/useLibrary, TemplateEditor, TemplatesPage, HubPage), and call start()/setAccount(_:enabled:)/stop() from the view.
- The library domain (src/posting/library/model.js, store.js, useLibrary.js, sources.js) should build on PostTemplates, EditorDrafts, TemplateUsage and TemplateEditorModel; library/model.js's libraryContext calls buildTemplateContext(replyTo:self:now:locale:).
- The brief said editorDrafts.js keeps drafts in localStorage. It doesn't: it is pure ('no React, no network, no storage'), and the port correctly keeps it pure. No KeyValueStore is involved.
- Nothing here needs the archive or analytics (the other chain), so no closures were injected.

## The audit

- **medium**, src/posting/templates/editorDrafts.js NAME_PROTECTED / draftFromReply: draftFromReply's protected spans (NAME_PROTECTED) disagreed with the web. The web regex has the flags `giu`, and under `iu` a character matches a class when its simple case folding does. I checked every code point in Node: that adds U+0345 (combining ypogegrammeni, which folds to ι) to each letter class. It also adds ſ to `https?`, which the port already had. So in '@aͅ.wren hi' and 'x@y.aͅ.wren' the web keeps the first name inside the handle or address, and the port turned it into {{their.firstName}}. Fixed by adding ͅ to the four classes. Four new templates.editorDrafts cases fail on the old code.
- **low**, src/posting/templates/editorDrafts.js syncDraftVariables/draftFromTemplate, src/posting/library/templateEditorModel.js addBlank/patchVariable: `{ ...value }` was ported as 'the members of an object only'. On the web, spreading an array or a string copies its indexes, and the port dropped them. Affected: syncDraftVariables, draftFromTemplate ({...BLANK_TEMPLATE, ...template}), addBlank ({...draft, text}) and patchVariable ({...draft, variables}, {...v, ...patch}). Fixed with TemplateJS.spread (indexes by UTF-16 code unit for strings). New cases in templates.editorDrafts and templates.editorModel fail on the old code.
- **low**, src/posting/templates/editorDrafts.js draftFromTemplate: draftFromTemplate turned a string `langs` into []. The web's `(base.langs || []).slice()` keeps the string ('en'.slice() is 'en'), and no TypeError is involved, so this didn't fall under the documented 'reads as absent' difference. Fixed. Case stringLangs (plus emptyStringLangs) added.
- **low**, src/posting/templates/templateUsage.js sanitize/recordTemplateUse: templateUsage with a `__proto__` rkey. On the web, setting that key sets the object's prototype. recordTemplateUse('__proto__') therefore counts and returns the use but never stores it, and a stored "__proto__" member (JSON.parse keeps it as an own key) is read back through the prototype: 4 stored means the next use is 5. The port wrote a "__proto__" key into the stored JSON, which the web would then misread, and read a stored one as absent. Fixed: TemplateUsageCounts keeps that entry aside (internal protoEntry) as the prototype does. Fixture scripts protoKey and protoStored; protoStored fails on the old code.
- **low**, src/posting/templates/templateUsage.js recordTemplateUse: recordTemplateUse with a finite time past ±8.64e15 ms left lastUsedAt null. No JavaScript Date can hold that time; it is an invalid Date, and the web stamps the present instead. Fixed. Behaviour test aTimeNoJavaScriptDateHoldsStampsNow fails on the old code.
- **low**, all six files: Coverage: the hand-picked fixtures held every branch. I added a seeded random differential fixture, templates.random: 1,262 cases, about 1 MB, covering 27 functions in postTemplates, editorDrafts, templateUsage and templateEditorModel. Its texts mix blanks, names, protected spans, every JS whitespace, case-changing letters (İ ı Σ ς ß ﬁ K ſ ǅ ŉ U+0345), marks, emoji, astral letters and grapheme limits. A 5,500-case version of it passed before trimming. Also added: three keyword cases pinning the \p{M} splitting (web bug below), and a TemplatesModel behaviour test for the hook's PENDING state, where the account changes before the effect runs.
- **low**, ios/parity/cases/templates.*.js (harness): Invisible and combining characters were literal in templates.editorDrafts.js, templates.editorModel.js and templates.templateService.js, despite the porter's escape commit. They are now escapes; the fixtures are byte-identical. _templates.js was also not prettier-formatted (prettier, not eslint); it is formatted now, with fixtures unchanged.
- **low**, src/posting/templates/templateService.js, useTemplates.js: Checked and correct, no change needed. editorHasChanges compares by value (documented; JSONValue has no key order). The service cache writes keys sorted (documented; the iOS and web stores are never shared). The service's load, write and reset sequencing, adopt, the generation checks, primeFromCache, the error helpers and asWriteError match the web. TemplatesModel matches the hook (IDLE/PENDING/primed, effect re-prime, patch only for the open account). The module map's statuses, notes and Swift headers are true, and the synced stamps show no drift.
- **medium** (left as it is), src/posting/templates/postTemplates.js wordsOf/keywordMatches: WEB BUG (visible, not fixed; the port reproduces it). keywordMatches' WORDS regex, /[\p{L}\p{N}](?:[\p{L}\p{N}']*[\p{L}\p{N}])?/gu, has no \p{M}, so a word splits at every combining mark. Examples, confirmed in Node: a keyword typed with a decomposed accent ('élise') matches the text 'e lise' and not 'élise'. Devanagari keywords, whose vowel signs are marks, match their fragments ('नमस्ते' matches 'नमस त'). toLowerCase turns 'İ' into 'i̇', so the keyword 'istanbul' never matches 'İSTANBUL' and 'İstanbul' never matches 'istanbul'. validateTemplate's 'Each word needs a letter or a number' check uses the same words. Cases are in templates.postTemplates.
- **low** (left as it is), src/posting/templates/templateUsage.js sanitize, templateService.js readCache: WEB BUG (not fixed; the port follows). templateUsage.js sanitize does `out[rkey] = …` on a plain object, so a stored "__proto__" entry becomes the counts object's prototype. recordTemplateUse('__proto__') then counts on from it, but never writes it back. The same pattern is in templateService.js readCache/fetchAll: an entry filed under '__proto__' becomes byRkey's prototype. That one is harmless, because '__proto__' fails RKEY_PATTERN. Same class as the plain-object lookups already in WEB-BUGS.md; the fix is Object.create(null) or a Map.
- **low** (left as it is), src/posting/library/templateEditorModel.js signature: WEB BUG reported by the porter, confirmed (not fixed; the port deliberately compares by value). editorHasChanges compares JSON.stringify text. TemplateEditor.jsx:266 builds the attached record as {uri, cid}, but a record read back from the PDS arrives as {cid, uri} (canonical CBOR key order). So re-picking the quoted post asks 'Discard your changes?' when nothing changed.
- **low** (left as it is), src/posting/templates/templateUsage.js sortTemplatesForShelf, templateService.js compareTemplates: WEB BUG reported by the porter, confirmed (not fixed). sortTemplatesForShelf and templateService's compareTemplates call localeCompare(…, undefined, …), which is the browser's locale, not activeLocale(). This is the same pattern as the slotLabel locale bug already in WEB-BUGS.md.
- **low** (left as it is), ios/VirgaKit/Tests/VirgaDefenseTests/ScorerBehaviourTests.swift (not web): Flaky test outside this domain, not changed: VirgaDefenseTests ScorerBehaviour stopsReadingProfilesOnceWhoYouFollowHasFailed failed once in three whole-package runs ('calls.count <= 1'). It is timing-dependent (5 ms sleeps under parallel load), passed 4/4 when run alone, and the whole package passed on the rerun. This is a different flake from the HarvestParity one the porter saw.
