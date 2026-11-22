# Where the iOS port stands, and what's left

Last updated 2026-11-22. Run `node ios/parity/sync.mjs status` for the live
count; ios/parity/modules/*.json say file by file.

## In one paragraph

The logic is most of the way there and the SwiftUI layer has begun. 120 of
the web app's 306 source files are ported and held to the web code's own
output (about 51,500 parity cases in 127 fixtures), and 32 more are partly
ported. Every Swift test passes on Linux and on an iOS Simulator (CI's
`iOS app` job, which also builds the app and runs its UI tests on an iPhone
and an iPad and keeps their screenshots). What remains of the logic is the
posting side (the composer, publishing and drafts, scheduling, the adviser,
the library) and the rest of the demo's server. The SwiftUI layer has its
foundation (the theme, the controls, the shell for a phone and for an iPad,
sign-in, the agreement and legal pages, accounts, settings, the first build
and the sync's places, the command palette); the dashboards, reports,
tools, posting and Defense screens are still to come. The only red check on
the pull request, `Parity with the web app`, is the module map refusing the
154 web files still marked `pending`. That is by design, and it goes green
when the port is complete.

## Done

| Domain | Swift target | State | Notes |
| --- | --- | --- | --- |
| core | VirgaCore | ported, audited | locale and exact Intl-style formatting, JS dates (V8's parser), URIs, JSON.parse, preferences, the sky, routes' paths, lexicon models for every record and view, identifiers, storage protocols, design tokens |
| theme | VirgaCore/Theme | ported, audited | the tokens from the CSS and a resolver, the kit's measures; `ios/DESIGN.md` for the screens, corrected by the audit |
| network | VirgaNetwork | ported, audited | HTTP, XRPC, signed-in calls through Virga's server, `VirgaBackend`, the API surface registry, Constellation, PLC, PDS resolution, blobs |
| repo | VirgaRepo | ported, audited | SHA-256, CIDs, DAG-CBOR, CAR files, MST walking, record CIDs |
| session | VirgaSession | ported, audited | accounts, scopes, health, the Terms and their agreement, sign-in a step at a time, the session controller and SessionModel (useAtprotoSession) |
| archive | VirgaArchive | ported, audited | the store over FileStore, the first build and later syncs, the analytics, periods, chart formats, follower log, sync progress, exports, ArchiveModel (useAnalyticsArchive) |
| posting-text | VirgaPosting | ported, audited | facets, links, mentions, hashtags, thread splitting, gates, embeds, compose intents, the posting events bus (mentions' default fetch still to be wired) |
| timers | VirgaPosting | ported, audited | the timer rule model and every sentence in five locales and seven zones, the lifespan editor's model; the server calls wait behind `TimerRequester` |
| templates | VirgaPosting | ported, audited | postTemplates, templateUsage, editorDrafts, templateService, TemplatesModel (useTemplates), the template editor's model |
| insights | VirgaInsights | ported, audited | routes, the dashboard catalog and layouts, registries, settings sections, the command palette's commands, lucide → SF Symbol mapping; the reports' models, chart notes and follower milestones, the share card's spec and drawing, the Interaction lookup's model |
| defense | VirgaDefense | ported, audited | bands, scoring, canary candidates, the radar's layout, the moderator's commands, plans, history, limits; harvest, scan, veto, the service calls, the page model, DefenseAccountModel and DefenseListsModel |
| demo world | VirgaDemo | ported, audited | the web harness's made-up accounts, crowd, repo, views, CAR builder and card images; the fake agent, the network router, the fake server's session, terms and proxy routes, and DemoSession, so demo mode runs the app's real session and archive |
| the SwiftUI foundation | VirgaUI | built, checked by CI (not yet audited) | the theme in SwiftUI with Instrument Sans, the controls, the phone's shell (app bar, tab bar) and the iPad's (Virga's own sidebar on the sky), the app's states, sign-in through ASWebAuthenticationSession, the agreement and legal pages, accounts and settings, the archive in the app (first build, sync status, Settings > Data with exports), the period picker, the command palette, the app's stores (UserDefaults, Application Support, the Keychain), demo mode, UI tests with screenshots |

Per-domain notes (API, gaps, deliberate differences): `ios/porting/notes/`.

## Left to do, in order

Each logic step is a port and then an independent audit (see
ios/porting/README.md); the briefs are in `ios/porting/port-wave.workflow.js`.
The order follows the dependencies between the web modules.

1. **Tidy-ups the 2026-11-21 merges left:**
   - Two ports of JavaScript's `localeCompare` grew apart in parallel: VirgaInsights' `Support/JSCollation.swift` (a table-driven ICU root, audited hard) and VirgaPosting's `Support/LocaleCompare.swift` (Foundation's ICU with a trailing tab). Move one into VirgaCore, with the `sensitivity: 'base'` mode templates need, and have both domains' fixtures pass on it.
   - Add VirgaRepo to VirgaInsights' dependencies so ReportArchive can offer `atmosphere` (notes/insights.md).
   - Wire DemoSession into VirgaUI's demo mode in place of its stub transport (notes/demo-world.md, the last section, says how), so the UI tests and screenshots show a built archive.
2. **Composer** (VirgaPosting):
   - Port `composerModel.js`, `src/posting/composer/*.js`, `autosave.js`, `settings.js`, `adviser/setup.js`, `pendingCompose.js`, `postingQueue.js`, `publishActions.js`, `repeat.js`, `images.js` and `video.js`.
   - Also wire the seams earlier waves left: `VirgaBackend` → timers' `TimerRequester`, Mentions' default fetch → VirgaNetwork, and ArchiveEnvironment.postsChanged → the posting events bus.
3. **Publishing and drafts** (needs the composer): `publish.js`, `publishRecord.js`, `linkCard.js`, `drafts/*.js`.
4. **Scheduling, adviser, library** (need 2 and 3): `src/posting/schedule/*` (the rest), `pages/scheduleModel.js`, `hubModel.js`, `postedModel.js`, `draftActions.js`; `src/posting/adviser/*`, `ui/postPreview.js`, `ui/backendAccess.js`; `src/posting/library/*` (it builds on the templates).
5. **The rest of VirgaDemo**: the rest of `fakeServer.js` (scheduling, timers, limits, the AI routes, the workers, the seeded rows) and `fakeDefense.js`, so every part of the app runs in demo mode.
6. **The SwiftUI layer, continued** (VirgaUI; `ios/DESIGN.md` is the guide, CI's `iOS app` job the compiler, its screenshots the eyes):
   - Dashboards and reports with Swift Charts, sharing a chart with `ImageRenderer` (drawShareImage over a ShareCanvas), the tools.
   - Then the composer and the posting pages, once 2 to 4 are in.
   - Then Defense and the radar.
   - The live sky (src/hillside/*, three.js on the web) last, if at all: the wash stands in for it.
   - An audit of the whole layer against the web's components and DESIGN.md.
7. **Final review**: an adversarial review of every domain against the web code, a completeness check, and a pass over `npm run parity:drift`. Then the module map has no `pending` left and `Parity with the web app` goes green.

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
- **Bugs.** `ios/porting/WEB-BUGS.md` lists 72 bugs in the web app the
  porters found and reproduced rather than fixed. Eleven are visible to people.
- **Harness limits.** The fixture writer's `toJSON` in
  `ios/parity/cases/_helpers.js` keeps a `__proto__` key since 2026-11-21
  (no fixture changed). It is still recursive, so a value nested about
  2,000 deep reads as a thrown error; that is left as it is, since Swift's
  JSONDecoder, which reads the fixtures, refuses anything nested past 512.
- **Placeholder settings.** The app's bundle identifier, team and server are
  placeholders in `ios/Config/Base.xcconfig`, and
  `public/.well-known/apple-app-site-association` names a placeholder team ID
  (`TEAMID`). Set both before a real sign-in can come back to the app.
