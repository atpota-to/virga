# Parity: keeping the iOS app in step with the web app

The web app (`src/`) is the reference. The iOS app (`ios/`) is a port of it.
Three mechanisms keep the port honest as the web app changes, each failing CI
(`.github/workflows/ios.yml`) at a different point.

## 1. Fixtures: the web code's own output

`ios/parity/cases/*.js` are case generators. Each imports web modules, runs
their functions over fixed inputs, and returns `{ id, fn, input, output }`
cases. `npm run parity:write` writes them to `fixtures/<name>.json`, and the
Swift tests run the Swift port over the same inputs and compare
(`ios/VirgaKit/Tests/VirgaTestSupport/Parity.swift`).

So the Swift app is held to what the web app actually computes, not to what
someone remembered it computing: thread splitting, facets, schedule
serialization, analytics, the scan's score, the words of every sentence a
function builds, the permission groups, the routes, the API surface.

**When you change the web app**, `npm test` (which includes
`ios/parity/parity.test.js`) fails if a fixture no longer matches the web
code's output:

```
ios/parity/fixtures/posting.threadSplit.json is stale: the web app's output changed.
    changed splitIntoThread [long-paragraphs]
Run `npm run parity:write`, then `swift test` in ios/VirgaKit to see which Swift port must follow.
```

Run `npm run parity:write` and commit the new fixtures. Then `swift test`
(or the `swift-linux` and `ios` CI jobs) fails in the Swift test for that
function until the Swift port computes the new output. Fix the port (the
failure says which case and where the output differs), or, if you can't,
open an issue so whoever looks after the iOS app can.

Rules for generators (`cases/_helpers.js`):

- Deterministic. No `Date.now()`, `Math.random()`, network or machine locale:
  pass `now`, zones and locales in. The runner sets `TZ=UTC` and builds every
  fixture twice to catch nondeterminism.
- JSON only. `toJSON` converts Maps, Sets, Dates and undefined, and makes
  strings well-formed (a lone surrogate becomes U+FFFD, as it does when JS
  encodes it to UTF-8; Swift strings can't hold one).
- Named inputs (`{ text, max }`), so the Swift side reads `c["text"]`.
- A function that throws records `{ "$throws": message }`.
- Adversarial inputs: the web module's own tests are the best source.

## 2. The module map: nothing goes unported unnoticed

`modules/<domain>.json` lists every file under `src/` with its Swift
counterpart and status (`ported`, `partial` with a note, `exempt` with the
reason). `modules.test.js` (part of `npm test`) fails when:

- a web file is added, moved or deleted and the map doesn't say so;
- a listed Swift file is missing, or doesn't say `// Ports <web file>` in its
  header;
- an entry is `partial` or `exempt` without a reason.

So adding `src/tools/NewTool.jsx` fails CI until someone records what the
iOS app does about it.

## 3. Drift: changes the fixtures can't see

A change to copy inside a component, a layout, a flow, or a module whose
behaviour isn't fully captured by fixtures won't fail a fixture. Each mapped
entry records `synced`, a hash of the web file when its Swift port was last
brought in line. `npm run parity:drift` lists every web file changed since,
and CI turns that list into warnings on the PR and a table in the job summary.
After updating the Swift side, record it:

```bash
npm run parity:stamp -- src/tools/BestTime.jsx
```

## The surface fixtures

Some fixtures hold whole tables rather than functions, so the iOS app's
structure can't quietly fall behind:

- `api.surface`: every area and action of Virga's server (`api/*/[action].js`).
  The Swift API client must cover each one or list it as server-only.
- `core.config`: the permission groups (word for word) and the scopes.
- Route tables, the dashboard card catalog, report and tool registries,
  settings sections and the command palette's commands (the insights
  fixtures), the sign-in hosts and the terms version (the session fixtures).

## Commands

```bash
npm run parity:write        # regenerate fixtures from the web code
npm run parity:check        # what CI runs: fixtures current, map complete
npm run parity:drift        # web files changed since their Swift port was synced
npm run parity:stamp -- <file|domain>
node ios/parity/sync.mjs status
PARITY_ONLY=core.config npm run parity:write   # just one fixture
```
