#!/usr/bin/env node
// Keeping the iOS app in step with the web app, file by file.
//
//   node ios/parity/sync.mjs status            how far each domain has got
//   node ios/parity/sync.mjs drift [--github]  web files changed since their
//                                              Swift port was last synced
//   node ios/parity/sync.mjs stamp <file|domain>...
//                                              record that the Swift side now
//                                              matches these web files
//
// `npm run parity:drift` and `npm run parity:stamp -- <file>` run it. Drift
// is a reminder, not a failure: a web change that alters behaviour already
// fails the parity fixtures; drift catches the rest (copy, layout, flows) for
// whoever looks after the iOS app. With --github it writes warnings and a job
// summary for GitHub Actions.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const MODULES = path.join(ROOT, 'ios/parity/modules');

/** Every web source file the map must cover: src/, tests excluded. */
export function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!/\.test\.[jt]sx?$/.test(entry.name))
        out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  })(path.join(ROOT, 'src'));
  return out.sort();
}

export function fileHash(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, file)))
    .digest('hex')
    .slice(0, 12);
}

export function loadModuleMap() {
  return fs
    .readdirSync(MODULES)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      ...JSON.parse(fs.readFileSync(path.join(MODULES, f), 'utf8')),
      $path: path.join(MODULES, f),
    }));
}

function save(domain) {
  const { $path, ...rest } = domain;
  fs.writeFileSync($path, `${JSON.stringify(rest, null, 2)}\n`);
}

function status() {
  const rows = [];
  const totals = { ported: 0, partial: 0, exempt: 0, pending: 0 };
  for (const d of loadModuleMap()) {
    const counts = { ported: 0, partial: 0, exempt: 0, pending: 0 };
    for (const entry of Object.values(d.files))
      counts[entry.status] = (counts[entry.status] || 0) + 1;
    for (const k of Object.keys(totals)) totals[k] += counts[k] || 0;
    rows.push(
      `${d.domain.padEnd(14)} wave ${d.wave}  ${d.target.padEnd(14)} ported ${String(counts.ported).padStart(3)}  partial ${String(counts.partial).padStart(3)}  exempt ${String(counts.exempt).padStart(3)}  pending ${String(counts.pending).padStart(3)}`,
    );
  }
  console.log(rows.join('\n'));
  console.log(
    `\ntotal          ported ${totals.ported}, partial ${totals.partial}, exempt ${totals.exempt}, pending ${totals.pending}`,
  );
}

function drift({ github = false } = {}) {
  const drifted = [];
  for (const d of loadModuleMap()) {
    for (const [file, entry] of Object.entries(d.files)) {
      if (entry.status !== 'ported' && entry.status !== 'partial') continue;
      if (!fs.existsSync(path.join(ROOT, file))) continue;
      const now = fileHash(file);
      if (now !== entry.synced)
        drifted.push({ domain: d.domain, file, swift: entry.swift });
    }
  }
  if (drifted.length === 0) {
    console.log(
      'No drift: every ported web file is as it was when its Swift port was last synced.',
    );
  } else {
    console.log(
      `${drifted.length} web file(s) changed since their Swift port was last synced:\n`,
    );
    for (const d of drifted)
      console.log(`  ${d.file}  →  ${d.swift.join(', ')}  [${d.domain}]`);
    console.log(
      '\nBring the Swift side in line, then: npm run parity:stamp -- <file>',
    );
  }
  if (github) {
    for (const d of drifted) {
      console.log(
        `::warning file=${d.file},title=iOS port may be behind::${d.file} changed since ${d.swift.join(', ')} was last synced. Update the Swift port, then run npm run parity:stamp -- ${d.file}`,
      );
    }
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const lines = ['## iOS parity drift', ''];
      if (drifted.length === 0)
        lines.push('Every ported web file matches its last sync.');
      else {
        lines.push('| Web file | Swift port | Domain |', '| --- | --- | --- |');
        for (const d of drifted)
          lines.push(
            `| \`${d.file}\` | ${d.swift.map((s) => `\`${s}\``).join('<br>')} | ${d.domain} |`,
          );
      }
      fs.appendFileSync(summary, `${lines.join('\n')}\n`);
    }
  }
  return drifted;
}

function stamp(targets) {
  if (targets.length === 0) {
    console.error('stamp: name web files (src/...) or domains to stamp');
    process.exit(2);
  }
  const domains = loadModuleMap();
  let stamped = 0;
  for (const target of targets) {
    const wanted = target.replace(/^\.\//, '');
    let matched = false;
    for (const d of domains) {
      for (const [file, entry] of Object.entries(d.files)) {
        if (file !== wanted && d.domain !== wanted) continue;
        matched = true;
        if (entry.status !== 'ported' && entry.status !== 'partial') continue;
        entry.synced = fileHash(file);
        stamped++;
      }
    }
    if (!matched) {
      console.error(
        `stamp: ${target} is neither a mapped web file nor a domain`,
      );
      process.exit(2);
    }
  }
  for (const d of domains) save(d);
  console.log(`Stamped ${stamped} file(s).`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [command = 'status', ...rest] = process.argv.slice(2);
  if (command === 'status') status();
  else if (command === 'drift') {
    const drifted = drift({ github: rest.includes('--github') });
    if (rest.includes('--strict') && drifted.length) process.exit(1);
  } else if (command === 'stamp')
    stamp(rest.filter((a) => !a.startsWith('--')));
  else {
    console.error(`Unknown command ${command}. Use status, drift or stamp.`);
    process.exit(2);
  }
}
