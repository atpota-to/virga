# session: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited (2026-11-21). Most of the domain was ported in an earlier wave; the
controller, the provider (SessionModel) and the sign-in steps came from a run cut off by a
billing error, were finished in the next, and the whole domain was then audited.
Parity cases at port time: 729, plus 23 added by the audit.
Tests at the time: Whole package `swift test` passes on Linux with Swift 6.4.2, every target. VirgaSessionTests: 194 tests in 32 suites (the porter had 186), and 5 more consecutive runs of the session target all passed. Added tests: in FinishingASignInInTheApp, clearsTheErrorAnEarlierSignInLeftOnceOneComesBack (fails against the old code), replacesAnEarlierSignInsErrorWithThisOnes, keepsTheErrorOfASignInThatWasCalledOff, readsTheNamesAgainForAnAccountSignedBackInForItsOwnSake, leavesTheOpenAccountAsItWasWhenASignInComesBackDeclined, passesOnASheetThatCouldntBeShown and callsTheSignInOffWhenItsTaskIsCancelledWithTheSheetUp; in SessionModelSigningIn, dropsADeclinedSignInsErrorOnceTheNextOneComesBack. `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity`: 103 passed. `npx eslint ios`: clean. I also checked about 37,000 random inputs against Node with temporary generators and tests that I deleted afterwards: normalizeSignInInput, classifySignInInput, suggestQuery, hostnameOf, hostLabelForPds, handleFromDidDocument, parseScopeToken, missingScopes, isMissingScopeError, tripFailureNotice, parseInline, parseMarkdown, outlineOf, isSafeHref, slugify, documentFor, resolveDocumentLink, readAccounts, and lastOpenedLabel in all seven test zones over 2025–2027. All matched. Every input from accounts.test.js, scopes.test.js, acceptance.test.js, markdown.test.js and documents.test.js is already in the fixtures.

## API for the code that builds on it

All in VirgaSession (`import VirgaSession`). Paths are under ios/VirgaKit/Sources/VirgaSession/.

Session/SessionController.swift and SessionController+Actions.swift (ports src/session/sessionController.js):
- `@MainActor public final class SessionController`, created with `init(set: SessionControllerSink, env: SessionEnvironment)`.
- Statics:
  - `noActive: ActiveSession`
  - `capabilitiesFrom(_ row: AccountRow?, _ status: AccountStatus?) -> AccountCapabilities`
  - `holdsDefense(_ granted: String?) -> Bool`
  - `grantedDefenseLevel(_ granted: String?) -> AppConfig.DefenseLevel?` (nil stands for the web's false)
- Members:
  - `active: ActiveSession` (read-only)
  - `startOnce() async`
  - `statusOf(_ did: String) -> AccountStatus`
  - `switchAccount(_ did: String?) async throws`: throws JSError "That account isn’t remembered in this browser." or ReauthRequiredError.
  - `signIn(_ input: String?, _ options: SignInOptions = SignInOptions()) async throws`:
    - backend mode runs BackendClient.startBackendSignIn;
    - with `env.authenticator` set, it opens the sheet and finishes the return itself;
    - a closed sheet or a cancelled task throws BackendError(name "AbortError", message "The sign-in was called off", code "CANCELLED");
    - any other sheet error is rethrown as is, with the pending sign-in cleared;
    - a return that carries an error goes to `set.error`;
    - a sheet that comes back with nothing reads as readBackendReturn's callback_failed.
  - `signOutAccount(_:) async`
  - `removeAccount(_:deleteData:) async`
  - `agentFor(_ did: String?) async throws -> XRPCAgent`
  - `targetFor(_:) async throws -> SessionTarget`
  - `backendFor(_ did: String?) -> VirgaBackend?`
  - `checkAccount(_:) async -> SessionCheckStatus`
  - `reread() async`
  - `completeSignIn(_ result: BackendClient.BackendReturn) async`: the web's page load on the return path. It waits for a start under way, clears the error an earlier sign-in left, applies the return, reads names and pictures again (rows that lack them and the open account), and opens the account the return settles on.
  - `@discardableResult completeSignIn(callbackURL: String) async -> Bool`: true only when the address on the return path held a return.
- `SessionControllerSink(rows:statuses:active:switching:error:finishing:)`: all `@MainActor` closures with no-op defaults. `finishing(Bool)` brackets taking a return.
- `SessionEnvironment(...)` parameters:
  - `storage`, `tabStorage: (any KeyValueStore)?`, `secrets: (any SecretStore)?`
  - `browser: any BrowserSessionDriver = NoBrowserSessions()`
  - `backendUrl: String?`, `transport: any HTTPTransport = HTTP.transport`, `clock: NetworkClock = HTTP.clock`
  - `backendReturn: BackendClient.BackendReturn? = nil`, `onCallbackPath = false`, `authMode = "backend"`
  - `getProfile`, `resolvePdsUrl`, `rememberPdsUrl` (defaults: Atproto and PDS)
  - `resetAnalyticsStore: @Sendable (_ did: String?) async -> Void = { _ in }`
  - `deleteDatabase: @Sendable (String) async -> Bool = { _ in false }`
  - `dispatch: @MainActor (String, JSONValue) -> Void` (default SessionEvents.shared)
  - `origin: (@Sendable () -> String)?` (default: the server's origin), `assign: @Sendable (String) -> Void` (leave it a no-op when an authenticator is given)
  - `authenticator: (any WebAuthenticator)? = nil`, `randomBytes`
- Value types:
  - `SignInOptions(mode: String? = nil, intent: String = "add", prompt: String? = nil, defense: JSONValue? = nil /* true, "scan", "lists", false; nil is unsaid */, did: String? = nil)`
  - `ActiveSession(did:agent:session:mode:)`
  - `SessionInfo(sub:did:mode:oauth:)`
  - `SessionTarget(did:agent:pdsUrl:)`
  - `AccountCapabilities(mode:canPost:canSchedule:canUseAi:defense:lists:canWriteLists:missing:)`: Codable to the web's JSON; `defense` and `lists` are "granted", "missing" or "unknown".

Session/SessionModel.swift (ports useAtprotoSession.jsx):
- `@MainActor @Observable public final class SessionModel`, created with `init(env: SessionEnvironment)`.
- Observed state: `rows: [AccountRow]`, `statuses: [String: AccountStatus]`, `active`, `switching: String?`, `error: (any Error)?`.
- Computed: `loading: Bool` (starting or finishing), `session`, `agent`, `did`, `mode`, `accounts: [SessionAccount]`, `authMode`. Also `controller: SessionController!`.
- Methods:
  - `start() async`: call once from the app's root `.task`; `loading` stays true until it has run. It restores only when there is something to restore.
  - `signIn(_:_:)`, `signOut()`, `switchAccount(_:)`, `signOutAccount(_:)`, `removeAccount(_:deleteData:)`
  - `agentFor(_:)`, `targetFor(_:)`, `backendFor(_:)`, `capabilitiesFor(_ did: String?) -> AccountCapabilities`, `checkAccount(_:)`
  - `completeSignIn(callbackURL:) async -> Bool`: for a universal link to /oauth/return.
  - `storageChanged(key: String?) async`: the window's storage event; key nil means the store was cleared.
  - `clearError()`: the error otherwise lasts until the next sign-in that comes back, or the next launch.

How the app should build the environment:
`SessionEnvironment(storage: UserDefaultsKeyValueStore(), tabStorage: InMemoryKeyValueStore() /* one per run: the web's sessionStorage */, secrets: KeychainSecretStore(), backendUrl: <the server>, authenticator: <VirgaUI's ASWebAuthenticationSession wrapper; .https(host:path:) callback, iOS 17.4>, resetAnalyticsStore: { _ in await <VirgaArchive's port of analyticsStore.js resetAnalyticsStore, which drops every cached store handle>() }, deleteDatabase: { name in <delete that FileStore folder>; return true })`
- The archive hook keeps the web's name, `resetAnalyticsStore`. It receives the removed account's DID, which it may ignore (the web resets every store).
- `deleteDatabase` is called with "virga-analytics:<did>" and then "virga-posting:<did>" (Accounts.localDatabases), one after the other.
- The universal-link domain must be the origin `env.origin()` returns.

Other files:
- Session/BrowserDriver.swift: `protocol BrowserSessionDriver`, `protocol BrowserOAuthSession`, `BrowserRestoreError(restoreFailure:message:)`, `NoBrowserSessions`.
- Session/WebAuthenticator.swift: `protocol WebAuthenticator { func authenticate(url: String, callbackHost: String, callbackPath: String) async throws -> String }`; `WebAuthenticationError.cancelled` and `.failed(String)`.
- Lib/OAuthClient.swift: `OAuthClient.signInErrorMessage(_:)`, `callbackErrorMessage(_:)`, `buildLoopbackClientId(_ origin: String, _ redirectPath: String) throws -> String`, `buildClientMetadata(_ origin: String) -> OAuthClientMetadata` (snake_case fields, as the web's JSON).
- SignIn/:
  - `SignInFlow`: flowReducer, initialFlow, the words, tripFailureNotice; types SignInFlowState, SignInFlowEvent, SignInNotice, SignInLeaving, SignInStep.
  - `SignInHosts`: signupHosts, notTheHosts, `signUpAt(_ signIn: (String, SignInOptions) async throws -> Void, _ hostUrl: String, options:)`.
  - `SignInIdentity`: cleanTyped, normalizeSignInInput, classifySignInInput, hostnameOf, hostLabelForPds, handleFromDidDocument, and `Resolver(transport:clock:cache:appview:)` with `.resolveSignInHost(_:document:)` and `.resolveSignInIdentity(_:)`. Errors: IdentityNotFoundError, IdentityLookupError; cancellation throws CancellationError.
  - `SignInSuggest`: suggestQuery, `searchAccounts(_:limit:appview:transport:)`, moveActive.
  - Public initializers exist for SignInHost and SignInSuggestion.

Test support, internal to VirgaSessionTests: Tests/VirgaSessionTests/SessionWorld.swift has World, FakeBrowser, FakeOAuthSession, Recorder, Stores, People, sessionReturn, errorReturn and thrown. FinishingASignInInTheApp in SessionControllerTests.swift has the Sheet, Sheets (answers each sign-in in turn) and Broken (a sheet that fails, or waits until cancelled) authenticators. Reuse them for later session-layer tests rather than writing new fakes.

## Known gaps and deliberate differences

- The app still has to supply three things: a WebAuthenticator built on ASWebAuthenticationSession in VirgaUI (.https(host:path:) callback, iOS 17.4); resetAnalyticsStore from VirgaArchive (the other chain); and deleteDatabase deleting the archive's and posting store's FileStore folders. The defaults do nothing, so deleting an account's data removes only its key-value data until these are wired.
- How to wire the archive reset: SessionEnvironment(resetAnalyticsStore: { _ in await <VirgaArchive's port of analyticsStore.js resetAnalyticsStore>() }). The web function only clears its memoized per-account database handles, so the archive's port should drop its cached FileStore handles for every account. It may ignore the DID it is given. The hook keeps the web's name, resetAnalyticsStore, rather than the brief's suggested resetArchive.
- Not ported, and nothing on iOS needs them: getOauthClient and getOauthEvents in oauthClient.js, and createBrowserDriver with its helpers in browserDriver.js. They wrap @atproto/oauth-client-browser, and iOS signs in only through Virga's server. Both map entries stay partial.
- Kept from the porter, checked and still true: a VirgaBackend requester's 401 reaches the controller just after the call fails (the web reports it before); an account's two databases are deleted one after the other (the web asks for both at once); signIn returns rather than never settling; non-string handle, avatar and suggestion fields are dropped where the web keeps them; BrowserSessionDriver.onDeleted returns no unsubscribe; copy that says 'browser' and 'tab' is kept word for word; the signal half of the web test 'hands a sign-in the signal' doesn't apply on iOS.
- I left out none of sessionController.test.js: the browser-session tests run against FakeBrowser.
- Web bugs: no new ones. I confirmed both the porter reported: normalizeSignInInput decodes a bsky.app profile link before checking whether the result is an address, so a link can start a sign-in at another host; and createSessionChecker waits 2.5 s even with rounds: 1. The port keeps both behaviours.
- Markdown.swift (811 lines) was checked by fixtures and fuzzing rather than read line by line.
- harness/fakeSession.jsx (the demo session) still needs porting on top of SessionController and NoBrowserSessions; it belongs to the demo domain.

From the port:

- Not ported, and nothing on iOS needs them: getOauthClient and getOauthEvents in oauthClient.js, and createBrowserDriver with its helpers in browserDriver.js. They wrap @atproto/oauth-client-browser, and iOS signs in only through Virga's server.
- The app still has to supply three things before sign-in works: a WebAuthenticator built on ASWebAuthenticationSession in VirgaUI, resetAnalyticsStore from VirgaArchive (the other chain), and deleteDatabase deleting FileStore folders. The defaults do nothing, so an account's data delete removes only its key-value data until these are wired.
- A requester from backendFor (VirgaBackend) tells the controller about a 401 a moment after the call fails; on the web this happens before. The agent's fetch handler still reports before the call returns, as on the web.
- An account's two databases are deleted one after the other; the web deletes both at once.
- signIn returns after handing the address on (no sheet), or after the return is taken (with the sheet). The web's backend sign-in never resolves, because the page leaves.
- Two behaviours are iOS additions: a sheet that comes back empty is worded as readBackendReturn's callback_failed, and taking a return waits for a start that is still running.
- Non-string values the web would keep are dropped: a truthy non-string avatar in suggestions, and a truthy non-string handle or avatar in sign-in identities, because those Swift fields are strings.
- BrowserSessionDriver.onDeleted returns no unsubscribe function, unlike the web's.
- The 'signal' half of the web test 'hands a sign-in the signal that calls it off' doesn't apply: Swift cancels the task instead. The backend half is ported. Every other web test in sessionController.test.js is ported, including the browser-session ones (they run against a fake driver).
- Copy that says 'browser' and 'tab' is kept word for word on iOS ("…isn’t remembered in this browser.", "another tab signed it out"), because copy is behaviour. Rewording it for iOS is a product decision.
- harness/fakeSession.jsx (the demo session) is still to be ported, on top of SessionController and NoBrowserSessions.

## The audit (2026-11-21)

- **medium**, src/session/useAtprotoSession.jsx (error state per page load) / sessionController.js start(); Swift SessionController+Actions.swift completeSignIn(_:): Taking a sign-in's return in the running app left the error an earlier sign-in had set. On the web every return is a page load, which starts with error = null, so a declined sign-in's words never outlive the next sign-in that comes back with a session. In the port, model.error stayed set after a successful sign-in until clearError(). Fixed: completeSignIn now calls set.error(nil) before applying the return, so a return that carries its own error replaces the old one. Tests: clearsTheErrorAnEarlierSignInLeftOnceOneComesBack fails against the old code; also replacesAnEarlierSignInsErrorWithThisOnes, keepsTheErrorOfASignInThatWasCalledOff, and SessionModel dropsADeclinedSignInsErrorOnceTheNextOneComesBack.
- **low**, src/session/sessionController.js refreshDisplay/open/start; Swift SessionController+Actions.swift completeSignIn(_:): completeSignIn did not read names and pictures again the way the web's return page load does. Two branches returned early with no refreshDisplay: the one where the open account stays open (another account signed back in for its own sake) and the one where there is no account to open. The `refreshed` set also carried over from earlier in the run. So a re-signed-in account whose profile had failed to load before never got its handle or avatar. Fixed: for a session return, `refreshed` is cleared and refreshDisplay runs on every branch. Test: readsTheNamesAgainForAnAccountSignedBackInForItsOwnSake.
- **low**, ios/parity/cases/session.signin.js, session.controller.js: Fixture coverage had gaps. session.signin had no host lookup for an empty or refused list of authorization servers, a server URL with a port and path, a host answer that isn't JSON, or a document that isn't truthy. It had no identity lookup for a profile with empty fields, a DID that has a profile, a profile whose did isn't a string, a 404 from resolveHandle, a 500 after a 400, or an offline directory. capabilitiesFrom was never run over rows with an empty, unknown, upper-case or missing mode, or a scope that isn't a string. Added 23 cases; the port matched all of them with no code change.
- **low**, Swift SessionController+Actions.swift signIn (authenticator branch): There were no behaviour tests for the sign-in sheet's own failure paths: a return that comes back declined while an account is open, a sheet that can't be shown (WebAuthenticationError.failed), and a task cancelled while the sheet is up. Added tests for all three; the port already behaved correctly (open account untouched, error passed on with the pending sign-in cleared, CANCELLED AbortError).
- **low** (left open), src/accounts/pendingWork.js readPendingWork; Swift Accounts/PendingWork.swift: PendingWork.readPendingWork treats timeoutMs <= 0 as no deadline, but the web's AbortSignal.timeout(0) fires at once. Nothing passes 0, so I left it alone.
