# demo-world: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited. The world in an earlier wave; the demo network on 2026-11-21 and the rest of the demo's server on 2026-11-22 (the last two sections, which supersede this file's earlier remarks that those routes answer 503).
Parity cases at port time: 1434, plus 124 added by the audit.
Tests at the time: Whole package: swift test passes, 534 tests (57+116+1+79+69+77+134+1 across the test binaries), no failures. VirgaDemoTests: 69 tests in 9 suites (62 before; added liveCountsInEveryZone, aWrittenPostsViewInEveryZone, theCachesAcrossWrites and the HarnessParity suite of 4). PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 75 passed. npx eslint ios: clean. Prettier: clean. The only build warning is SwiftPM's 'found 1 file(s) which are unhandled' for VirgaDemo/README.md, which needs a Package.swift exclude.

## API for the code that builds on it

All code is in target VirgaDemo, ios/VirgaKit/Sources/VirgaDemo/. The mapping table is in README.md in that folder.

START HERE: DemoWorld.swift
- `public final class DemoWorld: Sendable`. The worlds sit behind a VirgaCore `Locked`, so it is safe from any task and readable synchronously from previews.
- Constructors:
  - `init(now: Double, accounts: [WorldAccount] = [World.me, World.lab], scope: String = Harness.defaultScope, timeZone: TimeZone = .gmt)`. `now` is epoch ms. It builds each world as createHarness does, setting `world.scope = scope` and `world.pdsUrl = World.pds`.
  - `init(now: Date, accounts:scope:timeZone:)` (cuts to whole ms).
  - `init(worlds: [AccountWorld], scope: String = Harness.defaultScope, timeZone: TimeZone = .gmt)`. It keeps the worlds as given; `scope` is only grantOf's fallback.
- Previews: `static let previewNow: Double = 1_794_700_000_000` and `static let preview` (one shared instance; what one preview writes, the next sees).
- Reads:
  - `let now`, `let scope` (the flags' granted scope), `let timeZone` (where a written time without an offset is read; the web's browser zone).
  - `var worlds: [AccountWorld]`, `func world(_ did: String) -> AccountWorld?` (first match, as worldOf).
  - `var views: DemoViews` and `var crowd: DemoCrowd` are snapshots over the current worlds; read them again after a write.
- Grants:
  - `func grantOf(_ did: String) -> String` gives the world's scope, or `scope`.
  - `func regrant(_ did: String, defense: Harness.DefenseLevel) throws -> String` sets `world.scope = withDefense(world.scope, defense)` and answers it. It throws `DemoWorldError.noAccount(did)`.
- Writes:
  - `func update<R>(_ did: String, _ body: (inout AccountWorld) throws -> R) throws -> R` throws `DemoWorldError.noAccount(did)`, whose message is \"harness: no account <did>\" (createHarness's word for word).
  - `writeRecord(did:collection:rkey:record:createOnly:now:) throws -> HarnessRepo.WriteResult`.
  - `removeRecord(did:collection:rkey:) throws -> Bool`.
  - `storeBlob(did:bytes:mimeType:) throws -> JSONValue` (answers the blob ref).
- `repoCar(did:) throws -> [UInt8]` is rebuilt only when `world.revision` changes, as fakeNetwork's carFor does.
- One crowd and one views index per DemoWorld, shared by every reader. The web makes one per consumer (fakeNetwork, each agent, fakeServer), so their first sights of a world can differ.

HARNESS: Harness/Harness.swift (`enum Harness`, ports harness/harness.js in part)
- `readOnlyScope` (READ_ONLY_SCOPE).
- `enum DefenseLevel { none, scan, lists }`: the web's false, true or 'scan', and 'lists'.
- `withDefense(_ scope: String?, _ level: DefenseLevel) -> String`.
- `grantedScope(scope: String?, defense: String?) -> String` is readFlags' `scope`: \"read\" starts from readOnlyScope, defense \"on\" gives .scan and \"lists\" gives .lists, compared exactly.
- `defaultScope` (equals AppConfig.oauthScope).
- Not ported: readFlags' other flags, createServer, agentFor, install, window.__harness.

WORLD: Harness/World.swift, World+Types.swift, World+Posting.swift
- `enum World`:
  - Constants: `me`, `lab` (both `WorldAccount`), `pds`.
  - `mulberry(_ seed: Double) -> Mulberry` (a struct; call `rand()`).
  - `tidAt(_ ms: Double, _ clock: Double = 0) throws -> String` throws `HarnessJSError` (RangeError) for a time that isn't finite. Internal `World.tid(ms, Int)` is the non-throwing form.
  - `buildCast() -> [WorldPerson]`, `hashOf(_ text: String) -> Int` (UInt32 range), `activityOf(_ did:) -> WorldActivity` (`.daysAgo(Int)`, `.gone`, `.never`).
  - `buildWorld(now: Double, seed: Double? = nil, account: WorldAccount = me) -> AccountWorld`. Any account other than `me` gets a quiet world. scope and pdsUrl are nil here; DemoWorld sets them.
  - `postRecord(_ post: WorldPost) -> JSONValue` and `repoRecords(_ world:) -> [(key: String, value: JSONValue)]`.
  - Internal: `World.iso(ms)` (preconditions a valid Date).
- `AccountWorld` (Codable, Hashable, Sendable) keeps the web's field names:
  - `me`, `now`, `start`, `profile`, `cast`, `followedOnly`, `posts`, `followers`, `follows`, `notifications`, `likes`, `reposts`, `blockers`, `lists`, `others`, `feeds`, `ownLists`.
  - `preferences: [JSONValue]`, `drafts`, `bookmarks`.
  - `written: JSOrderedMap<WorldWritten>`, `removed: JSOrderedSet`, `blobs: JSOrderedMap<WorldBlob>`, `revision: Int`.
  - `scope: String?` and `pdsUrl: String?`.
- Part types: WorldAccount, WorldPerson, WorldProfile, WorldPost, WorldThread, WorldFollower, WorldRecordRow {uri, cid?, value: JSONValue}, WorldNotification, WorldBacklink, WorldList, WorldOtherRecord, WorldFeed, WorldOwnList, WorldDraft {id, draft: JSONValue, createdAt, updatedAt}, WorldBookmark, WorldWritten {value, cid}, WorldBlob {bytes, mimeType?, size}.
- `WorldPost.fixture` (`.busy` for Mira's posts, `.quiet` for Field Lab's, nil for a written post) decides which keys it encodes, nulls included, so it matches the web object.
- `JSOrderedMap` and `JSOrderedSet` are public, in Support/JSText.swift: JS Map/Set semantics with code-unit keys.

REPO: Harness/Repo.swift (`enum HarnessRepo`)
- `keyOf`, `parseAtUri(_ uri: String?) -> ParsedAtUri?`.
- `XrpcError(status, error, message)`: `.name` is \"XRPCError\"; `errorDescription` is the message.
- `Row` {uri, cid, value}, `WriteResult` {uri, cid, created}.
- `listCollection(_ world, _ collection) throws -> [Row]` (newest first; the web's per-revision cache isn't kept, and no caller mutates the result, so the rows are the same) and `readRecord(_ world, _ collection, _ rkey) throws -> Row?`.
- `writeRecord(_ world: inout AccountWorld, collection: String?, rkey: String?, record: JSONValue?, createOnly: Bool = false, now: Double) throws -> WriteResult` computes the CID with VirgaRepo's `RecordCid`.
- `removeRecord(_ world: inout, _ collection, _ rkey) throws -> Bool`.
- `storeBlob(_ world: inout, _ bytes: [UInt8], mimeType: String?) -> JSONValue`, `readBlob(_:_:) -> WorldBlob?`, `blobDataUrl(_:_:maxBytes: = 2_000_000) -> String?`.
- Thrown errors are `HarnessRepo.XrpcError` or `HarnessJSError` (TypeError for collection names that are keys of Object.prototype). Map them to HTTP answers as fakeXrpc does.

VIEWS: Harness/Views.swift (`enum Views`) and `struct DemoViews: Sendable`
- `Views`:
  - `pageOf(_ all: [Row], limit: JSONValue?, cursor: JSONValue?) -> Views.Page<Row>` takes raw query-string values; nil means absent. `Page` has `rows` and `cursor: String?`. There is also an Int/String overload.
  - `tidTime(_ rkey: String?) -> Double?`.
  - `liveCounts(_ post:, now:, timeZone: = .gmt) -> LiveCounts` (Doubles; NaN encodes as null).
  - `createViews(_ worlds:, timeZone: TimeZone = .gmt) -> DemoViews`.
- `DemoViews`:
  - `worlds`, `timeZone`, `with(worlds:)` (same people index, crowd caches and zone over changed worlds), `crowd`, `world(_ did)` (last match, as byDid).
  - `card(_ did) -> JSONValue`, `person(_ actor: String?) -> JSONValue?`, `resolveHandle(_:) -> String?`.
  - `postView(_ uri: String?, now: Double, depth: Int = 0) throws -> JSONValue?`.
  - `embedView(_ embed: JSONValue?, did: String, depth: Int = 1, now: Double) throws -> JSONValue?`.
  - `authorFeed(_ world:, now:) throws -> [JSONValue]` (feed items).
  - `threadView(_ uri: String, depth: Int = 6, parentHeight: Int = 80, now:) throws -> JSONValue?`.
  - `generatorView(_ uri: String?) -> JSONValue?`, `listView(_ uri: String?, now:) -> JSONValue?`, `listMembers(_ uri:) -> [JSONValue]`.
  - `searchPosts(_ q: String?, now:) throws -> [JSONValue]`, `searchActors(_ q: String?, limit: JSONValue? = nil) -> [JSONValue]`.
  - Views are JSONValue in the harness's exact shapes, ready to serve as response bodies. They throw `HarnessJSError` TypeErrors only for malformed embeds, as the web does.
- Views+Models.swift has typed accessors: `DemoViews.decode(_:as:)`, `profileModel(_:) -> ProfileViewDetailed?`, `postModel(_:now:) -> PostView?`, `postModels(_ world:now:)`, `threadModel(_:now:) -> ThreadViewPost?`, `generatorModel(_:)`, `listModel(_:now:)`, and `AccountWorld.notificationModels`. The reposted items in authorFeed don't fit PostView (no indexedAt); keep those as JSON.

CROWD: Harness/Crowd.swift
- `enum Crowd`: `castFollows(_:_:) -> Bool`, `createCrowd(_ worlds:) -> DemoCrowd`.
- `struct DemoCrowd: Sendable`:
  - `worlds`, `with(worlds:)`, `strangers: [CrowdStranger]`, `stranger(_ did) -> CrowdStranger?`.
  - `profile(_ did) -> JSONValue?`, `profileAs(_ viewer: AccountWorld, _ did: String, card: JSONValue? = nil) -> JSONValue?`, `relationship(_ actorWorld:, _ did:) -> JSONValue`, `knownCount(_ viewer:, _ did:) -> Int`.
  - `engagersOf(_ uri:) -> CrowdEngagers` {like, repost, reply, threadReply, quote: [String]}.
- The caches are the web's and are shared by every copy. viewerOf keeps an account's follows as first seen; engagersOf is kept per URI; knownCount reads the live follows. demo-world.crowd's afterWrites scenario holds this. One extra cache, each world's fans (followers outside the cast), assumes followers never change, which holds for the harness.

CAR AND PNG
- `BuildCar.buildRepoCar(_ did: String, _ records: [(key: String, value: JSONValue)], rev: String = \"3mharnessrev22\") throws -> [UInt8]`.
- `PNG.encodePng(_ width: Int, _ height: Int, _ pixel: (Int, Int) -> (Double, Double, Double)) -> [UInt8]`.
- `PNG.cardImage(_ seed: Double, width: Int = 600, height: Int = 315) -> [UInt8]`. For the fake card service, use `cardImage(Double(World.hashOf(key)))`, as fakeNetwork does.

INTERNAL V8 SEMANTICS (module-internal; reuse inside VirgaDemo)
- `JSMath.pow/sin/toInt32/toUint8/min/max` (V8's fdlibm; Node 22's V8 has no libm-trig switch, and CI pins Node 22 via .nvmrc).
- `Array.jsSorted(by: (E, E) -> Double)` and `jsSort` (V8's TimSort, checked against array-sort.tq; use it for any harness sort whose comparator never returns 0).
- In JSText.swift: `String.jsLess`, `jsSplit`, `jsHasPrefix`, `jsContains`, `jsReplacingFirst`, `String.zeroPadded`, `JSArray.slice`, `JSONValue.jsSpread`, `JSONValue.jsNumber(Double)`, and `Optional<JSONValue>.jsTruthy`.
- Pitfall: write `x || y` as `x.jsTruthy ?? y`, never as `flatMap { $0.isTruthy ? $0 : nil }`. There the `nil` becomes JSONValue's nil literal, `.null`, so nothing falls back.
- `HarnessJSError` {name, message} is public.

CONVENTIONS
- Pass `now` (epoch ms) wherever the web reads the clock, and a `timeZone` wherever it reads local time.
- Strings compare by code unit.
- Every Swift file that ports harness code starts with a `// Ports harness/<file>` line.
- Deep JSON: an 80-parent thread nests about 170 levels; serialize large threads iteratively on iOS (512 KB thread stacks).

TEST SUPPORT
- `ios/VirgaKit/Tests/VirgaTestSupport/CanonicalJSON.swift` (public): `CanonicalJSON.text`, `sha256(_:)`, `sha256(bytes:)`, `part(_:)`, `part(encoding:)`, `sampleIndexes`, `wholeLimit`. It is iterative and is the Swift side of `ios/parity/cases/_canonical.js` (canonical, sha256, sha256Bytes, part).
- `ios/parity/cases/_demoWorld.js`: NOW, SOMEONE, accountOf, worldFor, worldDigest, `atTime(ms, fn)` (fakes Date with vitest), `thrown(error)`.
- `Tests/VirgaDemoTests/DemoWorldSupport.swift`: `DemoFixtures` (now, account, world, json, digest), `Exact.diff` (iterative, bit-exact numbers, strict nulls), `ParityCase.number(_:)`.
- Fixtures: demo-world.{world, jsmath, crowd, repo, views, buildCar, png, harness}.
- For wave 3's recorded-fetch parity, build DemoWorld at `DemoFixtures.now` (1794700000000) to match the generators' worlds. createHarness's worlds equal `DemoWorld(now:accounts:scope: Harness.grantedScope(scope:defense:))`.

## Known gaps and deliberate differences

- fakeXrpc.js, the fakeNetwork.js routes, fakeServer.js, fakeDefense.js and fakeSession.jsx are not ported: they need VirgaNetwork (HTTPTransport, MockTransport, XRPC, VirgaBackend) and VirgaSession, which aren't in this base. Of harness.js, readFlags' other flags (mode, signedout, expired, appview, defensewrites, moderator, limits, ailimits, ai, terms, cron, latency, now), createServer, agentFor, install and window.__harness remain for wave 3.
- World.iso stops the program for a NaN or out-of-range now, where the web throws RangeError 'Invalid time value'.
- A DemoWorld shares one crowd among all readers, where the web makes one per consumer (fakeNetwork, each agent, fakeServer); the two differ only if a world changes between those consumers' first reads.
- CrowdCore.fansOf assumes followers never change: true for the harness, not enforced for DemoWorld.update.
- JSOrderedMap decoded from JSON doesn't keep key order (Codable gives none); encoding does.
- VirgaDemo/README.md makes SwiftPM warn on every build; exclude: ["README.md"] on the VirgaDemo target in Package.swift would silence it (Package.swift was off limits).
- CAR keys that aren't ASCII are held to the web byte for byte but not round-tripped through VirgaRepo's reader, because the web's UTF-16 prefix compression is off-spec.
- A deep thread's JSON (an 80-parent chain nests about 170 levels): encoding it with JSONEncoder on a 512 KB iOS thread can overflow; wave 3 should serialize thread responses iteratively.

## What the audit found and fixed

- medium (fixed) harness/views.js liveCounts, ownView: DemoViews always read a written post's createdAt in UTC, and nothing could change it. The web parses it with Date.parse, which reads a time without an offset in the browser's zone, so a post's live counts (likeCount, repostCount, replyCount, quoteCount in postView, authorFeed, searchPosts, threadView) depended on a zone the port couldn't be given. Views.liveCounts took a zone, but no fixture ran it outside UTC. Fixed: DemoViews.timeZone, Views.createViews(_:timeZone:) and DemoWorld(…, timeZone:), all UTC by default. New cases liveCounts-zoned (45: five zones, across New York's spring gap and autumn overlap, date-only, Z, +05:30 and legacy forms) and postView-zoned (5, through DemoWorld) in demo-world.views.
- medium (fixed) harness/harness.js createHarness, withDefense, READ_ONLY_SCOPE, grantOf, regrant: createHarness sets world.scope (the flags' granted scope) and world.pdsUrl = PDS on every world it builds; the fake server and agents read them back. The port's AccountWorld had both fields, but nothing ever set them. harness.js's READ_ONLY_SCOPE, withDefense, grantOf and regrant were missing too. Fixed: Harness/Harness.swift (readOnlyScope, DefenseLevel, withDefense, grantedScope(scope:defense:) for readFlags' scope, defaultScope, all on VirgaCore's AppConfig tokens). DemoWorld(now:accounts:scope:timeZone:) now sets scope and pdsUrl as createHarness does, and DemoWorld gains grantOf and regrant. New fixture demo-world.harness: withDefense over 8 scopes × 8 levels, and createHarness worlds, grants and regrants (including the 'harness: no account' refusal) for 8 sets of address flags. harness.js stays partial and is stamped c4768f342f72.
- low (fixed) harness/crowd.js createCrowd (viewerOf, engagersOf, knownCount): No fixture held the crowd's cache behaviour once the worlds change. The web keeps whom an account follows as the crowd first saw them (viewerOf) and keeps each post's engagers once worked out, but reads live follows for knownCount. The port was already right. New afterWrites scenario: follow two people, unfollow one, delete two posts, then ask the old crowd and a fresh one. Swift replays it through DemoWorld and matches: knownFollowers but no `following` for a new follow, `following` kept for a dropped one, a deleted post's 43 likers kept.
- low (open) harness/world.js buildWorld (new Date(x).toISOString()): World.iso stops the program (preconditionFailure) where the web throws RangeError 'Invalid time value'. That only happens for a now that is NaN or outside the range a Date can hold, passed to buildWorld, writeRecord or listView, or for a crowd over no worlds. Left as is and documented; making every builder throw would ripple through the API for inputs that are preconditions.
- low (open) harness/fakeNetwork.js createRouter, harness/fakeXrpc.js createFakeAgent (createViews per consumer): The web makes one crowd and views per consumer: fakeNetwork, each fakeXrpc agent and fakeServer each call createViews, so each can first see a world at a different time. A DemoWorld has one crowd shared by every reader. That is equal unless a world changes between the consumers' first reads. Documented in README.md for whoever builds the fake network.
- low (open) harness/crowd.js engagersOf (fans): CrowdCore.fansOf caches each world's followers outside the cast by DID. The web filters world.followers live. The harness never changes followers (followerChurn keeps its own list), so the output is the same. But a caller that edits followers through DemoWorld.update wouldn't see the change in engager picks. Kept for speed and documented.
- low (open) harness/world.js buildCast: Web bug, confirmed (not fixed; the web is the reference): buildCast tests i > FIRST.length where it should be >=, so cast[30] gets cast[0]'s handle ana.example.com, and byHandle resolves ana.example.com to cast[30].
- low (open) harness/repo.js listCollection, writeRecord, removeRecord: Web bug, confirmed: ARRAYS[collection] also finds Object.prototype keys. listCollection, readRecord and writeRecord for 'toString' or '__proto__' throw 'world[ARRAYS[collection]] is not iterable'; removeRecord throws "Cannot read properties of undefined (reading 'length')". The port reproduces both.
- low (open) harness/buildCar.js buildRepoCar: Web bug, confirmed: the MST key prefix is counted in UTF-16 code units, not UTF-8 bytes as the spec says, so a CAR with non-ASCII keys decodes to different keys in a reader that follows the spec. The port matches the web byte for byte.
- low (open) harness/views.js embedView, placeholderImage, recordView, threadView, listView: Web bugs, confirmed in views.js. A truthy images or items value that isn't an array throws '(embed.images || []).map is not a function', and a non-empty array $link throws 'text.charCodeAt is not a function'. recordView, threadView and listView drop the caller's now and read Date.now(). threadView has no cycle check (a self-parent climbs all 80 levels).

## The demo network (2026-11-21): the fake agent, router, server routes and DemoSession

Parity cases at port time: 426, plus 43 added by the audit.
Tests at the time: All in /home/user/virga/.worktrees/w5-c on ios/w5-c, 4 audit commits: 9a2a5bb, 59625c5, 5834f34, a30c3be. Whole package swift test: 1138 tests in 9 test binaries (194+57+190+99+79+140+77+176+126). Every target passes except VirgaArchiveTests' ArchiveModelBehaviour, which flaked under CPU load (one or two of its 126 tests per full run, a different test each time). That target passed 6/6 solo runs, and none of its sources or tests are touched here. VirgaDemoTests: 140 tests in 24 suites, all passing. FakeXrpcParity, FakeServerParity, FakeNetworkParity and HarnessFlagsParity carry the new cases. Running the new agent cases against the porter's original Swift sources fails, as it should. PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 124 passed (4 files). npx eslint ios: clean. Prettier: clean on the demo-network generators. Fixtures are all under 1 MB: fakeXrpc 300 KB, fakeNetwork 254 KB, harness 220 KB, fakeServer 110 KB. New parity cases: 4 agent scenarios (drafts, odd-inputs, odd-profiles, default-scope; about 90 steps), 14 forwardedQuery cases, 25 readFlags cases, plus 11 steps in the forward cases (10 in 'full', 1 in 'read-only') and 34 requests in the router's 'reads' replay.

### API for the code that builds on it

All in target VirgaDemo (import VirgaDemo), ios/VirgaKit/Sources/VirgaDemo/Harness/.

START: DemoSession (FakeSession.swift), @MainActor final class:
- init(options: DemoOptions = DemoOptions(), clock: NetworkClock = .live, timeZone: TimeZone = .gmt, storage: any KeyValueStore = InMemoryKeyValueStore(), tabStorage: any KeyValueStore = InMemoryKeyValueStore(), secrets: any SecretStore = InMemorySecretStore(), randomBytes: (@Sendable (Int) -> [UInt8])? = nil). Mira's follower sweeps are counted in `storage` under FakeXrpc.sweepCountKey, as the web counts them in localStorage.
- start() async (= model.start()).
- Properties:
  - model: SessionModel
  - environment: SessionEnvironment (backendUrl FakeServer.serverOrigin, transport, DemoAuthenticator, getProfile/resolvePdsUrl/rememberPdsUrl over the demo network)
  - transport: DemoTransport, harness: DemoHarness, world: DemoWorld, server: DemoServer
  - didDocuments: PromiseCache<JSONValue>, pdsResolver: PDSResolver
  - storage, tabStorage, secrets, clock, timeZone
- archiveEnvironment(files: (any FileStore)?, registry: = AnalyticsStoreRegistry(), locale: String? = nil) -> ArchiveEnvironment. ArchiveModel(agent: session.model.agent, did:, handle:, environment: session.archiveEnvironment(files:)) builds Mira's whole archive (tested end to end).
- expire(_ handle:) / refuse(_ handle:) -> Bool (window.__harness).
- VirgaUI wiring for the merge: AppModel.demo (VirgaUI/App/AppModel.swift) still uses its own MockTransport stub.
  - Replace it with DemoSession(options: .read(<launch string>), storage: stores.keyValue, tabStorage: stores.tab, secrets: stores.secrets).
  - Use session.environment, session.transport (reporterTransport), and session.world.views.person for fetchProfile.
  - Launch flags: -VirgaDemoTerms YES = "?terms=ask", -VirgaDemoSignedOut YES = "?signedout".

DemoOptions (struct):
- Fields: accounts [WorldAccount], signedOut, expired: String?, scope, terms ('agreed'|'ask'|'down'), latency (ms), now: Double?, appview.
- init(flags:), static read(_ search: String) (a launch string in the web's address form, read by readFlags), var flags: HarnessFlags (mode is always 'backend'), expiredAtStart(_:).

Harness+Flags.swift:
- struct HarnessFlags: Codable {accounts, mode, signedOut, expired, scope, appview, defenseWrites, moderator, limits: Limits{scheduledPosts, postTimers, conditionalTimers: Double?}, aiLimits: AILimits{adviser, altText, style: Double?}, ai, terms, cronSeconds, latency, now}. Encodes as readFlags' JSON.
- Harness.readFlags(_ search: String) -> HarnessFlags; Harness.readLimits(_:), Harness.readAiLimits(_:).
- final class DemoHarness(flags:, now: Double? = nil, clock: = .live, timeZone: = .gmt, sweepCounter: FakeXrpc.SweepCounter? = nil, randomBytes: = nil, tids: TIDClock = .shared):
  - flags, world, server, clock, worlds, worldOf(_:), grantOf(_:)
  - regrant(_:defense:) throws
  - agentFor(_:) throws -> FakeAgent: one per account, each reading its world's grant at every call, as agentFor's `scope: () => world.scope` does.
  - transport(latency:videoProcessingMs:) -> DemoTransport
  - install(latency:): sets HTTP.transport and HTTP.clock
  - expire(_ handle:), refuse(_ handle:)

FakeXrpc.swift / FakeXrpc+Methods.swift:
- enum FakeXrpc:
  - Constants: draftLimit, appviewAud, appviewProxy, appviewOnly, repoWrites, publicRepoReads, methods.
  - scopesFor(_ nsid: String, _ input: JSONValue?, _ opts: JSONValue? = nil) throws -> [String].
  - mintServiceToken(iss:aud:lxm:exp: JSONValue?) throws, or (iss: String, aud: String, lxm: String?, exp: Double) throws -> String; readServiceToken(_ token: String?) -> JSONValue?.
  - struct SweepCounter{next: () -> Double}; sweepCountKey; localStorageCounter(_ KeyValueStore?, key:); memoryCounter(start:).
  - enum Input {.none, .json(JSONValue), .bytes([UInt8])}; struct Answer {success, headers, data}.
  - Internal: objectPrototypeKeys and objectPrototypeAnswer. An NSID named after a key of Object.prototype is answered as the web's plain methods object answers it.
- final class FakeAgent(world: DemoWorld, did:, latency: = 0, scope: (@Sendable () -> String?)? = nil, appview: = "ok", sweepCounter: = memoryCounter(), clock: = .live, tids: = .shared):
  - CHANGED: the default scope is now AppConfig.oauthScope, as createFakeAgent's OAUTH_SCOPE. Pass `scope: { world.world(did)?.scope }` (or world.grantOf) to read the world's grant.
  - did, proxy, world; withProxy(_ serviceType:, _ aud:) -> FakeAgent.
  - handle(_ nsid:, _ input: Input = .none, _ opts: JSONValue? = nil) async throws -> Answer; handle(_ nsid:, _ params: JSONValue, _ opts:); xrpcAgent() -> XRPCAgent.
  - Errors: HarnessRepo.XrpcError(status, error, message), HarnessJSError (the web's TypeErrors, e.g. 'author.startsWith is not a function' for a non-string searchPosts author), CancellationError.
- struct FakeXrpcFetchHandler: XRPCFetchHandler(agent:).
  - Queries are read with FakeServer.forwardedQuery; POST bodies are JSON; an uploadBlob sends its bytes and content-type; the atproto-proxy header becomes withProxy.
- CHANGED in World+Types.swift: WorldDraft.draft is now `JSONValue?`. It is nil, and left out when encoded, after an updateDraft that sent no draft, as the web's undefined.

FakeNetwork.swift:
- enum FakeNetwork: cards, cardFor(_ href:) throws -> JSONValue.
- final class DemoRouter(world:, server: DemoServer? = nil, now: @Sendable () -> Double, videoProcessingMs: = 4000): route(_ HTTPRequest) async throws -> HTTPResponse? (nil means a host it doesn't route).
- final class DemoTransport: HTTPTransport.
  - init(router:latency:clock:) or (world:server:latency: = 60, clock:, videoProcessingMs:).
  - router, latency, world, refused: [HTTPRequest].
  - send waits `latency`, except for proxy and upload-blob calls, which wait the agent's own latency (writes ×4). Outside hosts throw HTTPTransportError.network("harness: no fixture for <host>").

FakeServer.swift / FakeServer+SignIn.swift:
- enum FakeServer:
  - serverOrigin ("https://server.harness.invalid"), defaultAiLimits, laterRoutes [(method, path, area)], laterWords(_:).
  - NEW blueskyAppviewProxy ("did:web:api.bsky.app#bsky_appview").
  - booleanParams/numericParams/arrayParams/binaryOutput.
  - forwardedQuery(_ pairs: [(String, String)]) -> JSONValue. It now reproduces the real server's `key in params` bug: a key of Object.prototype gives [null, value]; `__proto__` sets an array prototype, so `reverse` becomes false and length, indexes and Array.prototype names become arrays.
  - isSafeXrpcMethod(_:), httpStatusForXrpcError(_ status: Int?), bearer(_ header:).
- struct ServerAnswer {status, body: JSONValue?}; struct TermsAgreement (a snake_case ledger row).
- final class DemoServer(world:, terms: = "agreed", now:, randomBytes: = system, agents: (@Sendable (String) throws -> FakeAgent)? = nil):
  - The default agents read their world's grant.
  - mintToken(_:) -> "vg_<64 hex>", signOutToken(_:keepGrant:) -> (found, grantRevoked), expireAccount(_:), refuseGrant(_:).
  - handle(method:path:query:headers:body:raw:) async -> ServerAnswer; route(_ HTTPRequest, origin:) async -> HTTPResponse?.
  - tokens, agreements, log, accountFor(_ input:) -> WorldAccount?.
  - authorize(_ authUrl:) throws -> String: mints a token, regrants to the requested Defense level, returns `<redirect>#session=…&did=…`. static authorizePath.
  - CHANGED: /api/oauth/proxy now retries a failed read once through Bluesky's AppView, as proxy.js does. That applies to a GET sent through another X-Atproto-Proxy that failed with no status, a 5xx or the SDK's InvalidResponse (2).
- struct DemoAuthenticator: WebAuthenticator(server:, clock: = .live, delayMs: = 500).

CONVENTIONS: times are epoch ms Double from the injected clock (no Date.now in logic). Strings compare by code unit. The iOS proxy answers in the real server's envelope, so XRPCAgent over BackendFetchHandler sees XRPCError(status, error: the lexicon name or server code, message), as from a PDS.

TEST SUPPORT:
- Swift: Tests/VirgaDemoTests/DemoNetworkSupport.swift has DemoNetwork.shrink/answerOf/request/thrown/outcome/toJSON/world(search), and RepeatableBytes (= _demoNetwork.js repeatableRandom).
- JS side: ios/parity/cases/_demoNetwork.js (worldsFor, shrink, outcome, answerOf, withRepeatableRandom).
- Agent scenario steps can now name a minted draft with `draftId: n` (put at `draft.id` with `idAt: 'draft'`, else at `id`).
- A scenario's `defaultScope: true` makes its agent without a scope.

### Known gaps and deliberate differences

- harness/fakeDefense.js and the rest of harness/fakeServer.js are still pending, as the brief scheduled: scheduling, timers, limits, the AI routes, the workers runCron/runSchedule/runTimers, the seeded rows and analyzePost. Those routes check the token and answer 503 UNAVAILABLE with '<area> isn't in the demo's server yet.'. harness.js's cron/stopCron wait on them. The README's table records each harness file (stamps unchanged and still matching: fakeXrpc 4bc064331a95, fakeNetwork c66ed1161cbf, fakeServer 8c31068cdf24, fakeSession 545496123ba3, harness c4768f342f72).
- Deliberate iOS additions and differences that remain: the iOS proxy forwards a usable grant's call to the account's FakeAgent and answers as proxy.js and uploadBlob.js do (the web fake answers 501). /api/oauth/login, DemoServer.authorize and DemoAuthenticator are additions. A sign-in that names no Defense level grants the scope without Defense, as the real server's scopeFor does, while fakeSession.jsx keeps the grant. mode=browser is read but not applied (iOS has long sessions only). The proxy's refusals follow the web fake's order (token, then grant) rather than the real server's (method header first).
- One crowd and views index per DemoWorld is shared by the router, every agent and the server, where the web makes one per consumer (see the demo-world notes).
- VirgaUI's AppModel.demo still runs its own MockTransport stub. Swapping in DemoSession is a VirgaUI change outside this domain; the wiring is in apiForDownstream.
- Open, low and unreachable from the app: createBookmark/deleteBookmark with a missing or non-string uri (never granted under any harness flag), the key order of an object aud in a service token, inherited-function params read as null, and 'constructor' with primitive input left out of the fixture because of the toJSON wrapper artefact.
- Pre-existing flaky timing in VirgaArchiveTests ArchiveModelBehaviour (aMountStoppedBeforeItsStoreOpensDoesNothingMore, hearsOfPostsMadeAndDeletedElsewhere) under CPU load. It belongs to the archive's owner.

### The audit

- **medium**, ios/VirgaKit/Sources/VirgaDemo/Harness/FakeServer.swift proxyRoute (mirrors server/oauth/handlers/proxy.js handler); ios/parity/cases/demo-network.fakeServer.js proxyCall: The iOS proxy (/api/oauth/proxy) left out server/oauth/handlers/proxy.js's fallback: a read (GET) sent through an AppView other than Bluesky's that fails there (no status, a 5xx, or InvalidResponse) is asked once more through Bluesky's AppView. The generator's copy of proxy.js (demo-network.fakeServer proxyCall) left it out as well, so the fixture expected a 501 for getDrafts with X-Atproto-Proxy did:web:api.bsky.app (which becomes the bsky_fg proxy). The real server answers that request with 200 and the drafts. Fixed in DemoServer.proxyRoute and in the generator's proxyCall (it now uses ResponseType from @atproto/xrpc). Seven new forward steps go through another AppView: two reads that fall back and succeed, a 501 and a TypeError that are retried and still fail, a 400 that is not retried, and a write that is not retried.
- **low**, server/oauth/handlers/proxy.js forwardedQuery (Swift: FakeServer.forwardedQuery): FakeServer.forwardedQuery did not reproduce a bug in the real server's forwardedQuery. The real code fills a plain `{}` and tests `key in params`, which also sees inherited keys. A query param named after an Object.prototype key (toString, constructor, valueOf, ...) is forwarded as [<function>, value], which JSON writes as [null, value]. `__proto__=x` replaces the params object's prototype with an array. After that `reverse` reads as false (Array.prototype.reverse is inherited), and length, the array's indexes and Array.prototype method names also become arrays. Fixed: Swift now reproduces all of this, using the list of Array.prototype keys in Node 22. 14 new forwardedQuery cases and 3 forward steps cover it.
- **low**, harness/fakeXrpc.js createFakeAgent handle / methodsFor: The web agent finds methods with `methods[nsid]` on a plain object, so an NSID named after an Object.prototype key counts as a method. It passes the 501 check, and its scope token rpc:toString?... does not parse, so missingScopes ignores it and the scope check passes too. 'toString' then answers "[object Undefined]", 'constructor' echoes the input, 'isPrototypeOf' answers false for a primitive, and the rest throw V8's TypeErrors. Swift answered 501 MethodNotImplemented for all of these. Fixed: FakeXrpc.objectPrototypeKeys and objectPrototypeAnswer, held by the new 'odd-inputs' scenario (70 steps).
- **low**, harness/fakeXrpc.js methodsFor 'app.bsky.draft.updateDraft' (Swift: FakeXrpc+Methods.swift, World+Types.swift WorldDraft): updateDraft with no `draft.draft` sets `found.draft = undefined` on the web, so getDrafts afterwards returns the draft without a `draft` key. Swift stored JSON null instead. Fixed: WorldDraft.draft is now `JSONValue?` (nil is left out when encoded, and `.null` is kept). The new 'drafts' scenario holds it, along with the updates and deletes of existing drafts that no fixture covered before.
- **low**, harness/fakeXrpc.js methodsFor 'app.bsky.feed.searchPosts': searchPosts with a truthy author that isn't a string (an array, from a repeated query param through the proxy, or a number) throws `author.startsWith is not a function` on the web. Swift turned it into a string and returned no posts. Fixed; the TypeError comes back as a 500 through the proxy, as on the web.
- **low**, harness/fakeXrpc.js methodsFor 'app.bsky.actor.getProfiles': getProfiles with an actor that isn't a string but whose String() starts with "did:" (for example [did]): the web keeps the non-string as the id, no Map holds it, and the actor is skipped. Swift used its text and returned that profile. Fixed and held by the 'odd-profiles' scenario (?defense=on, because getProfiles needs Defense's scope).
- **low**, harness/fakeXrpc.js createFakeAgent (Swift: FakeAgent.init): An agent made without a scope: createFakeAgent defaults to OAUTH_SCOPE, but FakeAgent defaulted to its world's grant, so over a ?scope=read world it refused writes the web allows. This was a documented deviation in a public default. Fixed: the default is now AppConfig.oauthScope. DemoHarness.agentFor and DemoServer's default agents read their world's grant explicitly, as agentFor does. The new 'default-scope' scenario holds it.
- **low** (left as it is), server/oauth/handlers/proxy.js forwardedQuery: Web bug, reported here and not fixed in the web; Swift reproduces it. server/oauth/handlers/proxy.js forwardedQuery uses `key in params` on `{}`. Query params named after Object.prototype keys reach the Agent call as [<function>, value]. `__proto__=x` swaps the params object's prototype for an array, which silently turns `reverse` into false and makes `length`, indexes and Array.prototype method names arrays. Using Object.create(null) or Object.hasOwn would fix it. Example: `?__proto__=z&collection=app.bsky.graph.follow` lists with reverse:false.
- **low** (left as it is), harness/fakeXrpc.js createFakeAgent handle: Web bug, harness only; Swift reproduces it. harness/fakeXrpc.js looks methods up with `methods[nsid]`, so handle('toString') succeeds with "[object Undefined]", handle('constructor', x) echoes x, and the other Object.prototype keys throw TypeErrors where MethodNotImplemented was meant. The scope check doesn't catch them because rpc:<name> is not a parseable scope token.
- **low** (left as it is), harness/fakeXrpc.js methodsFor 'app.bsky.draft.updateDraft': Web bug, harness only; Swift reproduces it. harness/fakeXrpc.js updateDraft with no draft.draft answers success and wipes the stored draft's body (found.draft = undefined).
- **low** (left as it is), harness/fakeXrpc.js methodsFor bookmarks: Not fixed, unreachable. createBookmark with no uri or a non-string uri: Swift stores the string "undefined" or "5" where the web stores undefined or the number, and deleteBookmark with no uri removes nothing in Swift where the web removes a bookmark with no uri. No harness flag ever grants rpc:app.bsky.bookmark.createBookmark, deleteBookmark or app.bsky.actor.putPreferences (I checked all four scopes readFlags can produce), so these are refused in every harness world. The porter's web-bug entry for createBookmark only applies with a custom scope.
- **low** (left as it is), harness/fakeXrpc.js getServiceAuth / mintServiceToken: Not fixed, edge case. Only through a direct FakeAgent.handle call: getServiceAuth with an object `aud` mints a token whose claims JSON keeps JSONValue's key order, not insertion order. Also, 'constructor' with a primitive input answers the primitive, which is what JSON.stringify writes for the wrapper; the fixture leaves those two inputs out because _helpers.js toJSON spreads a String wrapper into indexes. And forwardedQuery writes an inherited function as null, so an agent method that echoes such a param as text reads "null,x" where JS reads the function's source.
- **low** (left as it is), harness/harness.js createHarness agentFor: Correction to the porter's webBugsNoticed: 'harness.js agentFor passes no sweepCounter, so outside a browser localStorageCounter answers 1 every time' is how it is designed to work, not a bug (in the browser localStorage exists and the count persists). The porter's other five web-bug entries check out against the code and fixtures. createBookmark is only reachable with a custom scope (see above).
- **low** (left as it is), ios/VirgaKit/Tests/VirgaArchiveTests/ArchiveModelTests.swift: VirgaArchiveTests ArchiveModelBehaviour flakes under CPU load. aMountStoppedBeforeItsStoreOpensDoesNothingMore failed once in one full run and once in five solo runs; in another full run hearsOfPostsMadeAndDeletedElsewhere failed (rev and posts not updated in time). Both depend on timing: the first yields once and races start(). That target passed 6 of 6 solo runs at load average 12, and my diff touches nothing in VirgaArchive, VirgaCore, VirgaNetwork or VirgaSession. Left for the archive's owner.

## The rest of the demo's server (2026-11-22): scheduling, timers, limits, AI, workers, Defense

Parity cases at port time: 209, plus 139 added by the audit.
Tests at the time: swift test (whole package) passes: 1419 tests in 9 test binaries (194+57+275+99+152+196+144+176+126). VirgaDemoTests has 196 tests in 33 suites; new are DemoServerRulesParity.zone, DemoServerParity.audit (5 scenarios) and SelfReplyChains (2). One earlier full run flaked once in VirgaDefense's ScorerBehaviour, outside this domain (see findings); it passed solo and on the final full run. PARITY_ALLOW_PENDING=1 npx vitest run ios/parity: 150 passed (4 files). npx eslint ios: clean. Prettier: clean on demo-server.rules.js and demo-server.audit.js. New parity cases: 81 zone, 6 describeAllow, 10 timerBucket and 16 evaluateConditions (demo-server.rules, now 302 cases, 162 KB), plus 5 scenarios and 241 steps in the new demo-server.audit (327 KB). The temporary fuzz generator and test were not committed.

### API for the code that builds on it

All of this is in target VirgaDemo, under ios/VirgaKit/Sources/VirgaDemo/Harness/.

DemoServer (FakeServer.swift), public final class DemoServer: Sendable.
- init(world:terms:limits:aiLimits:seed:aiDelayMs:ai:defenseWrites:moderator:now:sleep:timeZone:randomBytes:uuid:random:tidClockId:agents:). Defaults: terms 'agreed', limits [:], aiLimits [:], seed true, aiDelayMs 900, ai 'ok', defenseWrites true, moderator 'on', sleep NetworkClock.live.sleep, timeZone nil (the world's).
  - limits and aiLimits are createServer's option objects. FakeServer.limitsOption(HarnessFlags.Limits) and FakeServer.aiLimitsOption(HarnessFlags.AILimits) build them from the flags.
  - now is cut to whole ms. Seeding is on by default.
- Properties: featureLimits [String: Int] and aiAllowance [String: Int] (an absent key is unlimited), aiDelayMs, ai, defense: DemoDefense, timeZone, scheduled: [ScheduledRow], timers: [TimerRow], tokens, agreements, log. withRows(_:) reaches into the tables for tests.
- Workers:
  - runSchedule() -> [ScheduledRow]
  - runTimers() -> [TimerRow]
  - runCron() async -> DemoServer.CronRun {published, settled, listed}
  - runDefense() async -> Int
- Routes: handle(method:path:query:headers:body:raw:) and route(_ HTTPRequest, origin:). FakeServer.apiRoutes lists every route of the api table.
- Row types: ScheduledRow (payload JSONValue; last_error_code JSONValue, because a DOMException's code is the number 5) and TimerRow, both Codable, snake_case, each with .json.

Pure rules, in extension FakeServer (FakeServer+Rules.swift, FakeServer+Adviser.swift).
- narrowAllow(_:_:) throws -> Narrowed
- CHANGED: describeAllow(_ entries: JSONValue?) throws -> String. It iterates as for...of does: a list by its items, text by its code points, anything else throws '(entries || []) is not iterable'.
- parseEffects(_:) / parseConditions(_:) -> Reading
- CHANGED: timerBucket(conditions:effects:) throws -> String. Effects that aren't a list, or that hold a null, throw V8's TypeErrors.
- evaluateConditions(_:_:) throws -> Verdict. It now throws for clauses that aren't a list or a null clause; counts compare as JavaScript compares (ToPrimitive, then code-unit text or numbers); metrics are read as String(metric).
- Also: limitValue, aiLimitValue, seededUuid, analyzePost(text:goals:writingChecks:), the caps constants, strictEquals.
- The internal jsCompare now applies ToPrimitive (a list is its joined text, an object '[object Object]').

NEW: FakeServer+Zones.swift (fakeServer.js's validateRepeat zone check; it stays at the merge).
- FakeServer.isZone(_ z: JSONValue?) -> Bool: what new Intl.DateTimeFormat('en-US', { timeZone: z }) accepts.
- FakeServer.intlZone(named:) -> FakeServer.IntlZone? (.offset(seconds:) | .named(TimeZone), with offsetMs(at:)).
- FakeServer.offsetSeconds(_:) and FakeServer.caseForms(_:_:).
- Removed: ServerRepeat.timeZone(named:), ServerRepeat.offsetSeconds and ServerRepeat.isZone.

ServerRepeat (FakeServer+Repeat.swift, internal) is a stand-in for VirgaPosting's Repeat/PostingQueue.
- anchoredRepeat(_ raw:, _ at:, _ tz:, occurrence: = 1) -> JSONValue?
- nextOccurrence(_ raw:, _ occurrence:, nowMs:) -> (occurrence, scheduledFor)?
- tzOffsetMs reads zones through FakeServer.intlZone.
- At the merge: point FakeServer+Schedule.swift and FakeServer+Workers.swift at Repeat.anchoredRepeat and Repeat.nextOccurrence (RepeatNextOccurrence {occurrence, scheduledFor}) and delete FakeServer+Repeat.swift. Keep FakeServer+Zones.swift, and check that PostingQueue's zone reader accepts every zone FakeServer.isZone accepts.

Workers: DemoServer.selfReplyChain(_ world: AccountWorld, _ uri: String) throws -> [String] is now iterative. Same order as before; RangeError 'Maximum call stack size exceeded' at 9000 deep. A reply cycle fails the timer instead of crashing.

DemoDefense (FakeDefense.swift): unchanged.
- init(world:writes:moderator:now:note:random:clockId:)
- writes, moderator, moderatorHandle, tables: DefenseTables, run() async -> Int, static routes.

DemoHarness (Harness+Flags.swift): unchanged.
- It passes limits, aiLimits, ai, defenseWrites, moderator and clock.sleep to the server.
- cron() async -> DemoServer.CronRun.
- startCron() runs the workers every flags.cronSeconds on the harness's clock, the first run one interval in, and does nothing at 0. stopCron() stops them; cronRunning says whether they run.
- install(latency:cron: = true) also starts the workers.

DemoSession / DemoOptions: unchanged.
- DemoSession has cron(), startCron() and stopCron(). VirgaUI's demo mode should call session.startCron() once the session is up.
- DemoOptions carries defenseWrites, moderator, limits, aiLimits, ai and cronSeconds.

Other conventions:
- JSBase64.atob refuses in Node's order and with Node's words.
- The server reads a time without an offset in its timeZone.
- Strings compare by code unit; a client's ids compare as === compares them.
- Use VirgaNetwork's Optional<JSONValue>.truthy/.nonNull or VirgaDemo's .jsTruthy, never `? x : nil` with a JSONValue.

Fixtures and tests:
- Fixtures: demo-server.rules (302 cases, now with zone), demo-server.fakeServer (969 KB, at the size budget), demo-server.fakeDefense, and NEW demo-server.audit (5 multi-tick scenarios, 327 KB; replayed by DemoServerParity.audit). New scenarios belong in demo-server.audit or a new fixture, not demo-server.fakeServer.
- Tests/VirgaDemoTests/DemoServerBehaviourTests.swift has WorkerSetup, BackendTimers, refusal(_:), GatedClock and the new SelfReplyChains suite.
- JS side: ios/parity/cases/_demoServer.js has the scenario runner (scenarioCases, create/arm/composed/get/post, rootsOf). Build every step lazily (as a function) when it reads the clock.

### Known gaps and deliberate differences

- ServerRepeat (FakeServer+Repeat.swift) is still a stand-in for src/posting/schedule/repeat.js and postingQueue.js's zone arithmetic. At the merge, point FakeServer+Schedule.swift and FakeServer+Workers.swift at VirgaPosting's Repeat.anchoredRepeat and Repeat.nextOccurrence and delete FakeServer+Repeat.swift, but KEEP FakeServer+Zones.swift: FakeServer.isZone is fakeServer.js's own check. Also make sure PostingQueue reads every zone isZone accepts (any case, offsets to +-23:59, U+2212). If it doesn't, validateRepeat now returns no repeat for a rule without an end, as the web would, and the post silently stops repeating.
- Three IANA links with irregular capitals (Mexico/BajaNorte, America/Knox_IN, GB-Eire) are accepted only as written; Intl accepts any case. Fixing that needs ICU's full id list, which Foundation on Linux doesn't expose.
- Tzdata differs by environment: Node 22 (ICU 78.3, tz 2026e) puts Africa/Casablanca on +00 for 2026-27, while the container's Foundation says +01. The fixtures avoid that zone; on a device the zone database decides.
- Lone surrogates: where the web slices user text at a UTF-16 index (timer snippet at 200, the reply hint's fields, a list name at 64, a note at 500, a style guidance at 300, alt-text context at 60, an image's base64 at 2000 before hashing), a cut inside an emoji leaves a lone surrogate on the web and U+FFFD in Swift. This affects every Swift string port; I have not addressed it here.
- evaluateConditions with counts that aren't an object (null throws as the web does; a number or a list reading __proto__) doesn't reproduce prototype reads. The server's own counts are always an object.
- The porter's gaps still stand: a stashed image's non-string encoding is kept as text (WorldBlob.mimeType is String?); spawnNext throwing in runSchedule's failure path and Defense run()'s write errors are absorbed where the web would reject the whole run (unreachable); harness.js cron's console.info lines aren't written; VirgaUI must call DemoSession.startCron() in demo mode; DemoDefense mints record keys at the injected now where the web uses Date.now().
- A mediaId of '__proto__' (an own key in mediaBytes) shows in the row's payload.media in Swift, while on the web it vanishes into the map's prototype. Documented, not reproduced.
- fakeServer.test.js's 'the client and the server on when a repeating post goes out' and 'what the composer sends, as the real server reads it' compare the client and the fake against server/ code (recurrence.js, the real validateCreate), so they have no Swift counterpart here.

### The audit

- **medium**, harness/fakeServer.js selfReplyChain (Swift: FakeServer+Workers.swift DemoServer.selfReplyChain): selfReplyChain walked the account's own replies by recursion and threw the web's RangeError only 9000 calls deep. With a cycle of replies (two posts written as each other's replies), the stack overflowed before that point: the VirgaDemoTests runner died with signal 11 on Linux. I confirmed this by putting the old version back and replaying the new reply-cycle scenario. An iOS task's stack is smaller still, so the demo server's cron would crash the app where the web marks the timer failed with 'Maximum call stack size exceeded'. Fixed: the walk now keeps its own stack, visits replies in the same depth-first order and stops at the same depth. Covered by the new demo-server.audit 'reply-cycle' scenario and the new SelfReplyChains behaviour tests (branch order against a recursive reference, a chain 3000 deep, a cycle).
- **low**, harness/fakeServer.js validateRepeat (Swift: FakeServer+Zones.swift, used by FakeServer+Schedule.swift and the FakeServer+Repeat.swift stand-in): validateRepeat's zone check, Intl.DateTimeFormat({ timeZone }), did not behave like Intl. It accepted names Intl refuses: Foundation's own 'GMT+5', 'UTC+5', 'GMT-03:00' and 'GMT+05:00' forms, and tzdata's 'Factory'. It refused names Intl accepts: offsets past 18 hours ('+23:59', '-23:59', '+2359'), offsets written with the U+2212 minus sign, and IANA links in another case ('us/eastern', 'navajo', 'pst', 'systemv/est5', 'gb'). So a repeating post with such a zone got 201 where the web says 400, or the reverse. Fixed: FakeServer.intlZone/isZone (new file FakeServer+Zones.swift) reads a zone as either an offset or a named zone, tries several capitalisations, and refuses the made-up names. Three links with irregular capitals (Mexico/BajaNorte, America/Knox_IN, GB-Eire) are still found only when written exactly. I checked all 1411 names Intl lists, in lower and upper case, plus odd ones, in a temporary fuzz run; 81 of them are now committed as 'zone' cases in demo-server.rules.
- **low**, harness/fakeServer.js describeAllow, timerBucket, evaluateConditions (Swift: FakeServer+Rules.swift): Three exported pure functions returned an answer where the web throws. describeAllow refused nothing (web: '(entries || []) is not iterable' for a number, true or an object; text is iterated by code point). timerBucket accepted effects that aren't a list, or a list holding null (web: '(effects || []).some is not a function' and 'Cannot read properties of null (reading 'action')'). evaluateConditions accepted clauses that aren't a list, or a null clause (web: 'clauses.filter is not a function' and "Cannot read properties of null (reading 'op')"). Fixed: describeAllow now takes JSONValue? and throws, and timerBucket throws. The server's own calls never hit these, because rows hold parsed rules. Added 6 describeAllow, 10 timerBucket and 16 evaluateConditions cases.
- **low**, harness/fakeServer.js evaluateConditions (Swift: FakeServer+Rules.swift jsCompare, countOf): jsCompare, used by evaluateConditions, the timer's extension check and validateRepeat's count check, compared a list or an object as a number. JavaScript first turns each side into a primitive (a list becomes its joined text), so two texts compare by code unit: likes [4] >= '1_000' is true on the web and was false in Swift. evaluateConditions also read counts[metric] only for string metrics. The web uses String(metric), so a number metric works there, and a key a plain object inherits (toString, __proto__) is read as the builtin and written as its source text. Fixed, with cases.
- **low**, harness/fakeServer.js validateRepeat (Swift: FakeServer+Schedule.swift): validateRepeat threw a TypeError whenever anchoredRepeat answered null. The web reads value.anchor only when an end date is set and sets value.count only when a count is set; otherwise it returns { value: null } and the post just doesn't repeat. Today this can't happen, because the zone check and the anchoring read zones the same way. After the merge onto VirgaPosting's Repeat it could. Fixed to follow the web branch for branch.
- **low**, harness/fakeServer.test.js (Swift: DemoServerBehaviourTests.swift skipsAnOccurrenceStopsRepeatingAndEndsASeries): The Swift port of fakeServer.test.js 'skips an occurrence, stops repeating, and removes a series' left out the half that cancels the waiting occurrence of a monthly series and checks the series is gone, although its comment says it does. Added.
- **low**, harness/fakeServer.js routes and workers (Swift: DemoServerParityTests.audit): Coverage: the existing fixtures had no end-to-end run of the workers over many ticks. New fixture demo-server.audit (327 KB, kept apart because demo-server.fakeServer is 969 KB) with five scenarios. (1) A daily post with a picture and a timer while the grant is refused: retried after 2, 4, 8 and 16 minutes, it gives up, the series goes on, the older failure makes way, and it is then retried, published late and skipped at its last occurrence. (2) Timers meeting gates and postgates the author set: already limited, closed to everyone, narrowed to a list with hidden replies kept, quoting already off, detached quotes kept, a thread deleted with its own replies, extended twice then spared, and failing every 2 minutes while refused. (3) A row edited into a new media folder, started as a series, moved around a pinned delete time, reordered, failed at the scheduledPosts limit and edited back. (4) 70 rows listed with tied times. (5) A reply cycle. DemoServer already matched scenarios 1 to 4 before any change.
- **low** (left as it is), harness/fakeServer.js settleTimer: New web bug (left as it is): settleTimer counts a failed timer's last attempt twice. Object.assign sets attempts+1, then resolve('failed') adds 1 again. A timer that gives up while its grant is refused reads attempts 6 with maxAttempts 5 (visible in demo-server.audit 'timer-effects'). Swift reproduces it.
- **low** (left as it is), harness/fakeServer.js settleTimer / timerShape: New web bug (left as it is): settleTimer never clears last_error or last_error_code once a timer succeeds. A timer that once hit SESSION_UNAVAILABLE and later acts or is deleted still lists that lastError and lastErrorCode. Swift reproduces it.
- **low** (left as it is), harness/fakeServer.js stashMedia, GET /api/schedule/media: New web bug (not reproduced, documented): stashMedia's map and /api/schedule/media's out are plain objects. A mediaId of '__proto__' whose bytes sit under an own '__proto__' key of mediaBytes is assigned as the object's prototype: it vanishes from the row's payload.media and from the media route, yet publishing still finds the bytes through the prototype. Swift keeps it as an ordinary key. Object.create(null) or a Map would fix it.
- **low**, harness/fakeServer.js, harness/fakeDefense.js, harness/harness.js: Rechecked the porter's other claims against the code and fixtures. The seven web bugs it listed hold: ALLOW_WORDS prototype keys, the DOMException code 5, the create body's occurrence, a null body giving 500, nextKey reading Date.now(), the undone add job taking its holder's batch, and until accepted without a calendar check. Everything else I compared line by line matched the web: the module map, stamps (fakeServer 8c31068cdf24, fakeDefense 4b44087c04e9, harness c4768f342f72), the // Ports headers, the route order, refusal copy, uuid consumption order, TimSort for the scheduled list and Defense history, stable sorting for the timer list, dropMedia's identity rule, spawnNext, backoff, AI trial commit, Defense run and veto, the atob order, and the cron task with GatedClock. A temporary fuzz run with about 2,900 random inputs to parseConditions, parseEffects, narrowAllow, analyzePost, styleSummary, alt text and the repeat stand-in found nothing beyond the items above.
- **low** (left as it is), ios/VirgaKit/Tests/VirgaDefenseTests/ScorerBehaviourTests.swift: Outside this domain, left for its owner: VirgaDefenseTests ScorerBehaviour.stopsReadingProfilesOnceWhoYouFollowHasFailed failed once in a full run under load (calls.count <= 1). It passed 3 of 3 solo runs. The test orders concurrent work with a 5 ms sleep against a 30 ms one, which is the pattern the brief warns about. A later full run passed.
