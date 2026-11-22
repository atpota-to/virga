# Web app bugs found while porting

The agents porting each module ran the web code and compared it with its own tests and
with what it was meant to do. These are the places where the web code does something
it plainly shouldn't. None is fixed: the web app is the reference, so the Swift port
reproduces each one (except where a note in the port says otherwise), and the parity
fixtures hold it to them. Fixing one in the web app makes its fixture stale, and
`npm run parity:write` then shows the Swift side what to follow.

Most are about inputs the app never produces itself (corrupt records, names like
`constructor` that a plain-object lookup mistakes for a table entry). A few are
visible to people: they are marked **visible**.

## Core (src/lib, src/shell/routes.js)

- src/shell/routes.js parseRoute (and posting/routes.js parsePostingRoute) call pathParts without a try/catch. pathParts uses decodeURIComponent, so an address with a malformed escape (e.g. /dashboard/% or /reports/%zz) throws URIError while rendering instead of giving the 'missing' section. Found by reading the code; pathParts('/bad/%') throwing is confirmed in core.router, but routes.js couldn't be run in plain Node.
- **visible** src/lib/time.js relativeTime returns 'just now' for any future date (a negative delta is < MINUTE), e.g. a post scheduled for next week.
- src/lib/locale.js systemLocale: `supported(`en-${region}`)` is always true (en is supported), so the check does nothing; systemLocale(['xx-YY']) returns 'en-YY'.
- src/lib/locale.js SUNDAY_REGIONS puts CN on Sunday, but the CLDR 48 week data that Intl weekInfo gives says Monday (regionWeekStart('zh') is 1 in Node). Only browsers without weekInfo use the table.
- harness/ (not src): notifications omit the lexicon-required cid and isRead, and block, listitem and threadgate records omit subject, list and post. The demo will serve shapes the real AppView/PDS never would.

## Network (src/lib/atproto.js, activity.js, constellation.js, asyncPool.js)

- src/lib/atproto.js resolvePds falls back to `services[0]?.serviceEndpoint` (any service, e.g. a notification service) and only matches the short '#atproto_pds' id, while src/session/pds.js deliberately 'never guesses from another service' and also accepts '<did>#atproto_pds'. The two disagree on the same document (fixture network.atproto resolvePds [first-service]); the Identity tool and the archive use the guessing one.
- src/lib/activity.js: lastActive's fetch has no timeout (only the caller's signal), unlike every atproto.js read, so one hung AppView request holds one of the six workers until the user cancels.
- **visible** src/lib/activity.js: the gone test /not ?found|deactivated|suspended|takendown/i never matches the AppView's error name 'AccountTakedown' ('takendown' ≠ 'takedown'); a takedown answer without 'suspended' in its message reads as not gone (fixture network.activity checkActivity [mixed], did:plc:takendown1).
- src/posting/lib/asyncPool.js: after the first rejection the other workers don't just finish their running call, they keep starting new items (fixture network.asyncPool: with fails at items 1 and 3, items 2 and 3 still run after the rejection), so e.g. publish's image uploads continue and report 'uploaded' after the publish has failed. The doc comment only promises running tasks aren't cancelled.
- src/lib/constellation.js backlinkRows returns `records`/`linking_records` whatever its type, so a non-array (e.g. a string) is spread character by character by harvest.js and analyticsSync.js.
- src/lib/atproto.js getPlcHistory puts the DID into the URL unencoded while getDidDocument encodes it (harmless for real did:plc ids).

## Archive (src/lib/analytics*.js, src/archive)

- src/lib/analyticsSync.js sweepOutbound: when the likes walk fails, the result reports `complete: true` alongside the error (the error `break`s out before `complete = complete && finished`); fixture archive.sync case likes-fail. The hook checks `error` first, so nothing shows.
- src/lib/analyticsSync.js sweepBlocks: a list name is cut with `name.slice(0, 120)` by UTF-16 unit, which can keep half of an emoji (a lone surrogate) in Lists you're on.
- src/lib/analyticsSync.js sweepBlocks: when one list check fails, Promise.all rejects and the sweep returns, but the other workers keep running and keep reporting 'check' progress, which can still move the blocks segment of the bar until the repo step begins.
- src/lib/analyticsSync.js: the Agent's reads (getFollowers, listRecords, listNotifications) get no AbortSignal, so Cancel waits for the request already out, with no limit but the Agent's own, before the sync stops.
- src/lib/analytics.js topActors: byKind is a plain object, so an event kind named like an Object.prototype member ('constructor', '__proto__') gives a garbage or missing count. Unreachable with the notification reasons the archive keeps.
- src/lib/analytics.js compactPostFromFeedItem / compactPostFromRecord: a truthy non-string uri throws (`uri.split`), ending the posts sweep with an exception rather than skipping the row. Unreachable with lexicon-valid AppView answers.
- src/archive/postChanges.js sameRow compares a row's lists with `!==`, by reference. The rows a post is noted with always come fresh from postRowsFor, so a held post noted again always reads as changed, is written again and moves `rev`. The module's own test passes only because it hands in the same object twice.
- src/archive/useAnalyticsArchive.js setFollow stamps createdAt with `new Date()` where the rest of the hook reads Date.now() (harmless; it is why the generator pins the Date constructor).
- src/lib/periods.js: a stray doc comment sits above periodLine's own (cosmetic).

## Repo (src/lib/carRepo.js, recordCid.js)

- src/lib/carRepo.js applies an MST entry's prefix length `p` (a count of UTF-8 bytes, per the MST spec and as atproto writers emit it) as a UTF-16 slice, `prevKey.slice(0, e.p)`. For a key with non-ASCII characters before the shared prefix ends, the reconstructed key is wrong, and it can contain a lone surrogate. There is no live impact, because atproto collection NSIDs and rkeys are ASCII. The Swift port reproduces the web's behaviour, and the fixture case 'key prefix splits a two-byte char' shows it.
- @atcute/cbor's encoder refuses any object with its own `constructor` member ('unsupported type: [object Object]'), because it checks `val.constructor === Object`. So computeRecordCid throws for any record that has a field named `constructor`, which a custom lexicon may legitimately have. The same check makes `{constructor, $link}` encode as a bare CID link. The Swift port matches.
- fetchRepoCar reads Content-Length with `Number(h) || null`, so it accepts '0x10' (16), '1e3', ' 42 ', '-5' and '12.5' as totals. That's harmless, because the caller falls back to its own guess.
- ios/parity/cases/_helpers.js `toJSON` (harness code, not the web app) has two flaws. It assigns `out[k] = …`, so a '__proto__' key sets the prototype instead of being kept, and fixtures silently lose that key. And it recurses, so values nested about 2000 deep record 'Maximum call stack size exceeded' as if the web function had thrown. I worked around both in my generators (kept nesting at 128 or less, dropped the __proto__ cases) and didn't edit the shared helper.

## Rich text (src/posting/lib)

- **visible** facets.js / urlMatching.js: a URL with an uppercase scheme ("see HTTPS://EXAMPLE.COM/path") gets no link facet. `/^https?:\/\//` is case-sensitive, so fullUrl becomes "https://HTTPS://…", and isValidDomain's scheme strip is case-sensitive too, so it rejects the URL. linkShortening counts it at full length for the same reason. Bluesky's own detector links it. (Confirmed in Node; the Swift port reproduces it.)
- **visible** linkShortening.js respliceFacets decodes with TextDecoder's default, which strips a leading U+FEFF. A record whose text starts with a BOM loses the BOM when a link is shortened or expanded, but its facets keep their offsets, so every facet shifts by 3 bytes. Example: shortenLinkFacets('﻿see https://example.com/a/long/path/to/somewhere', [its link facet]) gives a facet covering "mple.com/a/long/path/...". sanitizeText strips BOMs from composer text, so only records from other clients are hit.
- linkShortening.js / inlineLinks.js: a facet whose `features` is present but not an array makes shortenLinkFacets, expandLinkFacets and composerTextFromRecord throw TypeError ("facet?.features?.find is not a function"). Reopening such a record from another client would throw.
- postLink.js kindForCollection uses a plain-object lookup (KIND_BY_COLLECTION[collection]), so collection names that are Object.prototype members match. parseRecordLink('at://did:plc:x/constructor/y') returns a link whose kind is the Object constructor, with no collection and uri 'at://did:plc:x/undefined/y'.
- gates.js RULE_TYPES[rule.type] and TYPE_BY_LEXICON[rule.$type] are the same kind of plain-object lookup. gatesToRules({reply:[{type:'toString'}]}) gives threadgateAllow [{}], a rule whose $type is a function that JSON.stringify drops, so the record is malformed. gatesFromRules({allow:[{$type:'constructor'}]}) gives reply [{type: Object}].

## Timers (src/posting/timers/selfDestruct.js)

- selfDestruct.js looks keys up in plain object literals, so inherited names count as members. Affected tables: METRIC_BY_KEY, OPERATOR_BY_KEY, ALLOW_BY_KEY, COUNTED_FROM and TIMER_SLOT_FEATURE_BUCKET. Checked in node: normalizeClause({metric:'constructor', value:5}) gives {metric:'constructor', op:'gte', value:5}; an op of 'toString' is kept; describeClauses({clauses:[{metric:'toString',value:2},{metric:'likes',op:'valueOf',value:3}]}) gives '2 undefineds or undefined3 likes'; unreadableRuleParts does not flag a metric of '__proto__'; describeTimer(t, 0, {from:'constructor'}) gives 'Deletes itself 1 hour function Object() { [native code] }.'. Object.hasOwn or Maps would fix these.
- clauseCountKey reads properties of a non-object `from`: {metric:'quotes', from:'x'} gives 'quotes|function match() { [native code] }'. Normalized clauses never reach this.
- withClause(conditions, metric, null) throws "Cannot destructure property 'op' of 'patch' as it is null". The `patch = {}` default only covers undefined.
- scheduledTimerProblem calls describeDeleteAt(deleteAt) with no `now`, and so do scheduledTimerToSend and scheduledRowTimerProblem through it. The pinned time is therefore said against Date.now() even when the caller has a `now`: editorNotes takes `now` but its pin sentence still reads the real clock.

## Routes and dashboards (src/posting/routes.js, src/dashboards/layouts.js)

- src/posting/routes.js parsePostingRoute looks pages up in a plain object (`!POSTING_PAGE_BY_KEY[page]`), so names inherited from Object.prototype count as pages. parseRoute('/posting/constructor') gives {section:'posting', page:'constructor', id:null}; the same happens for '__proto__', 'toString', 'hasOwnProperty' and the like. Confirmed by running the web code. Fix: Object.hasOwn.
- src/dashboards/layouts.js sanitizeLayout does the same lookup with `TEMPLATES[d.template]` and `widgets[w.type]`. A stored layout with template 'constructor' and a card of type 'toString' survives sanitizing unchanged. resetDashboard on that dashboard then throws "Cannot read properties of undefined (reading 'map')", and dashboardFromTemplate('constructor') throws the same.
- src/dashboards/layouts.js dashboardFromTemplate records `template: key` even when it fell back to the overview because the key is unknown. So addDashboard(layout, { template: 'nope' }) stores template 'nope', and resetDashboard on it throws "Cannot read properties of undefined (reading 'widgets')". The UI only offers known templates, so this is low severity.

## Defense (src/defense)

- **visible** src/defense/plan.js estimateWords writes minutes in the active locale (fmtInt) but hours with toFixed(1), so en-DE shows grouping in its locale's style but always a '.' decimal point (for example 'about 3.5 hours').
- src/defense/dmMessage.js composeMessage, through command.js facetLinks and facetMentions, throws a TypeError ('not iterable') when a message's facets or a facet's features is an object or a number rather than an array. The worker would fail on such a malformed DM instead of reading it as having no facets.
- src/defense/scanStore.js startScan: the `if (controller.signal.aborted) set(did, IDLE)` branch can never run, because stopScan, a new startScan and resetScansForTests all remove the controller before aborting it, so current() is already false. It is harmless dead code.
- src/defense/command.js parseActor's DID pattern (/^did:[a-z]+:[a-zA-Z0-9._%-]+$/) rejects colons in the identifier, so a did:web with a path (did:web:example.com:user) is not read as an account. harvest.js's DID_SYNTAX accepts it.

- src/defense/useDefense.js useDefenseLists: refresh() doesn't advance seq when there is no requester, so if the account changes to one without a long session while an earlier read is in flight, that read still has the latest seq and sets the previous account's lists.
- src/defense/scan.js canaryCandidates: `followers.map((f) => f.did)` throws a TypeError on a null entry, though `following` (`!f?.did`) and `inbound` (`e?.did`) tolerate nulls.
- src/defense/harvest.js drainSource: a source whose page has `records` (or `linking_records`) that is an object, a number or true makes `rows.push(...)` throw, failing the whole harvest rather than marking that one source failed (the harvest-level effect of constellation.js backlinkRows, under Network).
- src/defense/harvest.js drainSource: `(await read()) ?? ...` asks again only when a page is null or undefined; a page that parsed to false, 0 or '' counts as a failed source without the second try.
- src/defense/veto.js followedNow: a relationship row for a DID that wasn't asked about, with `following` set, is still added to the result, although the doc says 'Of `dids`' (harmless in vetoed, which reads only the DIDs it asked about).
- **visible** src/defense/defenseService.js createList and planAndApprove: when the server's 200 answer isn't JSON (the requester returns null), `data(...).list` and `plan.planId` throw "Cannot read properties of null (reading 'list')", and defenseErrorMessage shows that to the person.

## Session and sign-in (src/session, src/signin)

- **visible** src/signin/identity.js normalizeSignInInput decodes a pasted bsky.app profile link before it checks whether the result is an address, so `https://bsky.app/profile/https%3A%2F%2Fevil.example` becomes `https://evil.example` and is read as a host address: a link that looks like a Bluesky profile starts a sign-in at another host. The card shown before leaving does name that host. Reproduced in Node (fixture session.signin).
- src/session/sessionHealth.js createSessionChecker always waits CONFIRM_GAP_MS (2.5 s) after a definitive first answer, even with `rounds: 1`, so a browser session the library can't restore is reported as expired 2.5 s late, with no further probe in between.

## Composer and posting (src/posting/lib, src/posting/composer, src/posting/schedule, src/posting/settings.js)

- **visible** src/posting/lib/video.js pollVideoJobStatus resets `consecutiveFailures` as soon as an answer parses as JSON, before checking `response.ok` or the job-status shape, so a video service that answers 500 with JSON (or JSON without a job status) is polled every pollInterval×2 until the 30-minute maxPollTimeMs instead of giving up.
- **visible** src/posting/composer/submit.js whenWords: 'tomorrow' is now + 24 hours, not the next calendar day, so it misses across a clock change (at 23:30 on the eve of New York's spring-forward day, a post at 10:00 the next day reads 'Sun, Mar 8 at 10:00 AM').
- src/posting/schedule/repeat.js repeatProgress/repeatSummary (shortDate) and postingQueue.js resolveTimezone/dayDiff read the device's clock or zone directly (`new Date().getFullYear()`) even where the caller passes a `now`.
- src/posting/schedule/postingQueue.js tzOffsetMs reads the wall clock back through formatToParts and Date.UTC, so instants before the year 100 come out centuries off (zonedWallTimeToUtc('0050-06-01','12:00','UTC') is 1950-06-01T12:00Z), and zonedWallTime near the end of time gives 'NaN-NaN-NaN'.
- src/posting/lib/video.js videoLimitMessage, src/posting/settings.js writePostingSettings (CHECKERS[key]) and the language and noun tables are plain-object lookups, so a key named after an Object.prototype member returns a function or writes a 'constructor' member into the stored settings.
- src/posting/adviser/analysis.js applyWritingFixesToThread throws a TypeError for a thread with a null post once any fix applies.
- src/posting/composer/actions.js postFacts and src/posting/autosave.js serializePost throw a TypeError on a post whose `images` is a non-array truthy value; hasAutosaveContent counts a string `images` or `tags` as content.

## Library (src/posting/library)

- **visible** src/posting/library/model.js isOwnThreadRow vs isOwnThreadPost: an archive row is on Your posts when its parent is the account's, but the author-feed fallback needs both root and parent to be the account's, so a reply to your own comment inside someone else's thread is on Your posts from the archive and on Your replies from the author feed.
- src/posting/library/useLibrary.js, model.js libraryContext/asTemplateContext and libraryUi.js templateContextFrom pass no locale to buildTemplateContext, so `{{today}}` in a template used from the library is written in the browser's locale; rankTemplatesForSlash sorts in the browser's locale too.
- src/posting/library/model.js suggestItems and attachmentsFromState, and sources.js goneError, are plain-object lookups: a record kind 'constructor' is labelled "function Object() { [native code] } by @…".

## Templates (src/posting/templates, src/posting/library/templateEditorModel.js)

- **visible** src/posting/templates/postTemplates.js wordsOf/keywordMatches: the WORDS regex `/[\p{L}\p{N}](?:[\p{L}\p{N}']*[\p{L}\p{N}])?/gu` has no `\p{M}`, so a word splits at every combining mark: a keyword typed with a decomposed accent ('élise') matches the text 'e lise' and not 'élise', and Devanagari keywords split at their vowel signs.
- **visible** src/posting/library/templateEditorModel.js editorHasChanges compares JSON.stringify text. TemplateEditor.jsx builds an attached record as `{uri, cid}`, but a record read back from the PDS arrives as `{cid, uri}`, so re-picking the same quoted post asks 'Discard your changes?'.
- src/posting/templates/templateUsage.js sortTemplatesForShelf and templateService.js compareTemplates call `localeCompare(…, undefined, …)`, the browser's locale, not activeLocale() as the rest of the app does (the same pattern as slotLabel's).
- src/posting/templates/templateUsage.js sanitize does `out[rkey] = …` on a plain object, so a stored `"__proto__"` entry becomes the counts object's prototype; recordTemplateUse('__proto__') counts on from it but never writes it back. templateService.js readCache/fetchAll has the same pattern.

## Reports, sharing and tools (src/reports, src/share, src/tools)

- **visible** src/reports/annotations.js cleanAnnotations cuts a label with `.slice(0, 80)` by UTF-16 unit, which can split an emoji: half a surrogate pair is stored and the note shows a replacement character.
- src/share/shareSpec.js canShare/shareSpec: BUILDERS and SAME_AS are plain objects, so canShare('constructor') (and 'toString', '__proto__') is true, and shareSpec('constructor', archive, …) returns the archive itself spread as a spec. Card types come from the catalog, so this is unreachable in the app.
- src/tools/interactionModel.js: plain-object lookups give eventPhrase({ dir: 'in', kind: 'toString' }) a function instead of '', and totalsOf concatenates strings for a kind named 'constructor'.
- src/tools/interactionModel.js dated/eventsWith: dated() accepts any finite number as a time, but `new Date(atMs).toISOString()` throws RangeError outside Date's range, so one stored event with a numeric `at` such as 1e300 makes the whole lookup throw (the sync writes ISO strings).
- src/reports/models.js cached: the key holds the locale and week start but not the time zone, so after a change of zone with a page open, buckets stay in the old zone until the archive's revision moves.

## Virga's server (server/)

- server/oauth/handlers/proxy.js forwardedQuery fills a plain `{}` and tests `key in params`, which also sees inherited keys: a query param named after an Object.prototype key (toString, constructor, valueOf) is forwarded as `[<function>, value]`, which JSON writes as `[null, value]`, and `__proto__=x` swaps the params object's prototype for an array.

## Stylesheets and components

- **visible** src/styles/theme.css draws the high-contrast ink ring round the narrow tab bar's current-tab disc only under @media (max-width: 374px). Its own comment says the ring is for when the current tab is a disc with its name hidden. src/shell/shell.css hides the name and makes the disc from (max-width: 429px), and README says 'from 430px wide; narrower, it is a tinted disc'. So in high contrast, between 375 and 429 px the current tab is a pale disc with no ring and no word to underline, which is the case the rule was written to fix. The query should probably be (max-width: 429px). DESIGN.md tells the app to follow the stylesheet until this is settled.
- src/components/Figures.jsx has stale comments. Its doc says 'The label sits below the number', and the inline JSX comment says 'the stylesheet sets the numeral above it'. But controls.css orders .figures-label 1, .figures-value 2, .figures-note 3, so the label renders above the number (controls.css's own comment says 'label, number, note'). DESIGN.md follows the stylesheet.

## The harness (harness/), not shipped

- harness/world.js buildCast: cast[30] gets the same handle as cast[0], 'ana.example.com', because the test is `i > FIRST.length` where it should be `>=`. byHandle keeps the later one, so resolveHandle('ana.example.com') and person('ana.example.com') find cast[30], not cast[0].
- harness/repo.js looks collections up with `ARRAYS[collection]`, which also finds keys of Object.prototype. A collection named 'toString', 'constructor', '__proto__', 'valueOf' and so on makes listCollection, readRecord and writeRecord throw 'world[ARRAYS[collection]] is not iterable', and removeRecord throw "Cannot read properties of undefined (reading 'length')", instead of acting as an empty collection. `Object.hasOwn(ARRAYS, collection)` or a Map would fix it. The port reproduces the errors.
- harness/buildCar.js counts the shared MST key prefix (`key[p] === prevKey[p]`, `key.slice(p)`) in UTF-16 code units, but the spec counts UTF-8 bytes. It's harmless while keys are ASCII. A key that isn't gives a tree a spec reader decodes to different keys, and a prefix that splits a surrogate pair turns into U+FFFD.
- harness/views.js embedView throws a TypeError ('(embed.images || []).map is not a function', and the same for items) for a truthy images or items value that isn't an array. One such record in a world makes postView, authorFeed and searchPosts fail as a whole. placeholderImage (through hashOf) also throws 'text.charCodeAt is not a function' for a non-empty array `$link`.
- harness/views.js: recordView, threadView and listView call postView or listView without passing `now`, so an embedded or threaded written post's live counts, and the date of a list someone else made, read Date.now() even when the caller gave its own `now`.
- harness/views.js threadView doesn't check for cycles: a post whose reply parent is itself climbs the full 80 levels of the same parent.
- harness/fakeXrpc.js applyWrites is not all-or-nothing for a write whose value is missing: the up-front checks pass, earlier writes land, then writeRecord throws 'A record is required'.
- harness/fakeXrpc.js scopesFor runs before applyWrites' own validation, so a truthy non-array `writes` fails with a TypeError (a 500 through a proxy) instead of the method's 400.
- harness/fakeXrpc.js getRecord's RecordNotFound message names the agent's own DID even when another repo was read.
- harness/fakeXrpc.js looks methods up with `methods[nsid]` on a plain object, so handle('toString') answers "[object Undefined]" and handle('constructor', x) echoes x where MethodNotImplemented was meant.
- harness/fakeXrpc.js updateDraft with no draft.draft answers success and wipes the stored draft's body; createBookmark with no uri stores `{uri: undefined}`.
- harness/fakeNetwork.js Constellation: for a subject that is neither an account nor one of their lists, the fallback world is list[0] (Mira), so getManyToMany for an unknown DID answers Mira's lists.
- harness/fakeServer.js settleTimer counts a failed timer's last attempt twice (Object.assign sets attempts+1, then resolve('failed') adds 1 again), so a timer that gives up reads attempts 6 of maxAttempts 5; and it never clears last_error once a timer succeeds.
- harness/fakeServer.js: a JSON null body gives a 500 INTERNAL on /api/schedule/update, /reorder, /cancel, /api/self-destruct/create and /cancel, and the AI routes, because `{ body = {} }` only defaults undefined.
- harness/fakeServer.js /api/schedule/create passes the request body straight to validateCreate, so a client's `occurrence` anchors the repeat rule at that number; validateRepeat checks `until` with a bare date pattern, so '2026-02-31' is accepted.
- harness/fakeServer.js ALLOW_WORDS, stashMedia's map and /api/schedule/media's out are plain objects (Object.prototype names pass as allow words; a '__proto__' media id vanishes), and stashed bytes that aren't base64 leave lastErrorCode as the number 5.
- harness/fakeDefense.js nextKey() mints from Date.now() rather than the injected `now`, and run() lets an add job whose decisions were all undone take its holder's one batch for the tick.
