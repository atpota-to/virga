# Porting the web app to Swift: conventions

The iOS app is a port of the web app in `src/`, kept in step with it by the
parity harness (`ios/parity/`). This file is the rulebook for every Swift file
in `ios/`. Read `ios/parity/README.md` too.

## Targets

`ios/VirgaKit` is a Swift package. Every target but VirgaUI is plain Swift on
Foundation and Observation and **must build and test on Linux**.

| Target | Ports | Depends on |
| --- | --- | --- |
| VirgaCore | `src/config.js`, `src/lib/{time,locale,sky,router,preferences}`, tid, graphemes; the lexicon models; JS semantics (`Support/JSCompat.swift`); storage protocols | — |
| VirgaNetwork | `src/lib/{atproto,constellation,activity}.js`, `src/session/{pds,backendClient}.js`, blobs, asyncPool, and the network helpers of `src/posting/library/sources.js` (publicXrpc, resolveHandle, getPosts) | Core |
| VirgaRepo | `src/lib/carRepo.js`, `src/posting/lib/recordCid.js`; CAR, DAG-CBOR, CIDs | Core |
| VirgaSession | `src/session/`, `src/accounts/*.js`, `src/signin/*.js`, `src/legal/*.js`, `src/lib/{oauthClient,sessionHint}.js` | Core, Network |
| VirgaArchive | `src/lib/analytics*.js`, followerLog, syncProgress, periods, `src/charts/format.js`, `src/archive/` | Core, Network, Repo, Session |
| VirgaPosting | `src/posting/**/*.js` (rich text, composer, publish, drafts, scheduling, timers, templates, library, adviser) | Core, Network, Repo, Session, Archive |
| VirgaInsights | routes, `src/dashboards`, `src/reports`, `src/tools`, `src/share`, `src/shell`, `src/settings` (logic) | …, Archive, Posting |
| VirgaDefense | `src/defense/*.js` | …, Archive, Posting |
| VirgaDemo | a made-up world for previews, demo mode and UI tests (after `harness/`) | everything above |
| VirgaUI | every `.jsx` and the stylesheets, as SwiftUI (Apple platforms only) | everything |

`ios/parity/modules/<domain>.json` assigns every web file to a domain and a
target. When you port a file, that is where you record it (below).

## Where things go

- One Swift file per web module, in a folder mirroring the web path, e.g.
  `src/posting/lib/threadSplit.js` → `Sources/VirgaPosting/Lib/ThreadSplit.swift`.
  Split a very large module into `Name.swift` + `Name+Part.swift`.
- **Every Swift file that ports web code starts with `// Ports <web path>`**
  (one line per web file it ports). `ios/parity/modules.test.js` checks it.
- A web module becomes a caseless `enum` named after it (`threadSplit.js` →
  `enum ThreadSplit`), holding its functions as `static func` with the **web
  names unchanged** (`ThreadSplit.splitIntoThread(...)`) so anyone can grep
  from one side to the other. Constants become `static let` in lowerCamelCase
  (`MAX_POST_GRAPHEMES` → `maxPostGraphemes`).
- Data shapes (records, rows, states, options) are top-level `struct`s and
  `enum`s: `Codable, Hashable, Sendable`, field names as in the web objects, so
  they encode to the same JSON. Use `JSONValue` (VirgaCore) where the web
  passes arbitrary JSON (records of unknown collections, raw XRPC bodies).
- A React hook that holds real state (useAnalyticsArchive, useLibrary,
  useTemplates, useDefense, useAtprotoSession) becomes a
  `@MainActor @Observable public final class …Model` in the logic target, with
  its dependencies passed to `init`, so it is unit-tested on Linux. Views in
  VirgaUI only bind to these.
- Shared lexicon types live in `VirgaCore/Lexicon/` (Facet, StrongRef, BlobRef,
  SelfLabels are there already). Don't define a second copy of a type another
  target owns; import it.

## Behaviour must match

The goal is that the Swift port computes what the web code computes. That
means porting the code, not reimagining it.

- **Strings index in UTF-16.** A JavaScript string's `length`, indexes, `slice`,
  `indexOf` and regex offsets count UTF-16 code units, and facet byte offsets
  are worked out from them. Use `Support/JSCompat.swift` (`jsLength`,
  `jsSlice`, `jsSubstring`, `jsIndexOf`, `jsCharAt`, `utf8Offset(ofUTF16:)`,
  `jsTrimmed`), or work on `Array(text.utf16)`. Don't index by `Character`
  where the web indexes by code unit. Graphemes (`Graphemes.countGraphemes`)
  are only for what the web counts with Intl.Segmenter.
- **Strings compare by code unit.** Swift's `==` on String, and so `Set<String>`,
  `Dictionary` keys, `contains` and `firstIndex(of:)`, is canonical
  equivalence: "é" equals "e\u{301}", and the Kelvin sign equals "K".
  JavaScript's `===`, `includes`, `indexOf`, Sets and object keys compare
  UTF-16 code units. Wherever the web compares strings that come from outside
  the code (ids, DIDs, handles, keys read back from storage, user text), use
  VirgaCore's `jsEquals`, `JSKey` (a Set/Dictionary key), `jsIncludes` and
  `jsValue` (`Support/JSStrings.swift`). Comparing with an ASCII literal is
  exact unless it contains "K", ";" or "`". `Parity.diff` compares strings
  by code unit, so fixtures catch the difference.
- **Regular expressions.** Port JS regexes to `NSRegularExpression` matched over
  `NSString`/UTF-16 ranges, which gives JS-compatible offsets. Watch the
  differences: JS `\w`, `\d`, `\b` are ASCII-only unless the regex has `u`
  (ICU's are Unicode: write `[A-Za-z0-9_]` explicitly); JS `\s` is
  `JSWhitespace`; `.` doesn't match line terminators in either; lookbehind
  works in both. Swift `Regex` literals are fine where offsets don't matter.
- **Numbers.** `Math.round` is `jsRounded` (halves go up, not away from zero);
  `toFixed` is `jsToFixed`; `String(n)` is `JSNumber.format`. JS numbers are
  doubles: use `Double` where the web does arithmetic that can be fractional,
  `Int` for counts.
- **Time.** Never read the clock inside logic: take `now: Date` (or
  `now: () -> Date` in a model) as the web takes `now = Date.now()`. Calendars
  are `Calendar(identifier: .gregorian)` with an explicit `timeZone`. Times in
  epoch milliseconds stay `Double`/`Int64` milliseconds where the web uses
  them, so fixtures compare directly.
- **Formatting.** Where the web formats with `Intl` and an explicit locale, use
  Foundation's formatters with that locale and check against fixtures; where
  output must be exact (copy, compact numbers, dates in sentences), port the
  web's own formatting code. Never depend on the device's locale or zone in
  logic: they come in as parameters (VirgaCore's locale port holds the active
  ones, as `src/lib/locale.js` does).
- **Copy is behaviour.** User-visible words come from the web, word for word,
  including curly quotes and the house style ("Scheduled posts", not
  "Scheduled Posts"). Where the web builds a sentence in a function, port the
  function and hold it to the web with a fixture.
- **Module-level state** (caches, the active locale) becomes a `Locked<T>`
  static (VirgaCore/Support/Locked.swift) with the value also accepted as a
  parameter.
- **Errors**: Swift `Error` types that carry the same codes and messages the
  web shows (`LocalizedError.errorDescription` = the web's message).

## Platform rules

- Swift 6 language mode, complete concurrency checking, in every logic target.
  Value types are `Sendable`; shared mutable state is an `actor`, a
  `@MainActor` model or `Locked`.
- No third-party packages. Foundation, Observation, and on Apple platforms
  SwiftUI, Charts, PhotosUI, AuthenticationServices, AVFoundation.
- Linux: `import FoundationNetworking` under `#if canImport(FoundationNetworking)`
  wherever URLSession/URLRequest appear. No CryptoKit (VirgaCore has SHA-256),
  no UIKit/AppKit in logic targets, no `NSAttributedString` conversions.
- All I/O goes through protocols so tests and the demo can stand in:
  HTTP through VirgaNetwork's `HTTPTransport` (with `MockTransport` for tests),
  small persisted values through VirgaCore's key-value store protocol (the
  web's localStorage), larger data through its file store protocol (the web's
  IndexedDB). Never touch `UserDefaults` or the file system directly from logic.
- Apple's SDK is stricter than Linux's Foundation in places Linux can't
  check. The one CI has caught: APIs marked `noasync` (iterating a
  `FileManager.DirectoryEnumerator`, `NSLock.lock()`/`unlock()`,
  `DispatchSemaphore.wait()`, `Thread.sleep`) can't be called directly in an
  `async` function in Swift 6 mode. Do that work in a synchronous helper, or
  through `Locked.withLock`. And Apple's `NSString(string:)` drops a leading
  U+FEFF (Linux's keeps it): never take lengths or offsets from a bridged
  NSString; use `utf16` and VirgaCore's `JSRegexSubject`. CI builds with Xcode 26.6 (iOS 26.5 SDK); keep to
  Swift 6.2's language features.
- Xcode's Swift 6.2 type checker gives up on expressions Swift 6.4 accepts
  ("unable to type-check this expression in reasonable time"), most often
  mixed integer and floating literals in arithmetic, or long `&&` chains,
  inside `#expect`. Give literals a type in a `let` first
  (`let expected: Double = 272 + 1040 + 51.2 * 2`) and write one `#expect`
  per comparison.
- iOS 17.4 is the floor: no iOS 18-only API without `if #available`.
- VirgaUI can only be compiled by CI, and its first compiles have failed
  for the same few reasons. Check these before a round goes to CI:
  - **A name already taken.** A type in VirgaUI hides one of the same name
    in the logic targets for every file in VirgaUI: a view named `Library`
    hid VirgaPosting's `Library`, and VirgaPosting also has `LibraryPage`,
    `LibraryPreview` and `ComposerFiles`. SwiftUI has names of its own too
    (`TextSelection` from iOS 18, `LibraryItem` from DeveloperToolsSupport),
    so a bare name in a file importing both is ambiguous; VirgaUI settles
    those two with typealiases. Grep VirgaUI and the logic targets, and
    think of SwiftUI's, before naming a type. The same goes for a static
    added to a shared enum such as `Measure.Tools`, which two people may add
    to at once.
  - **Something internal.** A logic target's internal helpers
    (`jsStartsWith`) and a public struct's synthesized memberwise
    initializer aren't visible from VirgaUI: give the struct a public
    `init`. Nothing provides `String.nonEmpty`.
  - **A subscript's label.** A subscript's parameter name isn't an argument
    label: `views[uri]`, not `views[uri: x]`.
  - **Isolation and optionals.** Read a `@MainActor` model only from
    `@MainActor` code (static helpers included); unwrap an optional before
    `jsEquals`; give a tuple fallback its labels; import the target a
    type lives in (`PostingRoutes` is VirgaInsights').
- **An identifier on a container hides its children's.** SwiftUI hands an
  `.accessibilityIdentifier` set on a stack, a sheet's body or a card down
  to every element inside it, over their own, so a UI test can't find the
  Close or the switch within. Put `.accessibilityElement(children:
  .contain)` just before the container's identifier (the sidebar's, the
  composer's bar). Compiling doesn't show this; only a UI test does.

## Tests

- Swift Testing (`import Testing`), one test target per logic target.
- **Parity tests** (`<Thing>ParityTests.swift`) for every pure function the web
  exports: a case generator in `ios/parity/cases/<domain>.<module>.js` runs the
  web function, `npm run parity:write` writes the fixture, and the Swift test
  runs the port over the same inputs (`VirgaTestSupport.Parity`). Make the
  inputs adversarial: empty, unicode and emoji, boundaries, malformed data,
  every branch the web code has. The web module's own `*.test.js` is the best
  list of interesting inputs; reuse them.
- **Local time.** Code that buckets or formats in local time takes a
  `TimeZone` in Swift; its generator records cases in several zones with
  `inZone(tz, fn)` (synchronous) or `withTimeZone(tz, fn)` (async) over
  `ZONES` (`cases/_zones.js`, re-exported by `_helpers.js`), across DST
  changes, and passes the zone in the case input.
- **Fixture size.** Keep each fixture under about 1 MB: choose inputs that
  cover every branch rather than exhaustive grids, and for big generated
  data (worlds, crowds) record counts, hashes of a canonical form and a few
  samples, as VirgaDemo's fixtures do. The fixtures are in the repository.
- **Recorded-fetch parity** for code that talks to the network: in the
  generator, wrap the web call in `withFakeFetch(responder, fn)`
  (`cases/_helpers.js`); the fixture records every request the web code made
  (URL, method, headers, body) and its result. The Swift test answers the
  same requests from `MockTransport` and checks the port made the same
  requests, in the same order, and reached the same result.
- **Behaviour tests** for what can't be a fixture: models, stores, networking
  against `MockTransport` (request shape, pagination, errors, retries), and
  anything with I/O. Port the web module's own tests where they apply.
- **No clocks in assertions.** Swift Testing runs suites in parallel on a
  few pool threads, and CPU-bound parity replays can hold them for minutes
  on a loaded machine: a 30 ms deadline has been met after 128 seconds. So
  no test orders work with `Task.yield` counts or short sleeps, and none
  asserts a wall-clock bound. To show something answered before slow work
  ended, have the slow work set a flag when it ends and check the flag;
  wait for a state with a polling loop that has a generous limit.
- Assert with a message that shows the difference:
  `let d = Parity.diff(actual, c.output); #expect(d == nil, "\(c): \(d ?? "")")`.

## Recording a port

In `ios/parity/modules/<domain>.json`, for each web file:

```json
"src/posting/lib/threadSplit.js": {
  "status": "ported",
  "swift": ["ios/VirgaKit/Sources/VirgaPosting/Lib/ThreadSplit.swift"],
  "fixtures": ["posting.threadSplit"],
  "synced": "<12 hex digits>"
}
```

- `status`: `ported` (all of it), `partial` (with a `note` saying what's
  missing), `exempt` (nothing on iOS; `note` says why, e.g. "the browser's
  own OAuth client; iOS signs in through Virga's server"). Don't leave `pending`.
- `synced`: run `npm run parity:stamp -- <web file>` once the Swift side
  matches it. `npm run parity:drift` lists web files changed since.

## Commands

From the repository root (Node 20+):

```bash
npm run parity:write                      # regenerate every fixture from the web code
PARITY_ALLOW_PENDING=1 npx vitest run ios/parity   # fixtures fresh, map valid
npm run parity:stamp -- src/lib/periods.js         # record a sync
node ios/parity/sync.mjs status           # how far each domain has got
```

From `ios/VirgaKit` (any Swift 6 toolchain, Linux or macOS):

```bash
swift build
swift test
swift test --filter VirgaPostingTests
```
