# VirgaDemo: the web harness's world, in Swift

The iOS app's demo mode, SwiftUI previews and UI tests run on the same
made-up accounts the web harness (`harness/`, see `harness/README.md`)
shows: Mira Okafor with three years of history and Field Lab beside her,
the same posts, followers, notifications, crowd, lists, drafts and
templates, dated back from one `now`. Built here at a `now` and seed, a
world is the web's record key for record key, so the two apps can be
compared screen for screen.

Start at `DemoWorld` (both worlds, the AppView over them, Defense's crowd,
the repo CAR). Previews can use `DemoWorld.preview` (built at the README's
`now`, 1794700000000).

The harness's files aren't in `ios/parity/modules/` (that map covers
`src/`), so this table is their record. `synced` is the first 12 hex digits
of the web file's SHA-256 when its Swift side was last brought in line, as
`npm run parity:stamp` records for `src/` files:
`sha256sum harness/<file> | cut -c1-12`.

| Harness file | Swift | Status | Fixtures | Synced |
| --- | --- | --- | --- | --- |
| `harness/world.js` | `Harness/World.swift`, `Harness/World+Types.swift`, `Harness/World+Posting.swift` | ported | `demo-world.world` | `32641d2b59dd` |
| `harness/crowd.js` | `Harness/Crowd.swift` | ported | `demo-world.crowd` | `fe4fed359768` |
| `harness/repo.js` | `Harness/Repo.swift` | ported | `demo-world.repo` | `1f6624b15b0a` |
| `harness/views.js` | `Harness/Views.swift`, `Harness/Views+Models.swift` | ported | `demo-world.views` | `d8991ff0bc80` |
| `harness/buildCar.js` | `Harness/BuildCar.swift` | ported | `demo-world.buildCar` | `e1280e68941c` |
| `harness/png.js` | `Harness/PNG.swift` | ported | `demo-world.png` | `57fe7a7d593c` |
| `harness/harness.js` | `Harness/Harness.swift`, `Harness/Harness+Flags.swift`, `DemoWorld.swift` | ported: `READ_ONLY_SCOPE`, `withDefense`, `readFlags` with `readLimits` and `readAiLimits` (`Harness.readFlags`, every flag, read from a launch argument in the address's form), and `createHarness` as `DemoHarness` (the worlds, `worldOf`, `grantOf`, `regrant`, `agentFor`, the server built with every flag it reads, `install()` as setting VirgaNetwork's `HTTP.transport` and `HTTP.clock` and starting the workers, and `window.__harness`'s `cron`, `stopCron`, `expire` and `refuse`). The workers' `setInterval` is `startCron()`: a task on the harness's clock running `server.runCron()` every `?cron=` seconds, the first one interval in; `cronRunning` says whether it runs. The console's `info` lines aren't written | `demo-world.harness`, `demo-network.harness` (and the workers in `DemoServerBehaviourTests.swift`) | `c4768f342f72` |
| `harness/fakeNetwork.js` | `Harness/FakeNetwork.swift`, `DemoWorld.swift` (`repoCar`) | ported: `createRouter` as `DemoRouter` (the PLC directory, the public AppView, the accounts' PDS with the repo CAR and blobs, Constellation, the card and video services; anything else nil), `installFakeNetwork`'s fetch as `DemoTransport` (an `HTTPTransport` with the latency, refusing other hosts as a network failure). The same-origin `/api` rewrite has no iOS case: the app's server address is `FakeServer.serverOrigin` | `demo-network.fakeNetwork` | `c66ed1161cbf` |
| `harness/fakeXrpc.js` | `Harness/FakeXrpc.swift`, `Harness/FakeXrpc+Methods.swift`, `Support/JSBase64.swift` | ported: `createFakeAgent` as `FakeAgent` (every method, its refusals word for word, the follower churn, the known-follower counts), `scopesFor`, `mintServiceToken`, `readServiceToken`, `DRAFT_LIMIT`, `localStorageCounter`; `FakeXrpcFetchHandler` points VirgaNetwork's `XRPCAgent` at an agent. The Proxy-built namespaces are the NSID passed to `handle` | `demo-network.fakeXrpc` | `4bc064331a95` |
| `harness/fakeServer.js` | `Harness/FakeServer.swift`, `Harness/FakeServer+SignIn.swift`, `Harness/FakeServer+Rules.swift`, `Harness/FakeServer+Adviser.swift`, `Harness/FakeServer+Schedule.swift`, `Harness/FakeServer+Timers.swift`, `Harness/FakeServer+Workers.swift`, `Harness/FakeServer+Zones.swift`, `Harness/FakeServer+Repeat.swift` | ported: `createServer` as `DemoServer` with every option (`limits`, `aiLimits`, `seed`, `aiDelayMs`, `ai`, `terms`, `defenseWrites`, `moderator`, `now`), the sessions (`mintToken`, `signOutToken`, `expireAccount`, `refuseGrant`, /api/oauth/session, /api/oauth/logout), the terms ledger, scheduling (/api/schedule/create, list, get, media, update with retry, skip, stop, edit and move, reorder, cancel), timers (/api/self-destruct/create, list, cancel), /api/limits/status, the adviser and alt text (/api/ai/analyze-post, synthesize-style, alt-text, with the month's allowances and the wait `aiDelayMs` or 14 s when slow, on the injected `sleep`), the workers (`runSchedule`, `runTimers`, `runCron`, `runDefense`), the seeded rows (`seedRows`, at local hours in the server's zone), `inspect()` as `scheduled`, `timers`, `tokens`, `agreements`, `log` and `defense.tables`, `createServerRouter` as `route(_:origin:)`, and the pure exports (`narrowAllow`, `describeAllow`, `parseEffects`, `parseConditions`, `timerBucket`, `evaluateConditions`, `analyzePost`, the `MAX_*` caps, `FEATURES`, `MAX_ANALYZE_TEXT`, `DEFAULT_AI_LIMITS`, `SERVER_ORIGIN`). The randomness is injected (`randomBytes` for tokens, `uuid` for `crypto.randomUUID`, `random` for `Math.random`, `tidClockId` for the record keys' clock id). repeat.js's `anchoredRepeat` and `nextOccurrence` (with postingQueue.js's zone arithmetic) are a stand-in, `ServerRepeat` in FakeServer+Repeat.swift, until VirgaPosting's `Repeat` and `PostingQueue` (ported in another chain this wave) are merged. validateRepeat's own check of a zone (`FakeServer.isZone`, FakeServer+Zones.swift) takes what Intl takes, an IANA name, link or ICU id in any case or an offset to ±23:59, and stays at the merge; links with irregular capitals (Mexico/BajaNorte) are found only as written. One deliberate difference: on iOS the proxy (/api/oauth/proxy, /api/oauth/upload-blob) forwards a usable grant's call to the account's `FakeAgent`, answering as server/oauth/handlers/proxy.js and uploadBlob.js do, a read through another AppView that fails there asked again of Bluesky's and the real server's `forwardedQuery` read as it reads; the web fake answers 501, its pages calling their agents directly, and /api/oauth/login with `authorize(_:)` and `DemoAuthenticator` stand in for the sign-in's trip | `demo-network.fakeServer`, `demo-server.rules`, `demo-server.fakeServer`, `demo-server.audit` | `8c31068cdf24` |
| `harness/fakeDefense.js` | `Harness/FakeDefense.swift` | ported: `createDefense` as `DemoDefense` (DemoServer's `defense`), every route (/api/defense/lists, list-create, keep, unkeep, plan, approve, history, undo, link, link-code, unlink, link-list), `run()` (a batch per holder, the veto: the owner, the holder, people kept by hand, everyone followed, curation lists' members) and `inspect()` as `tables`. Ids a client sends are kept as the JSON they came as, compared as `===` compares them. `nextKey` is createTidClock's over VirgaCore's `TID.encode`, minted at the clock's `now` with an injected clock id | `demo-server.fakeDefense` | `4b44087c04e9` |
| `harness/fakeSession.jsx` | `Harness/FakeSession.swift`, `Harness/FakeServer+SignIn.swift` (`signIn`: who a sign-in lands as) | ported: `DemoSession` builds VirgaSession's `SessionModel` over `SessionController` with `NoBrowserSessions`, in-memory key-value and secret stores and `DemoTransport`, and writes what a device holds after signing both accounts in (rows, the open account, tokens the fake server minted, the Terms notes); `DemoOptions` are the flags that apply (accounts, signedout, expired, scope, defense, terms, latency, now, appview). The web's provider is the real one here, so switching, signing out, the 401 confirmations and the checks are the app's own. `mode=browser` doesn't apply: the iOS app has long sessions only | (behaviour tests) | `545496123ba3` |
| `harness/main.jsx`, `harness/index.html` | — | exempt: the web page that mounts the harness; on iOS, demo mode is the app's own launch option | — | — |

Every Swift file that ports harness code says so in a `// Ports harness/…`
header.

## How the port stays exact

- **Numbers.** `mulberry` is bit for bit (`Math.imul` and `>>> 0` as
  wrapping 32-bit arithmetic). `x ** y` and `Math.sin` are V8's own fdlibm
  ports (`Support/JSMath.swift`), not the platform's libm, which differs in
  the last bit often enough to move a follower's date across a millisecond
  and with it a record key. Sums and products keep the web's order;
  `Math.round` is `jsRounded`.
- **Sorting.** The harness sorts with comparators that never say "equal",
  so ties land wherever V8's TimSort leaves them. `Support/JSSort.swift` is
  that TimSort, comparison for comparison.
- **Strings.** Keys compare, sort and split by UTF-16 code unit
  (`Support/JSText.swift`, VirgaCore's `jsEquals`/`JSKey`); a `Map` is
  `JSOrderedMap`, a `Set` `JSOrderedSet`.
- **Shapes.** World types encode to the web object's JSON, nulls and
  missing keys included (`WorldPost.fixture` says which keys a post has).
  Views are `JSONValue` in the harness's exact shapes, since a fake network
  serves JSON; `Views+Models.swift` decodes them into VirgaCore's lexicon
  models.
- **The web's quirks are kept**: a collection named after a key of
  `Object.prototype` (`toString`, `__proto__`) throws the web's TypeError in
  the repo, and an XRPC method named after one is answered by the fake
  agent as its plain methods object answers it; a malformed embed list
  throws the web's TypeError in the views; CAR keys are prefix-compressed by
  UTF-16 code unit; an updateDraft that sends no draft leaves the stored
  one without any.
- **No clock.** Where the web reads `Date.now()` or `new Date()` (a written
  post's time, a live count, a list's date), the Swift function takes `now`.
- **No device zone.** A written post's time without an offset is read in
  the browser's zone on the web (`Date.parse`); here in `DemoWorld`'s (and
  `DemoViews`') `timeZone`, UTC unless given. The views fixture holds it in
  five zones, across a spring gap and an autumn overlap.
- **The caches are the web's.** The crowd keeps whom an account follows as
  it first saw it and each post's engagers once worked out, and reads the
  live follows for vouches, as the web's crowd does; `demo-world.crowd`'s
  `afterWrites` scenario holds that across writes. One difference in
  shape: the web makes a crowd per consumer (the fake network, each
  agent, the fake server each call `createViews`), so their first sights
  of a world can differ; a `DemoWorld` has one crowd, shared by every
  reader. Whoever builds the fake network on it decides whether that
  matters.

## Parity

Worlds are big (about 1,000 posts, 4,810 followers, 3,400 notifications,
5,200 likes), so the fixtures hold them by part: each list's count, the
SHA-256 of its canonical JSON (keys sorted by code unit, JSON.stringify's
numbers and escaping: `ios/parity/cases/_canonical.js`, and
`Tests/VirgaTestSupport/CanonicalJSON.swift` on this side) and a few whole
sample items, so a difference shows on a readable item. The small
functions are held whole.

| Fixture | Generator | Swift tests |
| --- | --- | --- |
| `demo-world.world` | `cases/demo-world.world.js` | `WorldParityTests.swift` |
| `demo-world.jsmath` | `cases/demo-world.jsmath.js` | `JSMathParityTests.swift` |
| `demo-world.crowd` | `cases/demo-world.crowd.js` | `CrowdParityTests.swift` |
| `demo-world.repo` | `cases/demo-world.repo.js` | `RepoParityTests.swift` |
| `demo-world.views` | `cases/demo-world.views.js` | `ViewsParityTests.swift` |
| `demo-world.buildCar` | `cases/demo-world.buildCar.js` | `BuildCarParityTests.swift` |
| `demo-world.harness` | `cases/demo-world.harness.js` | `HarnessParityTests.swift` |
| `demo-world.png` | `cases/demo-world.png.js` | `PNGParityTests.swift` |
| `demo-network.fakeXrpc` | `cases/demo-network.fakeXrpc.js` | `FakeXrpcParityTests.swift` |
| `demo-network.fakeNetwork` | `cases/demo-network.fakeNetwork.js` | `FakeNetworkParityTests.swift` |
| `demo-network.fakeServer` | `cases/demo-network.fakeServer.js` | `FakeServerParityTests.swift` |
| `demo-network.harness` | `cases/demo-network.harness.js` | `HarnessFlagsParityTests.swift` |
| `demo-server.rules` | `cases/demo-server.rules.js` | `DemoServerRulesParityTests.swift` |
| `demo-server.fakeServer` | `cases/demo-server.fakeServer.js` (with `cases/_demoServer.js`) | `DemoServerParityTests.swift` |
| `demo-server.fakeDefense` | `cases/demo-server.fakeDefense.js` (with `cases/_demoServer.js`) | `DemoServerParityTests.swift` |

`DemoWorldTests.swift` covers what isn't a fixture: writes seen by every
reader, the CAR cache, decoding into the lexicon models, concurrent use.
`FakeXrpcBehaviourTests.swift` and `FakeServerBehaviourTests.swift` are
harness/fakeXrpc.test.js and the session, terms and network parts of
fakeServer.test.js, run through the app's own clients;
`DemoServerBehaviourTests.swift` is the rest of fakeServer.test.js
(scheduled posts, timers, the adviser and alt text, replies, repeating
posts) and fakeDefense.test.js, through VirgaBackend, TimerService and
DefenseService, and the harness's workers on a clock whose waits the test
releases; `DemoSessionTests.swift` runs the session layer on the demo for
each flag, and VirgaArchive's first build for Mira end to end.

The demo-network fixtures hold the router's, the agent's and the server's
answers to scenarios of requests (`_demoNetwork.js`'s `shrink` keeps a big
answer by its digest and parts, `answerOf` a response by its status, type
and body). Where the iOS port answers on purpose differently from the web
fake (a usable grant's proxy call), `demo-network.fakeServer`'s `forward`
cases hold it to the real server's own pieces (forwardedQuery,
isSafeXrpcMethod, httpStatusForXrpcError, extractBlobPayload) over the fake
agent. The server's tokens come from repeatable randomness on both sides.

The demo-server fixtures record scenarios of requests on one server
(`_demoServer.js`): every scheduling, timer, limits, AI and Defense route
asked with good input and bad, the limits and caps reached, the workers
run between requests on a clock that moves only when a step says so, and
at the end the server's tables, its log and what the workers wrote into
each world. The randomness is repeatable on both sides (the tokens'
bytes, `crypto.randomUUID` as a count, `Math.random` as a fixed sequence,
and the record keys' clock id: the generator loads the server afresh with
`Math.random` at 0, so tid.js picks clock id 0). Requests are recorded
resolved, so the Swift test sends exactly the text the web was sent. Two
scenarios run in New York and Chatham, for the seeded rows' local hours.

## The demo, put together

```swift
let session = DemoSession(options: .read("?accounts=1&terms=ask"))
await session.start()            // Mira open, through Virga's server
session.model                    // the app's SessionModel
session.transport                // every request this session makes
ArchiveEnvironment(files: …, transport: session.transport, didDocuments: session.didDocuments)
```

Every request goes to `DemoTransport`: Virga's server
(`FakeServer.serverOrigin`) answers the session, the terms, scheduling,
timers, the limits, the adviser, Defense and, through its proxy, every
signed-in call, which the account's `FakeAgent` answers from the world; the
public hosts are answered by `DemoRouter`. Writes land in the `DemoWorld`,
so they show up in every later read. The server's workers publish what was
scheduled and settle timers when they run: `session.cron()` runs them once,
`session.startCron()` every `?cron=` seconds (20 by default) on the
session's clock until `stopCron()`. `DemoHarness.install()` makes the demo
VirgaNetwork's default transport too, for code that isn't handed one, and
starts the workers, as the web's install does.
