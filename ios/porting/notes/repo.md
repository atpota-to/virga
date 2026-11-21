# repo: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited.
Parity cases at port time: 1535, plus 152 added by the audit.
Tests at the time: The whole package passes `swift test` with no compiler warnings. VirgaRepoTests: 57 tests in 12 suites, up from 52. VirgaCoreTests: 32 tests in 7 suites. The module-load tests pass. All repo parity tests now compare numbers exactly. New tests: computeRecordCidOfParsedJSON, toJsonShapeOfParsedJSON, readRepoCarRecordsWithAProtoMember, largeContainersDecodeInLinearTime, nonFiniteNumbersAreRefusedByTheEncoder, and fractional-ms date checks. Other checks: `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity` gives 21 passed; `npx eslint ios` is clean; `npm run parity:write` regenerates repo.recordCid 

## API for the code that builds on it

Paths are relative to the repo root (/home/user/virga/.worktrees/w1b in this worktree). Target VirgaRepo depends only on VirgaCore.

VirgaCore/Crypto/SHA256.swift: `public struct SHA256: Sendable`
- `init()`, `mutating update(_:)` for UnsafeRawBufferPointer, [UInt8], ArraySlice<UInt8>, Data or String (hashed as UTF-8), `mutating finalize() -> [UInt8]`. A hasher is spent once finalized.
- `static hash(_:) -> [UInt8]` for the same input types, `static hex(_ some Sequence<UInt8>) -> String` (lowercase, like Node's digest('hex')), `digestLength = 32`.
- Pure Swift, no CryptoKit, about 220 MB/s in a release build. Use it for the PKCE S256 challenge: base64url of SHA256.hash(verifier).

VirgaRepo/RepoError.swift: `public struct RepoError: Error, LocalizedError, Hashable, Sendable`
- Fields: `kind` is the JS error class (`.error`, `.rangeError`, `.typeError` or `.syntaxError`); `message` is the web's error.message, word for word, and is also errorDescription; `status: Int?` is the HTTP status, set by fetchRepoCar.

VirgaRepo/Encoding:
- `Varint.encode(Int) throws -> [UInt8]`, `encode(_:into:)`, `decode(_ [UInt8] or ArraySlice, offset:, length: Int?) throws -> (value: Int, nextOffset: Int)`, `encodingLength(_:)`.
- `Multibase.toBase32`, `fromBase32`, `toBase64` (unpadded), `toBase64Pad`, `fromBase64`, `fromBase64Pad`. Decoding is strict: only canonical strings are accepted, as @atcute accepts. Messages follow @atcute's Node build.

VirgaRepo/CID.swift: `public struct CID: Hashable, Sendable, Codable, CustomStringConvertible`
- Codable as `{"$link": "bafy…"}`.
- Properties: `bytes: [UInt8]` (36 bytes), `codec`, `digestCodec`, `digest`, `string`, `binary`.
- Statics: `codecDagCbor` (0x71), `codecRaw` (0x55), `hashSha256`, `create(codec:data:)` (SHA-256), `fromDigest(codec:digest:) throws`, `decodeFirst`, `decode`, `fromString(_:) throws`, `fromBinary`, `toString(_:)`.
- CIDv1 with SHA-256 only. The web reads no CIDv0, and neither does this.

VirgaRepo/DagCbor:
- `public indirect enum DagCborValue: Hashable, Sendable, Codable` with cases null, bool, number(Double), string, bytes([UInt8]), link(CID), array, map([String: DagCborValue]).
  - `.jsonValue` gives the JSON form: links as {$link}, bytes as {$bytes} in unpadded base64.
  - Also `init(json:)`, `subscript(key)`, `stringValue`, `linkValue`, `bytesValue`.
- `DagCbor.decode(_ [UInt8], ArraySlice or Data) throws -> DagCborValue` and `decodeFirst(_:)`.
  - Linear in the input size: containers are filled in place.
  - Refuses exactly what @atcute refuses, with the same messages.
  - `DagCbor.maxDepth = 128`: values nested deeper are refused with RangeError 'value nested too deeply (more than 128 levels)'. This is a deliberate guard; JSONEncoder of a JSONValue crashes under 200 levels on a 512 KB thread.
- `DagCbor.encode(_ JSONValue) throws -> [UInt8]` and `encode(_ DagCborValue)`.
  - Canonical, as @atcute's `encode` writes it. A single-member {$link}/{$bytes} map is a link or bytes.
  - A map with its own `constructor` key is written only as a link or bytes, otherwise refused ('unsupported type: [object Object]').
  - A "__proto__" key here is an ordinary key, as for @atcute encode over JSON.parse output.
- `DagCbor.fromBytesString(_:)`.

VirgaRepo/Car:
- `CarReader.fromUint8Array(_ [UInt8] or Data, verifyBlocks: Bool = true) throws -> CarReader`.
  - `.roots: [CID]`, `.header`, `.blocks() throws -> [CarBlock]`, `.makeIterator()` with `mutating next() throws -> CarBlock?`, `.bytes(of:) -> ArraySlice<UInt8>`, `static verifyBlock(_:_:) throws`.
  - `CarBlock` has `cid`, `bytesRange`, `entryStart`/`entryEnd`, `cidStart`/`cidEnd`, `bytesStart`/`bytesEnd`.
- `CarWriter.writeCar(roots: [CID], blocks: [(cid: CID, data: [UInt8])]) -> [UInt8]`, `serializeCarHeader(roots:)`, `serializeCarEntry(cid:data:)`.
  - Byte-identical to @atcute's writeCarStream. VirgaDemo should build its repo CAR (the port of harness/buildCar.js) with this; CarRepoBehaviourTests.swift has a small Swift repo builder to copy.

VirgaRepo/CarRepo.swift (`// Ports src/lib/carRepo.js`): `enum CarRepo`
- `yieldEvery = 4000`.
- `getRepoURL(_ pds: String, _ did: String, since: String? = nil) -> String` (URLSearchParams encoding).
- `fetchRepoCar(_ pds: String, _ did: String, since: String? = nil, transport: some RepoCarTransport, onProgress: (@Sendable (RepoCarDownloadProgress) -> Void)? = nil) async throws -> [UInt8]`.
  - A non-2xx response throws RepoError 'HTTP <s> from getRepo', with ' (since diff)' added when `since` is non-empty, and `.status` set on the error.
  - A whole body (`.data`) reports progress once, with total = Content-Length or the body's size. A stream reports after every chunk, with total = Content-Length or nil.
  - Cancellation is checked between chunks and after the stream ends.
- `protocol RepoCarTransport: Sendable { func get(_ url: String) async throws -> RepoCarResponse }`.
  - `RepoCarTransportClosure { url in … }` adapts any client.
  - `RepoCarResponse(status:headers:body:)`, where body is `.data(Data)` or `.stream(AsyncThrowingStream<Data, Error>)`. Headers are looked up case-insensitively.
  - VirgaArchive must adapt VirgaNetwork's HTTPTransport to this, since VirgaRepo can't import VirgaNetwork. Stream the body where possible, as the web does.
- `readRepoCar(_ [UInt8] or Data, onProgress: (@Sendable (RepoCarReadProgress) -> Void)? = nil) async throws -> RepoCarContents`.
  - It is nonisolated async: call it off the main actor.
  - It yields, and can be cancelled, every 4000 steps. It is linear: 150,000 records take about 1.6 s in a release build.
- `RepoCarContents`: `did: JSONValue?`, `rev: JSONValue?` (the decoded values, as the web keeps them), `entries: [RepoCarEntry]`, `empty: Bool?`, plus `didString`/`revString`. The web's `parsed.rev || since` becomes `parsed.revString.flatMap { $0.isEmpty ? nil : $0 } ?? since`.
- `RepoCarEntry`: `uri`, `collection`, `rkey: String`, `record: JSONValue` (JSON form). A decoded "__proto__" member stays an own member, as on the web. Feed entries to the outboundFromRecord port.
- `RepoCarReadProgress`: `stage` (.index, .walk or .decode), `done: Int`, `total: Int?`. This is the input of the syncProgress.js repoReadFraction port.
- `RepoCarDownloadProgress`: `bytes: Int`, `total: Double?`.
- `atmosphereRowFromEntry(_ RepoCarEntry?, timeZone: TimeZone) throws -> AtmosphereRow?`, plus `atmosphereRowFromEntry(json: JSONValue?, timeZone:) throws -> JSONValue` for arbitrary shapes.
  - `AtmosphereRow`: `uri`, `collection`, `at: Double` (epoch ms).
  - Pass the active zone; the web uses the browser's.

VirgaRepo/RecordCid.swift (`// Ports src/posting/lib/recordCid.js`): `enum RecordCid`
- `computeRecordCid(_ JSONValue) throws -> String` and `computeRecordCid<T: Encodable>(_:) throws -> String`.
  - Both go through the web's toJsonShape semantics: a member named "__proto__" is dropped and becomes the object's prototype, which the encoder reads through (Support/JSObjects.swift). That gives the web's CID or refusal, not the PDS's.
  - NaN or ±Infinity throws RangeError 'NaN and Infinity values not supported'.
- `toJsonShape(_ JSONValue) -> JSONValue` is not identity: it drops "__proto__" members at any depth, which is what JSON.stringify writes of the web's result. It is otherwise unchanged.
- `toJsonShape(_ DagCborValue)` follows the same rule.
- `toJsonShape<T: Encodable>(_:) throws -> JSONValue`:
  - Data becomes {$bytes}, CID becomes {$link}, nil members are dropped.
  - Date becomes its ISO string, with fractional milliseconds cut toward zero, as `new Date(ms)` cuts them.
  - NaN and ±Infinity come back as .number values, as the web's toJsonShape passes them through.
- `jsonShapeEncoder() -> JSONEncoder` is the plain encoder: it throws on non-finite numbers.
- Used by the posting ports: threadBatch.js, blobs.js, drafts.js, autosave.js, video.js. Records need their `$type` for the CID to match the PDS.

VirgaRepo/Support:
- `JSDate.parse(_ text: String, timeZone: TimeZone) -> Double` is a full port of V8's Date.parse.
  - It handles the ISO format plus the legacy parser, and returns NaN on failure.
  - It reads zone-less forms in `timeZone` as V8 does across clock changes (the offset before the change).
  - Fuzzed against Node with no difference over 595,000 comparisons in 19 zones.
- `JSDate.toISOString(_ ms: Double) -> String?` applies TimeClip.
- Both are public. They could move to VirgaCore for the time.js port; VirgaCore can't import VirgaRepo.
- JSSemantics, UTF8Text and JSObjects are internal.
- `CarRepo.tidToTimestamp` (internal) repeats src/lib/atproto.js's function. VirgaNetwork's port should match it.

Conventions:
- Errors carry the web's messages.
- Bytes are [UInt8].
- Records are JSONValue in the JSON form.
- Time zones are always passed in.
- Test-target helpers in Tests/VirgaRepoTests/Support.swift:
  - `Hex`, `outcome {}` (gives a value or {$throws}), `json(Encodable)`, `ParityCase.bytes/base64/expectedThrow`.
  - `exactDiff(actual, expected, strictNulls:)`: Parity.diff with numbers compared exactly. Use it for times and large integers.
- `ProgressLog` and `ReplayTransport` are in CarRepoParityTests.swift.

## Known gaps and deliberate differences

- DagCbor.maxDepth = 128 remains a deliberate divergence. The web decodes any depth. On a 512 KB thread, JSONEncoder of a JSONValue crashes between 129 and 200 levels in a debug build, so readRepoCar and DagCbor.decode refuse deeper values with RangeError 'value nested too deeply (more than 128 levels)'.
- The shared VirgaTestSupport Parity.diff still allows a relative 1e-9 between numbers, about 1.7 s on epoch-ms times. Other domains that compare times or large integers should compare them exactly. The repo tests use the local exactDiff in Tests/VirgaRepoTests/Support.swift.
- The prototype a "__proto__" member gives an object is modelled only inside computeRecordCid. toJsonShape returns a JSONValue, which can't carry a prototype, so it returns the own members, as JSON.stringify writes them. A downstream port that reads through the prototype would differ for such inputs; for example blobs.js reads `toJsonShape(blob)?.mimeType`.
- Messages for invalid base64 and invalid UTF-8 follow the Node builds of @atcute that the fixtures run: 'invalid base64 string' and 'input is not valid utf-8'. The browser builds (native Uint8Array.fromBase64 or the polyfill's 'invalid base string', and TextDecoder's fatal TypeError) word them differently. Which strings are accepted and which are refused is the same.
- Array.prototype.join in the 'unsupported type' message is modelled with V8's limits. A length past 2^32-1 gives TypeError 'Invalid array length' and is fixture-tested. A result past 536,870,888 UTF-16 units gives RangeError 'Invalid string length', which is computed from the lengths without building the string. That case isn't fixture-tested, because V8 takes 15 s to reach it.
- Swift-only Encodable path: a nil inside an array (`[T?]`) encodes as null. The nearest web shape, undefined in an array, would throw 'unsupported type: undefined'. Swift has no equivalent for that.
- Still open from the porter: the zone fixture skips Africa/Casablanca, whose 2026 rules are newer in Node's tzdata than in the toolchain's. readRepoCar and fetchRepoCar can be cancelled where the web can't. VirgaRepo has no URLSession or HTTPTransport adapter; VirgaArchive must wrap one in RepoCarTransportClosure. toJsonShape's cases for JS Map and Set have no Swift equivalent.

## What the audit found and fixed

- medium (fixed) src/posting/lib/recordCid.js toJsonShape / computeRecordCid: computeRecordCid and toJsonShape treated a member named "__proto__" as an ordinary key, so they computed a different CID from the web. The web's toJsonShape rebuilds each object with `out[key] = toJsonShape(value)`. That assignment drops the member and, when the value is an object, array or null, makes it the object's prototype. @atcute's encoder then reads `val.constructor`, `'$link' in val`, `val.$bytes` and `String(val)` through that prototype. So {"__proto__":5,"a":1} has the CID of {a:1}; {"__proto__":null} throws 'Cannot convert object to primitive value'; {"__proto__":[1,2],"constructor":1} throws 'unsupported type: 1,2'; a prototype holding $link turns the object into a link. Fixed with Support/JSObjects.swift, a model of the objects toJsonShape builds: own members plus the prototype chain, ToPrimitive, and Array.prototype.join with V8's 'Invalid array length' and 'Invalid string length' limits. DagCborEncoder has a writer for that model. toJsonShape(JSONValue) now returns the own members, which is what JSON.stringify writes of the web's result. 57 records given as JSON text (computeRecordCid.json and toJsonShape.json) pin the web's CIDs, refusals and shapes. With the old code, the new tests fail.
- medium (fixed) @atcute/cbor decode (used by carRepo.js readRepoCar): Decoding DAG-CBOR took time quadratic in a container's length. The decoder's frame stack was an enum: each value was popped, bound with `case .array(var values, …)` and pushed back, and the second reference made every append copy the whole array or map. In a release build a 40,000-element array took 16 s and a 40,000-key map 20 s; a 50,000-record CAR took 27 s in readRepoCar. The web takes milliseconds. Frames are now structs filled in place on the stack: 5 ms for the array, 0.6 s for 50,000 records, 1.6 s for 150,000 (linear). The new test largeContainersDecodeInLinearTime decodes 200,000 elements and 100,000 keys and must finish in under 20 s in a debug build (it takes 1.7 s).
- medium (fixed) ios/VirgaKit/Tests/VirgaTestSupport/Parity.swift (shared test harness): The shared Parity.diff accepts a relative 1e-9 difference between numbers. For epoch-millisecond times (~1.8e12) that is about 1.7 seconds of slack, and for 2^53-scale integers in records about 9 million, so a Date.parse port that is off by a second would still pass. I added exactDiff to Tests/VirgaRepoTests/Support.swift: it runs the shared diff, then compares every number exactly. Every repo parity test now uses it, and all of them pass exactly. I didn't change the shared VirgaTestSupport/Parity.swift, which is outside my domain.
- low (fixed) recordCid.js toJsonShape (Date → JSON.parse(JSON.stringify)): jsonShapeEncoder floored a Swift Date's fractional millisecond. A JS date made from a fractional time (`new Date(ms)`, TimeClip) cuts toward zero, so the two differ before 1970: -0.5 ms is 1970-01-01T00:00:00.000Z in JS but came out as …59.999Z. It now passes the fractional value to JSDate.toISOString, which applies TimeClip. There is a test for it.
- low (fixed) recordCid.js toJsonShape / computeRecordCid: In the Encodable path, a NaN or ±Infinity Double made JSONEncoder throw an EncodingError. The web's toJsonShape passes these values through, and its encoder then throws RangeError 'NaN and Infinity values not supported'. They now cross the JSON step as private-use marker strings and come back as numbers: toJsonShape returns NaN, and computeRecordCid throws the web's message. Control characters didn't work as markers, because swift-foundation's JSONEncoder doesn't escape non-conforming float replacement strings inside arrays. There is a test for it.
- low (fixed) ios/parity/cases/repo.recordCid.js, repo.carRepo.js: Fixture coverage was thin for several encoder branches and a few readRepoCar paths. Added: integer and negative-integer argument widths at every boundary; floats including subnormals; string lengths of 23, 24, 255, 256, 1023 to 1025 and 65,535/65,536 bytes, plus two-byte, three-byte and surrogate-pair strings past the encoder's 1,024-unit path; arrays and maps of 23, 24, 32, 33, 255 and 256 entries; more than 32 keys with some non-ASCII (the UTF-8 re-sort path); keys whose UTF-16 order differs from their UTF-8 order; $link and $bytes edge strings (padded, non-canonical, URL alphabet, CIDv0, uppercase, null); and every branch where an object has its own `constructor`. For readRepoCar: two roots in either order, a commit under a raw CID, a non-canonical record, and records holding a __proto__ member. The harness's toJSON drops that key, so those cases record the web's result as JSON.stringify text (readRepoCar.json).
- low (fixed) src/lib/carRepo.js readRepoCar walk: The MST walk in CarRepo.swift had a stray duplicate `try Task.checkCancellation()` with broken indentation. Removed.
- low (open) @atcute/cbor decode depth: Kept as a deliberate divergence: DagCbor.maxDepth = 128, where the web decodes any depth. I measured it on this toolchain with a 512 KB thread, the size of an iOS concurrency thread. JSONEncoder on a JSONValue crashes between 129 and 200 levels in a debug build, and the hash, encode and shape paths crash by 400 to 1,000. The cap protects every downstream consumer, so I left it, documented.
- low (open) src/posting/lib/recordCid.js toJsonShape: Web bug, reported, not fixed: recordCid.js computeRecordCid gives a CID that doesn't match the PDS for any record holding a "__proto__" member, and throws for some of them. toJsonShape's `out[key] =` assignment sets the prototype instead of keeping the member. The Swift port now reproduces the web's behaviour. The porter's other web-bug notes check out too: the MST prefix is applied as a UTF-16 slice; an own `constructor` makes @atcute refuse the object; fetchRepoCar accepts loose Content-Length values; and the harness's toJSON drops __proto__ keys and recurses.
