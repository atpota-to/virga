# Where the iOS port stands, and what's left

Last updated 2026-11-22. Run `node ios/parity/sync.mjs status` for the live
count; ios/parity/modules/*.json say file by file.

## In one paragraph

Every logic domain of the web app is ported and audited, and the SwiftUI
layer is built and audited. Of the web app's 306 source files, 269 are
ported and 37 partly; none is still to do, so `Parity with the web app` is
green (since CI run 64). A file stays "partial" where the web leans on
something iOS has no counterpart for, or where a piece is knowingly left
out; its entry in ios/parity/modules/*.json says which. The logic is held
to the web code's own output by about 65,000 parity cases in 173 fixtures.
Every Swift test passes on Linux and on an iOS Simulator (CI's `iOS app`
job, which also builds the app and runs its UI tests on an iPhone and an
iPad and keeps their screenshots). Two independent audits of the SwiftUI
layer against the web found 189 differences in the stable parts and 187
in the posting screens; all were fixed and merged by 2026-11-22. The
posting fixes were pushed at 8f429f5 and hadn't yet been through CI's
compiler when this was written, so expect a round of compile fixes there.

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
| library | VirgaPosting | ported, audited | the library's model, sources, store, LibraryModel (useLibrary) and its UI helpers; one port of localeCompare for the whole app in VirgaCore (JSCollation) |
| insights | VirgaInsights | ported, audited | routes, the dashboard catalog and layouts, registries, settings sections, the command palette's commands, lucide → SF Symbol mapping; the reports' models, chart notes and follower milestones, the share card's spec and drawing, the Interaction lookup's model |
| composer | VirgaPosting | ported, audited | composerModel, the composer's modules, autosave, posting settings, the posting queue and repeats, images and video (the pixel work behind ImageEncoder), loaders, pendingCompose, the adviser's setup and analysis; the seams to VirgaBackend's timers, Mentions' fetch and the archive's postsChanged |
| publishing and drafts | VirgaPosting | ported, audited | publish.js, publishRecord.js (idempotent writes with their gates), linkCard.js, drafts.js (Bluesky's drafts through the AppView) and draftMedia.js over FileStore |
| scheduling | VirgaPosting | ported, audited | scheduleSerialize, scheduleService over VirgaBackend, scheduledPostError, the queue's calendar, reorder and suggestions, and the posting pages' models (scheduleModel, hubModel, postedModel, draftActions) |
| the post adviser | VirgaPosting | ported, audited | the AI service and its limits, the read's context and gate, the gate controller, the sheet, alt text and its follow-ups, learning the writer's style, AdviserGateModel and AdviserReadModel, post previews and backend access |
| defense | VirgaDefense | ported, audited | bands, scoring, canary candidates, the radar's layout, the moderator's commands, plans, history, limits; harvest, scan, veto, the service calls, the page model, DefenseAccountModel and DefenseListsModel |
| demo world | VirgaDemo | ported, audited | the web harness's made-up accounts, crowd, repo, views, CAR builder and card images; the fake agent, the network router, every route of the fake server and of fakeDefense, the workers, and DemoSession, so demo mode runs the whole app against the made-up world |
| the SwiftUI layer | VirgaUI | built, audited, checked by CI | the theme with Instrument Sans, the controls, the phone's and the iPad's shells, the app's states, sign-in, the legal pages, accounts and settings, the archive in the app, the command palette, the dashboards and reports with Swift Charts, sharing a chart, the tools, Defense and its radar, the composer with publishing, drafts, link cards, templates, the library, the post adviser, scheduling and its timer, Settings › Posting, the posting pages (the overview, Drafts, Posted, Scheduled posts, the weekly schedule, Timers), the live sky in Metal (VirgaCore/Hillside held to the web's scene by fixtures), the app's stores, demo mode, UI tests with screenshots on an iPhone and an iPad |

Per-domain notes (API, gaps, deliberate differences): `ios/porting/notes/`.

## Left to do, in order

Each logic step is a port and then an independent audit (see
ios/porting/README.md); the briefs are in `ios/porting/port-wave.workflow.js`.
The order follows the dependencies between the web modules.

1. ~~**Tidy-ups the 2026-11-21 merges left**~~ Done on 2026-11-22: one localeCompare in VirgaCore, VirgaInsights on VirgaRepo, demo mode on DemoSession.
2. ~~**Composer**~~ Done on 2026-11-22 (notes/composer.md).
3. ~~**Publishing and drafts**~~ Done on 2026-11-22 (notes/publish.md).
4. ~~**Scheduling and the adviser**~~ Done on 2026-11-22 (notes/scheduling.md, notes/adviser.md).
5. ~~**The rest of VirgaDemo**~~ Done on 2026-11-22 (notes/demo-world.md).
6. ~~**The SwiftUI layer, continued**~~ Built and audited on 2026-11-22 (VirgaUI; `ios/DESIGN.md` is the guide, CI's `iOS app` job the compiler, its screenshots the eyes). Dashboards, reports, sharing a chart, the tools, Defense and the radar, the composer with everything it sends, the posting pages with scheduling and timers, Settings › Posting, and the live sky in Metal are all in. Both audits (189 and 187 confirmed differences) are fixed. What is knowingly not done, with the reasons in each file's module map entry and in notes/ui.md:
   - dragging dashboard cards (Customize uses the web's phone and keyboard path, up and down, at every width), and the wide screen's grid of chosen cards with the library beside it;
   - "Keep it when space runs low" (iOS asks nothing like the browser's storage prompt).
7. **Final review** (still to do): an adversarial review of every domain against the web code, a completeness check, a pass over `npm run parity:drift`, and a look through the screenshots of every screen on both devices once CI is green on the posting fixes.

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
- **Fixtures** live in the repository (about 53 MB in 173 files; the
  largest, timers.fuzz.json, is 1.9 MB). Keep new ones under about 1 MB
  each.
- **Bugs.** `ios/porting/WEB-BUGS.md` lists 107 bugs in the web app the
  porters found and reproduced rather than fixed. Twenty are visible to people.
- **Harness limits.** The fixture writer's `toJSON` in
  `ios/parity/cases/_helpers.js` keeps a `__proto__` key since 2026-11-21
  (no fixture changed). It is still recursive, so a value nested about
  2,000 deep reads as a thrown error; that is left as it is, since Swift's
  JSONDecoder, which reads the fixtures, refuses anything nested past 512.
- **Placeholder settings.** The app's bundle identifier, team and server are
  placeholders in `ios/Config/Base.xcconfig`, and
  `public/.well-known/apple-app-site-association` names a placeholder team ID
  (`TEAMID`). Set both before a real sign-in can come back to the app.
