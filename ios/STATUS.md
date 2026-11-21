# Where the iOS port stands, and what's left

Last updated 2026-11-21. Run `node ios/parity/sync.mjs status` for the live
count; ios/parity/modules/*.json say file by file.

## In one paragraph

The foundation is in and green everywhere it can be checked. The harness that
ties the iOS app to the web app works: fixtures written by the web code, a map
of every web file, a drift report, and three CI jobs. On top of it, 67 of the
web app's 306 source files are ported and held to the web code's own output
(about 34,500 parity cases), and 13 more are partly ported. Every Swift test
passes on Linux and on an iOS Simulator (CI's `iOS app` job), and the app
target builds, launches and passes its own tests. What remains is most of
the posting side, the archive, and all the SwiftUI screens. The only red check
on the pull request, `Parity with the web app`, is the module map refusing
226 web files still marked `pending`. That is by design, and it goes green
when the port is complete.

## Done

| Domain | Swift target | State | Notes |
| --- | --- | --- | --- |
| core | VirgaCore | ported, audited | locale and exact Intl-style formatting, JS dates (V8's parser), URIs, JSON.parse, preferences, the sky, routes' paths, lexicon models for every record and view, identifiers, storage protocols, design tokens |
| network | VirgaNetwork | ported, audited | HTTP, XRPC, signed-in calls through Virga's server, `VirgaBackend`, the API surface registry, Constellation, PLC, PDS resolution, blobs |
| repo | VirgaRepo | ported, audited | SHA-256, CIDs, DAG-CBOR, CAR files, MST walking, record CIDs |
| posting-text | VirgaPosting | ported, audited | facets, links, mentions, hashtags, thread splitting, gates, embeds, compose intents, the posting events bus (mentions' default fetch still to be wired) |
| timers | VirgaPosting | ported, audited | the timer rule model and every sentence in five locales and seven zones, the lifespan editor's model; the server calls wait behind `TimerRequester` |
| insights (tables) | VirgaInsights | ported, audited | routes, the dashboard catalog and layouts, registries, settings sections, the command palette, lucide → SF Symbol mapping |
| defense (engine) | VirgaDefense | ported, audited | bands, scoring, canary candidates, the radar's layout, the moderator's commands, plans, history, limits |
| session | VirgaSession | ported, **not audited** | accounts, scopes, health, the Terms and their agreement, sign-in, the session controller and model, all from a run cut off by a billing error. Every test passes, but no auditor has checked it, and `sessionController.js` and `useAtprotoSession.jsx` are still `pending` in the map |
| theme | VirgaCore/Theme | ported, audited | the tokens from the CSS and a resolver, the kit's measures; `ios/DESIGN.md` for the screens, corrected by the audit |
| demo world | VirgaDemo | ported, audited | the web harness's made-up accounts, crowd, repo, views, CAR builder and card images, for previews, demo mode and UI tests |

Per-domain notes (API, gaps, deliberate differences): `ios/porting/notes/`.

## Left to do, in order

Each step is a port and then an independent audit (see ios/porting/README.md).
The order follows the dependencies between the web modules.

1. **Finish what was cut off.**
   - Session: finish the port of `sessionController.js` and `useAtprotoSession.jsx`, then audit the whole domain.

   The briefs are in `ios/porting/port-wave.workflow.js`; the last arguments
   used are described in ios/porting/README.md.
2. **Archive** (VirgaArchive): `src/lib/analytics*.js`, `periods.js`, `charts/format.js`, `followerLog.js`, `syncProgress.js`, `src/archive/*`. The store goes over `FileStore`, the sweeps over the XRPC client, and `useAnalyticsArchive` becomes an `ArchiveModel`.
3. **Composer** (VirgaPosting):
   - Port `composerModel.js`, `src/posting/composer/*.js`, `autosave.js`, `settings.js`, `adviser/setup.js`, `pendingCompose.js`, `postingQueue.js`, `publishActions.js`, `repeat.js`, `images.js` and `video.js`.
   - Also wire the seams earlier waves left: `VirgaBackend` → timers' `TimerRequester`, and Mentions' default fetch → VirgaNetwork.
4. **Rest of Defense**: `harvest.js`, `scan.js`, `veto.js`, `publicRelationships` in `score.js`, `defenseService.js`, `useDefense.js`, `pageModel.js`.
5. **Templates**: `src/posting/templates/*.js`, `library/templateEditorModel.js`.
6. **Rest of insights** (needs the archive): `reports/models.js`, `annotations.js`, `useAnnotations.js`, `share/shareSpec.js`, `share/chartImage.js` (layout maths), `tools/interactionModel.js`.
7. **Publishing and drafts** (needs the composer): `publish.js`, `publishRecord.js`, `linkCard.js`, `drafts/*.js`.
8. **Scheduling, adviser, library** (need 3, 5 and 7): `src/posting/schedule/*` (the rest), `pages/scheduleModel.js`, `hubModel.js`, `postedModel.js`, `draftActions.js`; `src/posting/adviser/*`, `ui/postPreview.js`, `ui/backendAccess.js`; `src/posting/library/*`.
9. **The rest of VirgaDemo**:
   - Port `fakeXrpc.js`, `fakeNetwork.js`, `fakeServer.js` and `fakeDefense.js` behind `MockTransport`, so the whole app runs in demo mode.
   - Port `fakeSession.jsx`, so the UI tests can drive it.
10. **The SwiftUI layer** (VirgaUI, wave 4; 136 `.jsx` and stylesheet files). Build it in this order:
    - The theme in SwiftUI, the components, the shell (tab bar on a phone, sidebar on an iPad), sign-in with `ASWebAuthenticationSession`, the agreement screen, the legal pages, accounts, settings.
    - Then dashboards and reports with Swift Charts, sharing a chart with `ImageRenderer`, tools.
    - Then the composer and posting pages.
    - Then Defense and the radar.

    `ios/DESIGN.md` is the guide. SwiftUI can't be compiled on Linux, so this
    wave is checked by CI's `iOS app` job, and its UI tests run against the
    demo world.
11. **Final review**: an adversarial review of every domain against the web code, a completeness check, and a pass over `npm run parity:drift`. Then the module map has no `pending` left and `Parity with the web app` goes green.

## Things a future session should know

- **Toolchain.** Logic targets build with any Swift 6 toolchain:
  `ios/scripts/install-swift-linux.sh` installs the pinned one (6.4.2) on
  Linux. CI builds with Xcode 26.6 (Swift 6.2), which is stricter in ways
  Linux can't show. `ios/PORTING.md` lists every one CI has found:
  - `noasync` APIs inside async code;
  - `NSString` dropping a leading U+FEFF;
  - 512 KB thread stacks, so no deep recursion;
  - a type checker that gives up on long `#expect` expressions.
- **Strings compare by UTF-16 code unit** (`jsEquals`, `JSKey`), not Swift's
  canonical equivalence, and `Parity.diff` holds tests to that.
- **The worktrees and branches** used during the port (`.worktrees/*`,
  `ios/w*`) were local to that session and aren't needed: everything finished
  is merged into this branch.
- **Interruptions.** Agents were cut off three times by usage or billing
  limits. Keep the rule in the briefs: commit after every module or two, and
  commit what an interrupted agent left as `WIP: …` for the next one to pick
  up.
- **Fixtures** live in the repository (about 22 MB). Keep new ones under
  about 1 MB each.
- **Bugs.** `ios/porting/WEB-BUGS.md` lists 39 bugs in the web app the
  porters found and reproduced rather than fixed. Six are visible to people.
- **Harness limits.** The fixture writer's `toJSON` in
  `ios/parity/cases/_helpers.js` keeps a `__proto__` key since 2026-11-21
  (no fixture changed). It is still recursive, so a value nested about
  2,000 deep reads as a thrown error; that is left as it is, since Swift's
  JSONDecoder, which reads the fixtures, refuses anything nested past 512.
- **Placeholder settings.** The app's bundle identifier, team and server are
  placeholders in `ios/Config/Base.xcconfig`, and
  `public/.well-known/apple-app-site-association` names a placeholder team ID
  (`TEAMID`). Set both before a real sign-in can come back to the app.
