# Virga for iOS

A native SwiftUI version of Virga for iPhone and iPad: the same six parts as
the web app (Dashboards, Reports, Posting, Tools, Defense and Settings), for
any atproto account, with several accounts signed in at once.

It is a port of the web app in `src/`, not a separate design, and it is kept
in step with it by tests: see [parity/README.md](parity/README.md).

**The port is in progress.** [STATUS.md](STATUS.md) says what is done, what is
left and in what order, and [porting/](porting/) holds the tooling and notes
it was written with.

## Layout

```
ios/
  project.yml         XcodeGen spec for the app (Virga.xcodeproj is generated)
  App/                the app target: entry point, assets, entitlements
  AppTests/           tests that need the app bundle
  AppUITests/         end-to-end tests in demo mode
  Config/             build settings (server, Defense flags, team, bundle id)
  VirgaKit/           a Swift package with everything else (below)
  parity/             fixtures, module map and drift tooling that tie the
                      Swift code to the web code
  PORTING.md          the conventions every Swift file follows
  scripts/            CI helpers
```

`VirgaKit` holds the app's logic in targets that build and test on Linux as
well as on Apple platforms, and the SwiftUI layer (`VirgaUI`) on top:

| Target | What |
| --- | --- |
| VirgaCore | Lexicon models, identifiers, JSON, time, locale and formatting, the sky, preferences, app constants |
| VirgaNetwork | HTTP, XRPC, the public AppView, PDS and PLC, Constellation, blobs, Virga's server API |
| VirgaRepo | CAR files, DAG-CBOR, CIDs |
| VirgaSession | Accounts, long sessions through Virga's server, scopes, sign-in, the agreement to the terms |
| VirgaArchive | The archive: store, sync, analytics, exports |
| VirgaPosting | Rich text, the composer, publishing, drafts, scheduling and the queue, timers, templates, the library, the adviser |
| VirgaInsights | Routes, dashboards, reports, tools, sharing a chart, the command palette |
| VirgaDefense | Scanning a post, the radar, lists, history, the moderator |
| VirgaDemo | A made-up world for previews, demo mode and UI tests |
| VirgaUI | The SwiftUI app |

## Build and run

On a Mac with Xcode 16 or later:

```bash
brew install xcodegen
```

```bash
cd ios && xcodegen generate && open Virga.xcodeproj
```

Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig` and set your
team, bundle identifier and Virga server. Run the `Virga` scheme. Launch with
the argument `-VirgaDemo YES` to use the made-up world instead of signing in.

From the command line:

```bash
ios/scripts/xcodebuild.sh app-test       # the app, its unit and UI tests
```

```bash
ios/scripts/xcodebuild.sh package-test   # VirgaKit's tests on an iOS Simulator
```

The logic and parity tests also run anywhere Swift 6 does, Linux included:

```bash
cd ios/VirgaKit && swift test
```

## Signing in

The iOS app signs in through Virga's server (the web app's `backend` mode, a
long session), because a native app has no browser origin to keep a browser
session in, and because scheduling, the queue, timers and the adviser need a
long session anyway. It opens the server's `/api/oauth/login` in an
`ASWebAuthenticationSession` and catches the return to
`https://<server>/oauth/return#session=…&did=…`, which iOS allows only for an
associated domain: the server must serve
`/.well-known/apple-app-site-association` (`public/.well-known/` in the web
app) naming the app's team and bundle identifier, and `Config/*.xcconfig`
must name the same host.

## Keeping up with the web app

When the web app changes:

1. `npm test` fails if the change alters what a ported function computes.
   Run `npm run parity:write` and commit the new fixtures.
2. `swift test` (and CI's `swift-linux` and `ios` jobs) then fails in the
   Swift test for that function until the Swift port computes the same.
3. A new or moved web file fails `ios/parity/modules.test.js` until
   `ios/parity/modules/<domain>.json` says where it went in Swift.
4. `npm run parity:drift` lists web files changed since their Swift port was
   last synced (CI shows it on the PR); after updating the Swift side,
   `npm run parity:stamp -- <file>`.

See [parity/README.md](parity/README.md) and [PORTING.md](PORTING.md).
