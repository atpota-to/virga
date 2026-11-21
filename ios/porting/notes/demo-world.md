# demo-world: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited.
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
