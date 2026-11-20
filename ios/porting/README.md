# Porting tooling

How the iOS port was produced, so a later session can carry on the same way.
See ios/STATUS.md for what is done and what is left.

The port was written by Claude Code agents working in git worktrees
(`.worktrees/<name>`, ignored by git), each on its own branch, two or four at
a time, and merged into the iOS branch between waves. Every domain went
through two agents in turn: a **porter**, which ports the web files, writes
the parity case generators and Swift tests and records each file in
ios/parity/modules/, and an independent **auditor**, which checks the port
against the web code, widens the fixtures and fixes what doesn't match.

- `port-wave.workflow.js` is the Workflow script that ran a wave: two chains,
  each a list of steps (a domain, its Swift target and a brief), every port
  followed by its audit. Its prompts (`COMMON`, `portPrompt`, `auditPrompt`)
  are the briefs the agents worked from.
- `mkprompt.mjs` builds the same prompts outside the Workflow tool, for
  running the steps as individual background agents:

  ```bash
  node ios/porting/mkprompt.mjs <args.json> <A|B> <step index> <port|audit> <out.txt>
  ```

  `args.json` has the shape described at the top of `port-wave.workflow.js`
  (`swift` is the toolchain's bin directory, which
  ios/scripts/install-swift-linux.sh prints).

Setting up a worktree for a chain:

```bash
git worktree add -b ios/<chain> .worktrees/<chain> <base branch>
ln -s "$PWD/node_modules" .worktrees/<chain>/node_modules
```

Lessons the briefs carry (and ios/PORTING.md records): commit after every
module or two, since agents can be cut off by usage or billing limits; when
an agent was cut off, commit what it left as `WIP: …` and tell the next one
to continue from it; never let two concurrent agents define the same type
(merge each wave's branches and run `swift test` before the next wave).
