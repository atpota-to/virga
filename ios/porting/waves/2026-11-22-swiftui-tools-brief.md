You are one of several engineers porting Virga, a React web app (analytics, posting and moderation for Bluesky/atproto accounts) in /home/user/virga, to a native iOS app in SwiftUI. The logic is ported to Swift in VirgaKit's logic targets and held to the web code by parity fixtures. The SwiftUI layer (VirgaUI) has its foundation, dashboards, charts and reports built by another agent, which is working concurrently on the remaining reports and dashboard cards. Your part: the tools and the share dialog.

## Where you work
- Your git worktree: /home/user/virga/.worktrees/w6-ui2 (branch ios/w6-ui2). Do ALL reads, edits and commits there, with absolute paths. Never edit /home/user/virga or another worktree.
- There is no Xcode or SwiftUI on this machine (Linux). VirgaUI only builds on Apple platforms. Write conservative SwiftUI you are confident compiles with Xcode 26.6 (Swift 6.2), iOS 17.4 deployment target (newer APIs behind `if #available`), Swift 5 language mode; keep view bodies small. Check syntax on every file you write: `export PATH=/root/.swift-toolchain/swift-6.4.2-RELEASE-ubuntu24.04/usr/bin:$PATH; swiftc -parse <file>`. Every VirgaUI file is wrapped in `#if canImport(UIKit)`. The logic targets must still build and test on Linux (from ios/VirgaKit: `swift build`, `swift test`).
- CI's macOS job (`iOS app`) is the real compiler and runs the UI tests on an iPhone and a 13-inch iPad in demo mode, keeping screenshots. The main session merges your branch, pushes, and sends you CI's errors and what the screenshots show.
- Two pitfalls CI has caught: comparing an optional `String?` with `String.jsEquals` (unwrap, or use the Optional overload), and reading a `@MainActor` model from a static helper on a nonisolated enum (mark it `@MainActor`). ReportArchive.nowMs is optional (fall back to the clock).
- Node: node_modules is a symlink (never npm install). `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity/modules.test.js` checks the module map; `npm run parity:stamp -- <web file>` records a sync; `npx eslint ios` for any JS.

## Read first
- ios/porting/notes/ui.md: the layer's API (theme, components, shell, how a page plugs in via RoutedPage, demo mode, the UI tests and screenshots). ios/DESIGN.md: the look. ios/PORTING.md.
- ios/porting/notes/insights.md (last section): the tools' models (InteractionModel for the Interaction lookup, tools/keep.js, tools/registry.js), ShareSpec and ChartImage.drawShareImage over a ShareCanvas protocol. notes/archive.md (ArchiveModel, the archive's rows), notes/network.md (Constellation, the AppView), notes/session.md.
- The web code: src/tools/*.jsx and tools.css (ToolPage, ToolsIndex, ArchiveSearch, BestTime, FollowBack, FollowCleanup, Identity, InteractionLookup, ListsYoureOn, UnfollowTracker), src/share/ShareDialog.jsx and share.css, src/share/chartImage.js's renderShareImage.

## Your scope (commit after each)
1. ToolPage and the tools index (ToolsIndex), then each tool, over the ported models and the archive; where a tool reads the network (Identity, Lists you're on, Follow cleanup's checks, the Interaction lookup), through VirgaNetwork's clients with the session's transport (demo mode answers from the made-up world). Every word from the web. Each tool's map entry in ios/parity/modules/ui-insights.json: ported, or partial with a note saying exactly what's missing, stamped.
2. The share dialog: ShareDialog.jsx over ShareSpec, and renderShareImage as a ShareCanvas over SwiftUI's GraphicsContext in a Canvas sized ChartImage.shareWidth × shareHeight, measured in Instrument Sans, rendered to PNG with ImageRenderer, offered through ShareLink (and saved to Photos only if the web offers saving; NSPhotoLibraryAddUsageDescription is in the Info.plist already). Wire "Post this chart" / the share entry where the dashboards and reports put it only through a small hook the other agent can call (say what you added); don't edit their Reports/ or Dashboards/ files beyond a one-line call if unavoidable.
3. UI tests and screenshots (iPhone and iPad, demo mode, after the archive's build finishes): the tools index, Identity, Best time, Follow cleanup, the Interaction lookup with a handle looked up, the share dialog with its picture. Add them to ios/AppUITests (read how the existing tests build the archive and wait for it).
Out of scope: the reports and dashboard cards (the other agent), posting and Defense.

## Rules
- Change nothing outside ios/ (and .github/workflows/ios.yml only if a test step needs it). Copy is behaviour: every word from the web. Accessibility labels on every control.
- Commit early and often (`git add -A ios`). Message: a short summary line, a body, then exactly these two trailer lines:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017yeQBdtuT73Tejxzi5PoX7
  Don't push. Don't write any model name in code, comments or commit messages.
- Before you finish: swiftc -parse passes on every Swift file you wrote; swift build and swift test pass in ios/VirgaKit; the module map test passes; everything is committed.

## What to return
A short summary: what you built, the API you added for the share hook, what you're least sure compiles, what you left out and why, any web bugs noticed.
