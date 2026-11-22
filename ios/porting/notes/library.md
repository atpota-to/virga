# library: porting notes

A snapshot of what the agent that ported this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported (wave 6, chain B, after the collation step). Not yet audited.

Parity cases at port time: 1,432 (library.model 1,173, library.sources 150, library.ui 63, library.store 46), besides network.publicAppView, which VirgaNetwork already had. library.model's insertText cases each hold seven insertions, and its ITEMS case holds every item the other cases name.
Tests at the time: whole package `swift test` on Linux (Swift 6.4.2) passes (9 test binaries; one earlier run hit the known VirgaDefense ScorerBehaviour timing flake, which passed alone and on the rerun), with no build warnings from the library's files. VirgaPostingTests: 336 tests in 52 suites, 61 of them the library's in 7 suites (LibraryModelParity 14, LibrarySourcesParity 9, LibraryUIParity 6, LibraryStoreParity 6, LibraryStoreBehaviour 13, LibraryModelBehaviour 12, LibraryTypedRows 1). `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity`: 4 files, 151 tests pass. `npx eslint ios`: clean.

## API for the code that builds on it

All in VirgaPosting (`import VirgaPosting`), under ios/VirgaKit/Sources/VirgaPosting/Library/.

CONVENTIONS
- Web names unchanged: model.js is `enum Library` (the hook took the name LibraryModel), sources.js `enum LibrarySources`, libraryUi.js `enum LibraryUI`, store.js `final class LibraryStore` (its pure helpers are statics on it), useLibrary.js `final class LibraryModel`.
- The web's loose objects (post, feed and list views, links, archive rows, templates as the web holds them, the composer's state) are JSONValue, read as the web reads them. Strings compare by code unit (JSKey, jsEquals) and index by UTF-16; regexes are spelled out for ICU (JSRegex).
- Dates: `LibraryClock(now:locale:timeZone:)` stands for the web's `new Date()`, `activeLocale()` and the runtime's zone; nil locale and zone are AppLocale's active ones. Every function that writes a date or a context's `today` takes `clock:` (default `LibraryClock()`).
- Sorting with localeCompare goes through VirgaCore's `JSCollation.localeCompare` (`.base` for names, then plain for rkeys); `Array.prototype.sort` is VirgaNetwork's `JSSort.sort`.
- Network: public reads take `transport: any HTTPTransport = HTTP.transport` and go through VirgaNetwork's PublicAppView (15 s deadline); signed-in reads take an XRPCAgent and ask Bluesky's AppView (`withBlueskyAppView()`). Cancelling the task is the web's abort.

TYPES (Library+Types.swift)
- `LibraryItem` (Codable to the web's object): `id`/`key`, `kind` ('template'|'post'|'link'|'feed'|'list'), `shelf`, `title`, `excerpt`, `label`/`subtitle`, `shortcut`, `reason`, `source: JSONValue?`, `embedView: JSONValue?` (nil unknown, `.string("missing")` gone), `media: LibraryMedia?{thumb, alt}`, `uri`, `cid`, `url`, `view: JSONValue?`, `template: JSONValue?`, `at`, `score: Double?`, `group` (feeds), `quotesOff: Bool?`, `extra`. `init(json:)`, `.json`.
- `LibraryShelf{id,label}`, `LibraryCard{by,title}`, `LibraryLinkSummary{url,title}`, `LibraryCarried{record,link,media}` (attachmentsFromState), `LibraryPreviewPart{text,kind}`, `LibraryPreview{parts,count,overLimit,attachment,replacesAttachment,notes,blocked,usable}`, `LibraryAttachment{kind,uri,cid,view,url,title,description,extra; isLink}`, `LibraryPlan{insertText,attach,template,answers,title,templateRkey; postTemplate}`, `SlashCommand{start,end,query}`, `LibrarySection{id,heading,muted,items}`.
- `LibraryContextInput`: `.template(TemplateContext)` or `.dialog(state:reply:selfHandle:)` (the web's asTemplateContext input); `init(json:)`.
- Insertion results reuse TemplateEditorModel's `TextInsertion{text, caret}`; ranges are `TextSelection` (Int) or `start:end:` Doubles as the web may get them.

MODEL (Library.swift, Library+Suggest.swift, Library+Preview.swift)
- `Library.libraryName`, `libraryShelves`, `shelvesFor(replying:)`, `openingShelf(replying:)`, `missing`, `blockedQuotesOff`.
- Items: `itemFromTemplate(_ JSONValue?|PostTemplate, _ TemplateContext?, embedView:)`, `itemFromPost(_:shelf:selfDid:parentView:clock:)`, `markQuotesOff(_:)`, `itemFromArchiveRow(_ JSONValue?|PostRow, shelf:selfDid:clock:)`, `isOwnThreadRow(_ JSONValue?|PostRow?, _ selfDid)`, `itemFromLink(_:)`, `itemFromFeed(_:group:)`, `itemFromList(_:)`, `postMedia(_:)`, `engagementScore(_:) -> Double`, `isOwnThreadPost(_:)`, `sortItems(_:by:timeZone:)`.
- Suggestions and search: `suggestItems(templates:posts:feeds:lists:parentText:parentUri:limit:)` over items, and a `[JSONValue]` overload that makes bare templates and views into items (`context:selfDid:clock:`); `searchItems(_:_:replying:)`; `dedupeById(_:_ seenIds: [String] | Set<JSKey>)`; `rankTemplatesForSlash(_ [T: TemplateFields]?, parentText:usage: TemplateUsageCounts? | JSONValue?, replying:)`.
- Using an item: `verbFor(_:replying:)`, `effectFor(_:_ context)`, `libraryContext(state:reply:selfHandle:now:locale:timeZone:)` (reply nil = the state's, `.null` = none), `attachmentsFromState(_ state: JSONValue?, _ postIndex)`, `insertText(_:_:_ TextSelection?)` and `insertText(_:_:start:end:)`, `replyTextWithoutSlash(_:_:)`, `previewFor(_:state:postIndex:currentText:insertion:answers:context:attachments:quoteSlotLocked:maxLength:clock:)` (and a `start:end:` form), `applyPlanFor(_:state:context: LibraryContextInput?:answers: JSONValue:quoteSlotLocked:clock:)` (and a `(context: TemplateContext, answers: [String: String])` form), `detectSlashCommand(_:_ caret: Int?)` / `(_:caret: Double?)`.
- isOwnThreadRow: this is the real one. The composer chain keeps a fileprivate copy in Composer/; the merge switches it to `Library.isOwnThreadRow`.

SOURCES (LibrarySources.swift)
- Types: `LibraryPage{items: [JSONValue], cursor, saved}`, `ShelfItems{items, total}`, `LibraryEmbedViews` (the web's Map uri → view | 'missing', by code unit: subscript, `entries`, `merging`, `json`), `ResolvedTemplateLink{embed,title,by,view}`, `LibraryPickError{code 'GONE'|'QUOTES_OFF', message}`, `LibrarySourcesError{message}` ('Not signed in').
- Seams: `FetchLinkCard = @Sendable (String) async throws -> JSONValue?` (publish/linkCard.js's fetchLinkCard, another chain's port; `LibrarySources.noLinkCard` finds none), `OpenArchiveStore = @Sendable (String) async throws -> any AnalyticsStoreHandle`.
- `LibrarySources.readArchivePosts(_:openStore:)`, `archiveShelf(_ rows:did:replies:sort:query:limit:clock:) -> ShelfItems`, `fetchOwnPosts(_:cursor:replies:transport:)`, `fetchBookmarks(_ agent:cursor:limit:)`, `searchPosts(_ agent:_:mine:handle:cursor:)`, `isMediaUrl(_:)`, `fetchRecentLinks(_:cursor:seen:transport:)`, `fetchOwnFeeds`, `savedFeedUris(_:)`, `fetchSavedFeeds(_ agent:transport:)`, `fetchOwnLists`, `quotesTurnedOff(_:selfDid:transport:)`, `hydratePick(_:selfDid:transport:clock:)`, `hydrateAttachment(_:selfDid:transport:)`, `hydrateEmbedViews(_:transport:)`, `resolveHandle` (PublicAppView's), `resolveRecordLink(_:transport:)`, `resolveExternalLink(_:fetchLinkCard:)`, `resolvePastedLink(_:selfDid:transport:fetchLinkCard:clock:)`.
- `protocol LibraryShelfSources: Sendable` (the web's librarySources object: archive, posts, replies, saved, links, feeds, savedFeeds, lists, search, hydrate, hydrateAttachment, hydrateEmbeds, resolveLink) and `LibrarySources.librarySources(did:agent:handle:transport:openStore:fetchLinkCard:clock:) -> AccountLibrarySources`.

STORE (LibraryStore.swift, LibraryStore+Shelves.swift)
- `@MainActor @Observable final class LibraryStore(now: () -> Double ms, staleMs:)`; `LibraryStore.shared` for the app. In memory, as on the web.
- `version` (what views watch), `entry(_ did, _ shelfId) -> LibraryEntry`, `shelves(_:)`, `embeds(_:)`, `subscribe(_:) -> unsubscribe`, `nextOpen()`, `reset(_ did?)`, `ensure(did:shelfId:sources:openId:) -> Task<Void, Never>?` (the load it started), `retry(...) async`, `loadMore(...) async`, `hydrateTemplateEmbeds(did:sources:templates:) async`.
- `LibraryEntry{status, error, data: LibraryEntryData{items, saved}?, cursor, fetchedAt, refreshing, loadingMore, loadMoreError, seq}`, `LibraryEntry.idle`. `LibraryStore.staleMs`, `storeShelves`.
- Pure: `postsSource(_:)`, `buildShelfItems(_ shelfId, entry:archive:did:sort:query:limit:clock:)` (posts and replies: `entry` is the author-feed entry, `archive` the archive's), `templateShelf(_ [PostTemplate]?, usage: TemplateUsageCounts?, ...)` and `(_ [JSONValue]?, usage: JSONValue?, ...)` -> `TemplateShelf{items, sections}`, `remoteQueryFor(_:minChars:)`.

HOOK (LibraryModel.swift)
- `@MainActor protocol LibrarySession: AnyObject, Sendable { libraryAgent(for:) async throws -> XRPCAgent?; libraryHandle(for:) -> String? }`. SessionModel conforms (agentFor, accounts' handles).
- `LibraryEnvironment(transport:openStore:fetchLinkCard:usageStore:now:locale:timeZone:schedule:)`. `LibraryEnvironment.archive(files:registry:)` opens VirgaArchive's store for an account; `liveSchedule` is setTimeout on the main actor (`LibrarySchedule`, `LibraryTimerHandle`).
- `@MainActor @Observable final class LibraryModel(session:templates: TemplatesModel, did:isOpen:reply: JSONValue?:selfHandle:quoteSlotLocked:sources:store: = .shared, environment:)`.
  - Lifetime: `start()` (mount; also starts the TemplatesModel), `setOpen(_:)`, `update(did:reply:selfHandle:quoteSlotLocked:)`, `stop()`.
  - Read: `shelves: [LibraryShelfSummary]`, `items(_ shelfId)`, `templateSections()`, `hasMore(_:)`, `sort`, `postsFrom`, `suggested: LibrarySuggestions{status, items}`, `query`, `mine`, `local`, `localStatus`, `remoteSearch: LibraryRemoteSearch`, `context`, `templateEmbeds`, `replying`, `handle`, `sources`, `openId`, `templates`.
  - Act: `ensure(_:)`, `retry(_:)`, `loadMore(_:)`, `setSort(_:)`, `setQuery(_:)`, `setMine(_:)`, `retrySearch()`, `loadMoreSearch()`, `hydrate(_:) async throws`, `planFor(_:answers:) async throws -> LibraryPlan`, `resolveLink(_:) async throws`.
  - Tests: internal `settled() async` waits for every store read the model started and the ones their landing set off; `searchTask` is the search in flight.

TEST SUPPORT (internal to VirgaPostingTests)
- LibraryParityTests.swift: `libraryNow`, `libraryClock(c)`, `LibraryItems` (resolves `{ $item: name }` against library.model's ITEMS case), `jsText`, `rangeEnds`, `marked`.
- LibrarySourcesParityTests.swift: `FakeArchiveStore`, `fetchLinkCardStandIn(transport)` (a stand-in for linkCard.js as far as the fixtures need it), `libraryOutcome`, `expectLibraryReplay`, `libraryCase`.
- LibraryStoreTests.swift: `FakeShelfSources` (scripted closures, counted calls), `storeView`, `Offline`, `Handoff<Value>`.
- LibraryModelTests.swift: `FakeLibrarySession`, `ManualTimers` (fire the debounce), `hookSources()`.
- Generators: ios/parity/cases/library.{model,sources,ui,store}.js, with shared inputs in _library.js (`onClock` pins `new Date()`, the active locale and the zone).

## Merge work

- Composer: switch its fileprivate isOwnThreadRow to `Library.isOwnThreadRow`; pass its ComposerState to `previewFor`/`attachmentsFromState`/`libraryContext`/`applyPlanFor` as the web's object (`JSONValue(encoding:)`), or add overloads over the Swift type.
- Wire `FetchLinkCard` to the composer chain's linkCard port (`{ url in try await LinkCard.fetchLinkCard(url, ...) }`, whatever its name), in LibraryEnvironment.
- App: one `LibraryStore.shared`; the session's sign-out and account removal should call `LibraryStore.shared.reset()` / `reset(did)` as the web does. Build LibraryEnvironment with `archive(files: appFileStore)`, the app's UserDefaultsKeyValueStore as `usageStore`, and HTTP.transport.

## Known gaps and deliberate differences

- store.js keeps the library in memory, not IndexedDB or localStorage (the brief said otherwise); the port does the same, so nothing is persisted and no record shapes or keys apply.
- A non-string uri, cid, url, at or cursor is kept as its String form (the web keeps the value). Lexicon-valid answers never hit this; fixtures keep such inputs out except where the outcome is the same.
- previewFor's `context: nil` is the web's undefined; a null context beside a state isn't told apart.
- hydrateEmbedViews lists posts, then feeds, then lists, where the web's Map follows the answers' order; the feeds shelf's first page reports the feeds read's error when both of its reads fail (the web: whichever fails first).
- The hook's render timing is approximated: its effects run after each prop change, store emit and template service change, when their dependencies moved; the reply's suggestions are frozen at the first read or change after their sources settle. A template load that fails (which the service doesn't announce) is seen at the next read.
- The WORDS and letter regexes (`\p{L}`, `\p{N}`) run on ICU's Unicode tables, as the templates port's do; a letter newer than the platform's ICU would split differently.
- The collation is VirgaCore's JSCollation (root order whatever the locale; see core.md).

## Audit of the localeCompare consolidation (this step)

- rankTemplatesForSlash is the library's use (`.base` for names, then plain for rkeys, through JSSort). The fixture holds names that tie only at the base level (émile/Emile/emile, Zoë/zoe, Ångström/angstrom, résumé/resume), empty names and Han, and passes.
- A scratch differential run (not committed) of 40,000 random template-name pairs (ASCII, punctuation, precomposed and combining accents, ß/ẞ, ligatures, full-width, dotless and dotted i, final sigma, Cyrillic, Han, kana, Hangul, emoji with ZWJ, soft hyphen, zero-width space, titlecase digraphs; a third upper-cased, a third NFD) against Node at both strengths: 0 differences.
- The table is a lazily initialised `static let` (thread-safe), and `locale` is unused because every app locale collates in root order; nothing to change.

## Web bugs noticed (not fixed; the port keeps the web's behaviour)

- low, src/posting/library/model.js isOwnThreadRow vs isOwnThreadPost: an archive row is on Your posts when its parent is the account's (`replyTo`), but the author-feed fallback needs both the root and the parent to be the account's. So a reply to your own comment inside someone else's thread is on Your posts from the archive and on Your replies from the author feed. Archive rows carry `threadOf` (the root's author), which could make the two agree.
- low, src/posting/library/useLibrary.js, model.js libraryContext/asTemplateContext, libraryUi.js templateContextFrom: none passes a locale to buildTemplateContext, so `{{today}}` in a template used from the library is written in the browser's locale, while the library's post dates use activeLocale(). Same pattern as the slotLabel and sortTemplatesForShelf locale bugs.
- low, src/posting/library/model.js rankTemplatesForSlash: localeCompare(…, undefined, { sensitivity: 'base' }) sorts in the browser's locale, not activeLocale() (as templateUsage.js does).
- low, src/posting/library/model.js suggestItems (`OVERLAP_NEEDED[item?.kind]`) and attachmentsFromState (`{ post: 'Post', … }[kind] || 'Post'`): plain-object lookups. An item whose kind is an Object.prototype name ('toString', 'constructor', '__proto__') is counted as a candidate (it moves the "common" words) though it can never be suggested, and a record kind 'constructor' would be titled "function Object() { [native code] } by @…". Unreachable with the shelves' own items; same class as the plain-object lookups in WEB-BUGS.md.
