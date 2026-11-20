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
| `harness/harness.js` | `Harness/Harness.swift`, `DemoWorld.swift` | partial: `READ_ONLY_SCOPE`, `withDefense`, the address flags' `scope` (`Harness.grantedScope(scope:defense:)`), and the worlds `createHarness` builds and holds (`worlds`, `worldOf`, each world's `scope` and `pdsUrl`, `grantOf`, `regrant`). The other flags (`readFlags`'s accounts, mode, limits, AI, terms, cron, latency, now), the fake server, the agents, `install` and `window.__harness` come with the fake network | `demo-world.harness` | `c4768f342f72` |
| `harness/fakeNetwork.js` | `DemoWorld.swift` (`repoCar`) | partial: only the repo CAR cache. The routes (public AppView, PDS, PLC directory, Constellation, the card and video services) wait for VirgaNetwork's `HTTPTransport` and `MockTransport` | — | — |
| `harness/fakeXrpc.js` | — | pending: the signed-in agent; needs VirgaNetwork's XRPC client and VirgaSession | — | — |
| `harness/fakeServer.js` | — | pending: Virga's server; needs VirgaNetwork's `VirgaBackend` | — | — |
| `harness/fakeDefense.js` | — | pending: Defense's server routes; needs VirgaNetwork | — | — |
| `harness/fakeSession.jsx` | — | pending: the signed-in session stand-in; needs VirgaSession | — | — |
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
  the repo, a malformed embed list throws the web's TypeError in the views,
  CAR keys are prefix-compressed by UTF-16 code unit.
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

`DemoWorldTests.swift` covers what isn't a fixture: writes seen by every
reader, the CAR cache, decoding into the lexicon models, concurrent use.
