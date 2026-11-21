// A Workflow script for Claude Code: ports a wave of the web app to Swift
// in two parallel chains (two git worktrees), each port followed by an
// independent audit agent. See ios/porting/README.md for how it was used and
// how to run it again. Args: { wtA, branchA, wtB, branchB, swift, context,
// files: { <domain>: [web files] }, chainA: [step], chainB: [step] }, where a
// step is { domain, target, brief, mapName?, auditOnly?, portNote?,
// portSummaryPath? }, and `session` is the Claude-Session trailer's URL.

export const meta = {
  name: 'ios-port-wave',
  description: 'Port a wave of the Virga web app to Swift in two parallel chains, with parity fixtures; every port is followed by an independent audit that verifies it against the web code and fixes gaps',
  phases: [
    { title: 'Chain A', detail: 'first worktree' },
    { title: 'Chain B', detail: 'second worktree' },
  ],
}

// The Swift toolchain's bin directory (ios/scripts/install-swift-linux.sh prints it).
const SWIFT = args.swift
const FILES = args.files

const COMMON = (wt, branch) => `You are one of several engineers porting Virga, a React web app (analytics, posting and moderation for Bluesky/atproto accounts) in /home/user/virga, to a native iOS app in SwiftUI. Agents work in sequence and in parallel; you own one piece. The quality bar: the Swift port computes exactly what the web code computes, proven by parity fixtures generated from the web code itself.

## Where you work
- Your git worktree: ${wt} (branch ${branch}). Do ALL reads of the iOS code, edits, builds and commits there, with absolute paths. Never edit /home/user/virga itself or any other worktree. Another agent works concurrently in a different worktree on other domains; neither of you sees the other's work until a later merge.
- Read first: ${wt}/ios/PORTING.md (the rules), ${wt}/ios/parity/README.md (the parity harness), and the worked examples: ${wt}/ios/VirgaKit/Sources/VirgaCore/{AppConfig,TID,Graphemes,JSONValue}.swift, Support/JSCompat.swift, Lexicon/Facet.swift, ${wt}/ios/parity/cases/core.*.js and _helpers.js (each, value, grid, withFakeFetch), ${wt}/ios/VirgaKit/Tests/VirgaCoreTests/CoreParityTests.swift, ${wt}/ios/VirgaKit/Tests/VirgaTestSupport/Parity.swift.
- Swift 6.4.2 for Linux is at ${SWIFT}. Prefix every shell command that runs swift with \`export PATH=${SWIFT}:$PATH;\`. Build and test from ${wt}/ios/VirgaKit: \`swift build\`, \`swift test\` (the whole package), \`swift test --filter <Suite>\` while iterating. There is no Xcode or SwiftUI here; logic targets must compile on Linux.
- Node: ${wt}/node_modules is a symlink to the main checkout's (never npm install). From ${wt}: \`npm run parity:write\` (all fixtures; or \`PARITY_ONLY=<name> npm run parity:write\`), \`PARITY_ALLOW_PENDING=1 npx vitest run ios/parity\`, \`npm run parity:stamp -- <web file>\`, \`npx eslint ios\`, \`npx prettier --write <your new .js files>\`.
- The web app's own tests (src/**/*.test.js next to each module) are your best source of edge-case inputs and of what each function is meant to do.
- Earlier waves are merged into your base. \`node ios/parity/sync.mjs status\` and ios/parity/modules/*.json say what is ported and where; their Swift code is the API you build on (summaries below). Reuse their types and functions; never define a second copy.

${args.context ? '## What earlier waves built (merged into your base)\n' + args.context + '\n\n' : ''}## Rules
- Change nothing outside ios/ (the web app is the reference). If you find a bug in the web code, report it in your result; don't fix it.
- Stay inside your domain; touch shared files only as your brief allows. Don't edit Package.swift unless your brief says so.
- Swift 6 strict concurrency, no third-party packages, Linux-compatible (PORTING.md).
- Before you finish, the whole package must build with \`swift test\` passing, \`PARITY_ALLOW_PENDING=1 npx vitest run ios/parity\` passing, and \`npx eslint ios\` clean.
- Commit early and often in ${wt} on ${branch} (\`git add -A ios\`): after each module or two is ported and its tests pass, not once at the end. Sessions can be cut off by usage limits, and committed work survives.
- If you find uncommitted changes or a commit titled "WIP:" from an earlier attempt that was interrupted, don't start over: read what it did (git log -p, git diff), check it against the web code, keep what's right, and finish it.
- Commit in ${wt} on ${branch} (\`git add -A ios\`). Message: a short summary line, a body, then exactly these two trailer lines:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: ${args.session || 'https://claude.ai/code/session_014phnNr9z1acDrdxx98Huz8'}
  Don't push. Don't write any model name in code, comments or commit messages.`

const PORT_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    committed: { type: 'boolean' },
    commits: { type: 'array', items: { type: 'string' } },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          web: { type: 'string' },
          status: { type: 'string', enum: ['ported', 'partial', 'exempt', 'pending'] },
          swift: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
        required: ['web', 'status'],
      },
    },
    fixtures: { type: 'array', items: { type: 'string' }, description: 'fixture names added or changed' },
    parityCases: { type: 'number', description: 'total parity cases in your fixtures' },
    swiftTests: { type: 'string', description: 'e.g. "412 tests in 38 suites passed"' },
    apiForDownstream: { type: 'string', description: 'For agents after you: the main Swift types and functions you created, with signatures and file paths; conventions chosen; what to reuse rather than redefine' },
    gaps: { type: 'array', items: { type: 'string' } },
    webBugsNoticed: { type: 'array', items: { type: 'string' } },
  },
  required: ['domain', 'committed', 'files', 'swiftTests', 'apiForDownstream', 'gaps'],
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    committed: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          web: { type: 'string', description: 'web file and function' },
          issue: { type: 'string' },
          fixed: { type: 'boolean' },
        },
        required: ['severity', 'issue', 'fixed'],
      },
    },
    casesAdded: { type: 'number' },
    swiftTests: { type: 'string' },
    remainingGaps: { type: 'array', items: { type: 'string' } },
    apiForDownstream: { type: 'string', description: 'The (possibly corrected) API summary for later agents' },
  },
  required: ['domain', 'committed', 'findings', 'swiftTests', 'remainingGaps', 'apiForDownstream'],
}

function portPrompt(chain, step, earlier) {
  const prior = earlier.length
    ? `\n## Earlier in your chain (already committed in your worktree; build on it, don't redefine it)\n${earlier.map((e) => `### ${e.domain}\n${e.api}\nKnown gaps: ${(e.gaps || []).join('; ') || 'none'}`).join('\n\n')}\n`
    : ''
  return `${COMMON(chain.wt, chain.branch)}

## Your domain: ${step.domain} → target ${step.target}
${step.brief}

Web files (from ios/parity/modules/${step.mapName || step.domain}.json):
${(FILES[step.domain] || []).map((f) => `- ${f}`).join('\n')}
${prior}
## What to deliver
1. A faithful Swift port of every web file above, per PORTING.md: a file per module with a \`// Ports <path>\` header, an enum namespace with the web's function names, Codable structs with the web's field names, @MainActor @Observable models for stateful hooks, all I/O injected.
2. Parity: case generators ios/parity/cases/${step.domain}.<module>.js (one per module with pure logic, or a few modules per generator) with adversarial inputs (borrow every interesting input from the module's own *.test.js), fixtures written with \`npm run parity:write\`, and Swift parity tests in ios/VirgaKit/Tests/${step.target}Tests/ that run every case. For network code, use withFakeFetch and MockTransport when they exist in your worktree.
3. Behaviour tests for what isn't pure (models, stores, I/O).
4. The module map ios/parity/modules/${step.mapName || step.domain}.json updated for each file: status (ported / partial with note / exempt with note; never left pending), swift paths, fixtures, synced (\`npm run parity:stamp -- <file>\`).
5. Commits.

Work file by file: list its exports (\`grep -n "^export" <file>\`), port all of them, test them. Don't stub or skip silently. If something truly can't live in a logic target (DOM, canvas, IndexedDB, React rendering), mark it partial or exempt with the exact reason and say where the iOS equivalent will live.

## Your result
Return the structured result. \`apiForDownstream\` is what the agents after you get: make it precise (type and function names, signatures, file paths, conventions).`
}

function auditPrompt(chain, step, port) {
  return `${COMMON(chain.wt, chain.branch)}

## Your job: independently audit and harden the ${step.domain} port (target ${step.target})
Another engineer just ported this domain and committed in your worktree. Their summary is below; don't trust it. Verify against the web code.

The domain's brief, for reference:
${step.brief}

For each web file in ios/parity/modules/${step.mapName || step.domain}.json:
1. List every export (functions, constants, classes) and each branch of behaviour. Read the web code and the Swift port side by side and check they behave the same. Look hard at: UTF-16 vs Character indexing; regex semantics (JS \\w \\b \\d are ASCII); Math.round and toFixed; time zones and DST; null/undefined/empty-string handling and JS truthiness; sort stability (JS sort is stable, Swift's sort is not: use a stable sort where order of equal elements matters); integer vs float arithmetic; default parameter values; error messages and user-visible copy, word for word.
2. Check the fixtures exercise it properly: every exported pure function has cases, the inputs cover every branch, the edge cases and the inputs from the web module's own *.test.js. Add cases where coverage is thin (edit or add generators, \`npm run parity:write\`). Recorded-fetch fixtures for network calls where applicable.
3. Check the module map is honest: ported means all of it; partial/exempt notes are true; Swift headers name their web files; synced is stamped.
4. Fix every discrepancy in the Swift code (never the web code), with tests that would have caught it.
5. Run everything: \`swift test\`, \`PARITY_ALLOW_PENDING=1 npx vitest run ios/parity\`, \`npx eslint ios\`.
6. Commit.

The porter's summary:
${JSON.stringify(port, null, 1)}

Return the structured audit. \`apiForDownstream\` should be the porter's summary corrected for anything you changed.`
}

async function runChain(chain) {
  const earlier = []
  const results = []
  for (const step of chain.steps) {
    let port = null
    if (step.auditOnly) {
      log(`${chain.name}: auditing ${step.domain} (already ported)`)
      port = { domain: step.domain, note: step.portNote || 'Ported earlier; the porter\'s full summary is in ' + step.portSummaryPath + ' (read it).' }
    } else {
      log(`${chain.name}: porting ${step.domain}`)
      port = await agent(portPrompt(chain, step, earlier), { label: `port:${step.domain}`, phase: chain.phase, schema: PORT_SCHEMA })
      if (!port) {
        log(`${chain.name}: the ${step.domain} port did not return; auditing what is there`)
      }
    }
    const audit = await agent(auditPrompt(chain, step, port || { domain: step.domain, note: 'The porter did not return a summary. Check what was committed (git log) and finish the port as well as auditing it.' }), { label: `audit:${step.domain}`, phase: chain.phase, schema: AUDIT_SCHEMA })
    earlier.push({ domain: step.domain, api: (audit && audit.apiForDownstream) || (port && port.apiForDownstream) || '(no summary; read the code)', gaps: (audit && audit.remainingGaps) || (port && port.gaps) || [] })
    results.push({ domain: step.domain, port, audit })
    log(`${chain.name}: ${step.domain} done — ${audit ? audit.findings.length + ' audit findings, ' + audit.swiftTests : 'no audit result'}`)
  }
  return results
}

const A = { name: 'Chain A', phase: 'Chain A', wt: args.wtA, branch: args.branchA, steps: args.chainA }
const B = { name: 'Chain B', phase: 'Chain B', wt: args.wtB, branch: args.branchB, steps: args.chainB }

const [a, b] = await parallel([() => runChain(A), () => runChain(B)])
return { chainA: a, chainB: b }
