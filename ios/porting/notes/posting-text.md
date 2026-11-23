# posting-text: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited.
Parity cases at port time: 5483, plus 85 added by the audit.
Tests at the time: All four checks pass at HEAD 9ee1e37 on ios/w1-b:

## API for the code that builds on it

Target VirgaPosting, files under ios/VirgaKit/Sources/VirgaPosting/. Package.swift: VirgaPosting also depends on VirgaRepo; that is the only manifest change.

CONVENTIONS
- Each web module is a caseless enum with the web's function names, as static funcs.
- Every index is a UTF-16 code unit offset; facet offsets are UTF-8 bytes.
- Strings from outside the code compare by code unit (VirgaCore jsEquals, JSKey, jsIncludes).
- Typed facets use VirgaCore.Facet, FacetFeature and StrongRef.
- Lexicon objects the web builds (embeds, gate rules, reply refs, records) are JSONValue with exactly the web's keys. A missing value is left out, as JSON.stringify drops undefined.
- Where the web accepts loose input, there is a JSONValue overload next to the typed one.
- Clocks are injected (`now` closures returning epoch ms, or `nowMs`). Network I/O is an injected closure or protocol.
- Errors carry the web's messages through LocalizedError.errorDescription.
- Reuse these; don't redefine them.

LIMITS
- Lib/PostingLimits.swift: `enum PostingLimits { maxPostGraphemes = 300, maxPostBytes = 3000 }`. The values come from composerModel.js; the composer port should reuse them.

RICH TEXT
- Lib/RichText.swift `enum RichText`:
  - createByteMap(_ String) -> [Int], createByteMap(units:[UInt16])
  - byteToCharIndex(_ [Int], _ Int) -> Int
  - utf8Length(_ String?) -> Int
  - hasStrippedControlCharacter(_ String) -> Bool
  - sanitizeText(_ String?) -> String
  - safeExternalUrl(_ String?) and (_ JSONValue?) -> String?
- Lib/Mentions.swift `enum Mentions`:
  - findMentions(_ String) -> [MentionMatch{start,end,handle,email}]
  - detectPartialMention(_ text, _ cursor:Int) -> PartialMention?{start,end,query,fullText}
  - detectCompletedMentions(_ text, _ cursor) -> [CompletedMention]
  - createMentionFacet(did:start:end:byteMap:) -> Facet? (nil when an index is outside the map)
  - isValidHandle(_ String?) -> Bool (VirgaCore Handle.isValidHandle)
  - debounce<V: Sendable>(_ fn, _ Duration) -> @Sendable (V) -> Void
  - createMentionResolver(fetch: MentionFetch?, appview:, ttlMs:, timeoutMs:, now:) -> ResolveMention:
    - Concurrent asks share one request.
    - A DID, or a 400, is cached for the TTL; a failure or a timeout is not.
    - A timeoutMs a browser's AbortSignal.timeout refuses (not finite, negative, past 2^53-1) makes every lookup throw MentionTimeoutError, with Node's RangeError text (numbers past 2^32 separated as Node writes them).
  - `static let resolveMention: ResolveMention` is the shared resolver. `static let defaultFetch: Locked<MentionFetch?>` is its fetch, which VirgaUI's AppModel.init sets at launch with Mentions.useNetwork(transport:) (VirgaPosting/Wiring.swift).
  - `typealias MentionFetch = @Sendable (String) async throws -> MentionFetchResponse(status:Int, body:Data)`
  - `typealias ResolveMention = @Sendable (String) async throws -> String?`
- Lib/Hashtags.swift: `Hashtags.findHashtags(_ String?) -> [HashtagMatch{start,end,tag}]`, `isValidHashtag(_ String?)`, `maxHashtagGraphemes`.
- Lib/UrlMatching.swift `enum UrlMatching`:
  - findUrlsAndMentions(_ String) -> UrlsAndMentions{urls:[UrlMatch{charStart,charEnd,matchText,rawEnd}], mentions:[MentionMatch]}
  - trimUrlMatch, isValidDomain(_ String) -> Bool, isPrecededByQuote(_ text, _ charStart) -> Bool
  - urlPattern (an ICU pattern), urlRegexMatches(_ text) -> [String]
- Lib/PostLink.swift `enum PostLink` (AT_URI is VirgaCore's AtUri(_:)):
  - recordCollections: [String:String], kindForCollection(_ String?) -> String?
  - parseRecordLink(_ String?) -> RecordLink?{kind,collection,actor,did?,handle?,rkey,url,uri?}
  - parsePostLink -> PostLinkRef?{actor,did?,handle?,rkey}
  - recordUri(_ did, _ kind, _ rkey) throws(PostLinkError) -> String
  - parseRecordUri(_ String?) -> RecordURIParts?{kind,did,collection,rkey}
  - bskyUrlFor(_ uri, _ actor?) -> String?
  - detectPostLink(_ String?) -> DetectedPostLink?{type:"bluesky",linkType,handle,postId?/feedId?/listId?/packId?,url; .rkey}

FACETS
- Lib/Facets.swift `enum Facets`:
  - detectFacets(_ String?, _ DetectFacetsOptions = .init()) async -> FacetDetection{facets:[Facet], postEmbeds:[PostEmbedCandidate], externalLinks:[ExternalLinkCandidate{url,charStart,charEnd,byteStart,byteEnd}], displayText:String?, markdownLinks:[JSONValue]}
  - detectAndCreateFacetsOptimized(_ text, _ skip:Bool, _ validated:Set<String>, _ invalidated:Set<String>, resolveMention:, validationCache:, now:) async
  - DetectFacetsOptions(resolveMention:, skipMentionResolution:, validatedHandles:, invalidatedHandles:, validationCache: MentionValidationCache = .shared, now: @Sendable () -> Double). Set membership is by code unit.
  - `final class MentionValidationCache: Sendable` (.shared, ttlMs = 300000; get/set/removeAll; keyed by code unit) is the web's module-level Map. Tests should pass a fresh one.
  - Distinct handles resolve in parallel in a TaskGroup, so the order resolvers start in is not guaranteed.
- Lib/LinkShortening.swift `enum LinkShortening`:
  - toShortUrl(_ String) -> String
  - findShortenableLinks(_ String?) -> [ShortenableLink{charStart,charEnd,matchText}]
  - shortenPostText, countPostGraphemes
  - respliceFacets(_ text, _ [JSONValue]?, (String, JSONValue) -> String?) -> FacetedJSON{text,facets}, plus a typed form ([Facet]?, (String, Facet) -> String?) -> FacetedText{text,facets}
  - shortenLinkFacets / expandLinkFacets, each in a [JSONValue]? -> FacetedJSON and a [Facet]? -> FacetedText form
- Lib/InlineLinks.swift `enum InlineLinks`:
  - linkDestination(_ String?) -> String?, isSingleAddress(_ String?) -> Bool, labelMisleads(_ label?, _ uri) -> Bool
  - findInlineLinks(_ String?) -> [InlineLink{start,end,labelStart,labelEnd,label,uri,misleading; .span}]
  - collapseInlineLinks -> CollapsedText{text, links:[CollapsedLink{charStart,charEnd,label,uri}]}
  - applyInlineLinks(_ text, _ [InlineLinkSpan], _ FacetDetection?) -> InlineLinkFacets{facets,postEmbeds,externalLinks}, plus a facets:/postEmbeds:/externalLinks: form. Spans outside the text are skipped.
  - detectComposerFacets(_ text?, _ options) async -> ComposerFacetDetection{text,facets,postEmbeds,externalLinks,displayText,markdownLinks}
  - composerCountText(_ String?) -> String, countComposerGraphemes(_ String?) -> Int
  - composerTextFromRecord(_ text?, _ [JSONValue]? or [Facet]?) -> String
- Lib/Tags.swift `enum Tags`:
  - normalizeTags(JSONValue?, String? or [String]) -> [String]
  - formatTags([String]? or JSONValue?) -> String
  - maxTags 8, maxTagGraphemes 64, maxTagBytes 640

THREADS
- Lib/ThreadSplit.swift `enum ThreadSplit`:
  - splitIntoThread(_ text?, limit:Int=300, numbering: ThreadNumbering(.off/.counter)=.off, maxPosts: Double = .infinity, before:Int=0, after:Int=0) -> [String]
  - joinThread(_ [String]?, numbering:) -> String
  - readCounter(_ String?) -> ThreadCounter?{number,total,body}, stripCounter
  - threadNumbering(_ [String]?) -> ThreadNumberingState(.none/.current/.stale)
  - renumberThread(_ [String]?) -> [String]
  - threadNumberingOptions is THREAD_NUMBERING, renamed because threadNumbering is a function.
- Lib/ThreadBatch.swift `ThreadBatch.buildThreadWrites(did:, collection:="app.bsky.feed.post", records:[JSONValue], replyTo: ThreadReplyTo?(root:StrongRef,parent:StrongRef), nowMs: Double OR now: Date, timeZone: TimeZone, mintTid: (Double) throws -> String = ThreadBatch.nextTid) throws -> ThreadWrites{writes:[ApplyWritesCreate{collection,rkey,value}, which encodes its $type], created:[CreatedPost{uri,cid,rkey,record}]}`
  - It is synchronous, unlike the web's async version.
  - Reply refs go into each record as {uri, cid}, plus $type when the StrongRef has a lexiconType, as the web copies the caller's refs.
  - nowMs goes through TimeClip. To mirror the web's string `now`, parse it with VirgaCore.JSDate.parse(_, timeZone:). A zone-less createdAt is read in `timeZone`, held to the web in seven zones.
  - Throws InvalidTimeValueError "Invalid time value". ThreadBatch.nextTid throws TIDTimeError (V8's BigInt message) for a non-finite time.
  - Uses VirgaRepo.RecordCid.computeRecordCid.

EMBEDS AND GATES
- Lib/Embeds.swift `enum Embeds` (JSONValue in, JSONValue out):
  - buildRecordEmbed(_ JSONValue) and (uri:cid:)
  - combineRecordWithMedia(_ record, _ media?)
  - buildVideoEmbed(blob:alt:aspectRatio:), buildImageRecord(alt:blob:aspectRatio:), buildImagesEmbed([JSONValue])
  - buildExternalEmbed(_ card, _ thumb?)
  - buildPostEmbed(_ post: JSONValue?, _ blobs: JSONValue? {images,video,cardThumb}) -> JSONValue?. blobs.images is read as JavaScript reads it: an array, a string, or an object with a length.
  - normalizeImageEmbed(_ JSONValue?) -> JSONValue?
  - normalizeAssociatedRefs(_ JSONValue?) -> [JSONValue]? and maxAssociatedRefs: these are linkCard.js's; the publish port should reuse them.
- Lib/Gates.swift:
  - `enum ReplyRule {mention, follower, following, list(String)}`: Codable as {type, list?}, with `.json` and `init?(json:)`.
  - `struct PostGates {reply:[ReplyRule]?, quotes:Bool}`: Codable, with reply written as null for everyone; `.json`, `init(json:)`.
  - `struct GateRules {threadgateAllow:[JSONValue]?, postgateEmbeddingRules:[JSONValue]?; .json}`
  - `protocol GatesAgent: Sendable { getPreferences() async throws -> JSONValue; getRecord(repo:collection:rkey:) async throws -> JSONValue; putRecord(repo:collection:rkey:record:) async throws; deleteRecord(repo:collection:rkey:) async throws }`. Each returns the XRPC output body. VirgaNetwork's client should conform via an extension in VirgaPosting.
  - `protocol XRPCErrorDescribing { var xrpcError: String? }` lets RecordNotFound be recognised; without it the error message is matched.
  - `enum Gates`:
    - gatesToRules(JSONValue? or PostGates?) -> GateRules
    - gatesFromRules(JSONValue? or GateRules) -> PostGates
    - gatesEqual(JSONValue?/PostGates?, …) -> Bool
    - defaultGatesFromPreferences(JSONValue?) -> PostGates
    - readDefaultGates(_ GatesAgent, timeoutMs:) async -> PostGates?. A Promise.race: nil at the deadline even if the read ignores cancellation.
    - updatePostGates(_ agent, uri:, reply:[ReplyRule]? or JSONValue?, quotes:, now:) async throws -> PostGates
    - maxReplyRules, everyoneGates, defaultGatesTimeoutMs

COMPOSE INTENTS AND EVENTS
- Lib/ComposeIntent.swift `enum ComposeIntent`:
  - parseComposeIntent(URLSearchParams | String? | JSONValue?) -> ParsedComposeIntent{hasIntent,text,url,tags,truncated}
  - buildComposeIntentUrl(_ ComposeIntentInput(text:url:tags: .text(String)/.list([String])), origin: String?) throws -> String. With no origin it falls back to "http://localhost"; iOS must pass the server's origin.
  - intentComposePath, maxPostGraphemes, composeIntentParams
- Events.swift:
  - `enum PostingEvents` holds the names settings/templates/drafts/scheduled/timers/posts, the postingEvents table, and the *ChangedEvent aliases.
  - emitPostingEvent(_ name, _ detail: JSONValue?, target: PostingEventBus? = .shared) throws -> Bool
  - onPostingEvent(_ name, did:, target:, _ fn: @Sendable (JSONValue)->Void) throws -> PostingEventUnsubscribe
  - postingEvents(_ name, did:, target:) throws -> AsyncStream<JSONValue>
  - emitPostsChanged(_ did, added:[JSONValue]?, removed:[JSONValue]?, target:) throws -> Bool
  - `final class PostingEventBus: Sendable` (.shared, addListener/removeListener/dispatch/listenerCount) stands in for the window: synchronous, in-order delivery. Names compare by code unit.
  - PostingEventError carries the TypeError messages.

SUPPORT (public; may move to VirgaCore later)
- Support/WHATWGURL.swift `struct WHATWGURL`:
  - init(_ input, base: WHATWGURL?/String) throws WHATWGURLError("Invalid URL"); parse(_:base:)
  - href, protocolString, username, password, host, hostname, portString, pathname, search, hash, searchParams, setSearchParams(_)
  - Matches Node's URL (Ada 2.9.2), except where Ada leaves the URL Standard (an input with '#' against an opaque-path base; a non-special path ending in '..' at its root): there it follows the Standard, as browsers do.
  - Setters are not ported.
- Support/URLSearchParams.swift `struct URLSearchParams`:
  - init(String), init(pairs:), get/getAll/has/append/set/delete, description = toString()
  - Names compare by code unit; the leading '?' is one code unit.
  - Encoding and decoding use VirgaCore's JSURI (encodeURIComponent, decodeURIComponent, searchParams serializer). There is no URIComponent type any more.
- Internal:
  - Support/IDNA.swift with Support/IDNATable.swift. The table is generated by `node ios/scripts/generate-idna-table.mjs` from Node's url.domainToASCII.
  - Support/JSRegex.swift: an NSRegularExpression wrapper over VirgaCore's JSRegexSubject. Write JS \s as JSRegex.space, \d and \w as ASCII classes, $ as \z, and spell out /i (and /iu's ſ and U+0345).
  - Support/PostingJS.swift: isSpace/isAllSpace/hasSpace (JS \s), splitOnWhitespace, hasPrefix by code unit, isInteger (Number.isInteger), stableSorted, and decodeUTF8 that strips a BOM as TextDecoder does. toLowerCase and Number() are VirgaCore's jsLowercased and jsNumber.
  - Support/PromiseRace.swift: race(timeoutMs:fallback:_:), and timerDelay (setTimeout's range).

TEST HELPERS (Tests/VirgaPostingTests)
- Support.swift: json(Encodable), outcome{} (a value or {$throws}), check(actual, case, strictNulls:), cases(fixture, fn), ParityCase.string/int/strings.
- PostBuildingParityTests.swift: the FakeGatesAgent actor; ThreadBatchParity.zone(c) and nowMs(c) read a case's `tz`.
- FacetsParityTests.swift: tableResolver and runDetection.
- PostingTextBehaviourTests.swift: MentionResolverBehaviour is .serialized (it sets Mentions.defaultFetch).
- URLParityTests.swift: URLStandardBehaviour pins the URL Standard where Node differs.

## Known gaps and deliberate differences

- mentions.js is ported. Mentions.defaultFetch (the shared resolver's fetch) is set at launch from VirgaNetwork's HTTPTransport (AppModel.init calls Mentions.useNetwork, for the device and the demo). Where it is unset, as in tests, the shared resolver treats every lookup as a network failure (no DID, nothing cached). A test that sets Mentions.defaultFetch must live in the serialized MentionResolverBehaviour suite.
- gates.js needs an agent: in wave 2, VirgaNetwork's XRPC client must conform to GatesAgent, and its error type to XRPCErrorDescribing (for RecordNotFound). When both gate reads fail, Swift reports the threadgate's error; the web reports whichever failed first.
- The resolver's timeout throws exactly where a browser's AbortSignal.timeout does: a fraction is truncated, and anything up to 2^53-1 is accepted. The message is Node's RangeError; a browser's TypeError is worded differently. Fractions and values from 2^32 to 2^53 aren't fixtures, because Node and browsers disagree on them.
- WHATWGURL follows the URL Standard where Node 22's Ada leaves it (an input with '#' against an opaque base; a non-special '..' at the root). Everywhere else it is held to Node. If a Node 22 update moves Ada or its Unicode data, rerun ios/scripts/generate-idna-table.mjs and npm run parity:write. URL setters are not ported. NFC after IDNA mapping uses Foundation.
- Where the web throws TypeError on malformed shapes, Swift treats the value as absent, because these APIs don't throw: a facet whose features isn't an array; a non-string link uri in composerTextFromRecord; post.images given as a non-array with a length, in buildPostEmbed; non-array gallery items in normalizeImageEmbed; buildRecordEmbed(null), buildExternalEmbed(null) and buildPostEmbed(post, null) on the card path. Also unported: an array-valued facet uri, which the web stringifies and may expand in expandLinkFacets and composerTextFromRecord.
- ThreadReplyTo is typed. Its refs carry uri, cid and $type only, where the web copies the caller's whole objects into each record (other keys included). buildThreadWrites(now: Date) floors sub-millisecond time.
- createMentionFacet returns nil, and applyInlineLinks skips the span, for indexes outside the text, where the web writes a facet with undefined offsets.
- Distinct mentions resolve in parallel in a TaskGroup, so the order resolvers start in isn't guaranteed (the fixtures sort the calls). Grapheme clusters are Swift Characters, and \p{L}, \p{P} and \p{Ll} use the platform's ICU, so characters newer than the platform's Unicode data could differ from Intl.Segmenter and V8.
- Embeds.normalizeAssociatedRefs is linkCard.js's function (publish domain, pending). The linkCard.js port should reuse it rather than define a second copy.

## What the audit found and fixed

- medium (fixed) all 15 modules: Earlier interrupted audit work (9552878, 6daae5f, b06893a) checked against the web code and kept: code-unit Set/Map/startsWith comparisons, one copy of the shared helpers (VirgaCore JSURI, jsLowercased, jsNumber, Handle, AtUri), spreads of non-object records, timer-range handling, and the WIP commit's behaviour tests. It builds and passes.
- medium (fixed) src/posting/lib/mentions.js resolveMention (test only): MentionResolverBehaviour was flaky. Two of its tests set and clear the global Mentions.defaultFetch and ran in parallel, so one could clear the fetch while the other was using it. The first full run after the merge failed with 2 issues. The suite is now .serialized.
- medium (fixed) src/posting/lib/threadBatch.js buildThreadWrites: buildThreadWrites dropped a $type on the caller's reply refs. The web puts replyTo.root and replyTo.parent into every record exactly as given, so a ref carrying $type 'com.atproto.repo.strongRef' keeps it, and the CID covers it. The port wrote only uri and cid, which changed the record and its CID. ThreadBatch.refJSON now writes StrongRef.lexiconType as $type. A new fixture case fails against the old source.
- medium (fixed) src/posting/lib/threadBatch.js buildThreadWrites: threadBatch.js reads a zone-less createdAt (and a zone-less `now`) in the browser's zone, but its fixture only ran in UTC and the Swift test hard-coded UTC. Added 70 cases: each zone in ZONES, across the clock changes in New York, London, Lord Howe and Chatham, plus legacy and date-only forms. The Swift test now passes the case's zone. All match.
- low (fixed) src/posting/lib/embeds.js buildPostEmbed: buildPostEmbed reads `blobs.images?.length > 0` and `blobs.images[i]` loosely. For an object with a numeric (or numeric-string) length, the web builds the images embed from obj['0'], obj['1'] and so on; the port fell through to the link card. hasLength and element now read objects as JavaScript does. 4 new cases.
- low (fixed) src/posting/lib/mentions.js createMentionResolver: AbortSignal.timeout's RangeError message. Past 2^32, Node writes the number through addNumericalSeparator, which separates every third character from the end even in exponent form ('1e+_300', '-1e_+21'). The port left numbers with an exponent unseparated. Ported the algorithm literally and added 10 resolverTimeout cases (2^53, 1e300, -1e21, -1e-7, -2^32-1).
- low (open) Support/WHATWGURL.swift (new URL in linkShortening, inlineLinks, composeIntent, richText): A differential fuzz of WHATWGURL against Node (36,000 parses and relative resolutions) found Node 22's Ada leaving the URL Standard in two places. (1) A relative input holding '#' against an opaque-path base resolves in Ada but fails per the Standard. (2) A non-special path ending in '..' right after its root: Ada gives 'foo:' and 'foo://h', the Standard 'foo:/' and 'foo://h/'. The port follows the Standard, as browsers do. Neither reaches posting code, which acts only on http(s) URLs, and every special-scheme URL matched. The WHATWGURL header documents this, and the new URLStandardBehaviour suite pins the Standard's answers.
- low (open) src/posting/lib/mentions.js createMentionResolver: Web bug, reported only (not fixed): in mentions.js createMentionResolver, when AbortSignal.timeout throws (a timeoutMs that is not finite, or is negative), the throw comes before the try, so its finally never runs. The rejected promise stays in inFlight for good. It is harmless, because every later ask fails with the same RangeError anyway.
- low (open) facets.js, urlMatching.js, linkShortening.js, inlineLinks.js, postLink.js, gates.js: Web bugs the porter reported, confirmed (not fixed). (1) An uppercase-scheme URL gets no facet: the scheme checks in facets.js and urlMatching.js are case-sensitive. (2) respliceFacets uses TextDecoder, which strips a leading BOM, so every facet shifts 3 bytes. (3) A facet whose `features` is not an array throws TypeError in shortenLinkFacets, expandLinkFacets and composerTextFromRecord. (4) Plain-object lookups match Object.prototype keys: kindForCollection('constructor'), RULE_TYPES and TYPE_BY_LEXICON.
