// The module map: every file under src/ is assigned to one domain of the iOS
// port (ios/parity/modules/<domain>.json) and says where its Swift
// counterpart is, or why it has none. A web file added, moved or deleted
// fails here until the map says what the iOS app does about it.
//
// Statuses:
//   ported   the Swift files listed do what this file does
//   partial  some of it; `note` says what isn't there yet
//   exempt   nothing on iOS, deliberately; `note` says why
//   pending  not done yet (allowed only with PARITY_ALLOW_PENDING=1)
//
// `synced` is the first 12 hex digits of the file's SHA-256 when the Swift
// side was last brought in line with it. `npm run parity:drift` lists the web
// files changed since; `npm run parity:stamp -- <file>` records a sync.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadModuleMap, sourceFiles, ROOT } from './sync.mjs';

const ALLOW_PENDING = process.env.PARITY_ALLOW_PENDING === '1';
const STATUSES = new Set(['ported', 'partial', 'exempt', 'pending']);
const here = path.dirname(fileURLToPath(import.meta.url));

describe('module map', () => {
  const domains = loadModuleMap();
  const entries = domains.flatMap((d) =>
    Object.entries(d.files).map(([file, entry]) => ({
      domain: d.domain,
      target: d.target,
      file,
      entry,
    })),
  );

  it('lists every web source file exactly once', () => {
    const seen = new Map();
    const dupes = [];
    for (const { domain, file } of entries) {
      if (seen.has(file))
        dupes.push(`${file} (${seen.get(file)} and ${domain})`);
      seen.set(file, domain);
    }
    expect(dupes, 'files listed in two domains').toEqual([]);
    const missing = sourceFiles().filter((f) => !seen.has(f));
    expect(
      missing,
      'web files no domain lists: add each to ios/parity/modules/<domain>.json',
    ).toEqual([]);
    const gone = [...seen.keys()].filter(
      (f) => !fs.existsSync(path.join(ROOT, f)),
    );
    expect(gone, 'listed files that no longer exist').toEqual([]);
  });

  it('gives every domain a target and a wave', () => {
    for (const d of domains) {
      expect(typeof d.target, d.domain).toBe('string');
      expect(
        fs.existsSync(path.join(ROOT, 'ios/VirgaKit/Sources', d.target)),
        `${d.domain}: no target ${d.target}`,
      ).toBe(true);
      expect(Number.isInteger(d.wave), d.domain).toBe(true);
    }
  });

  it('gives every entry a known status, with what it needs', () => {
    const problems = [];
    for (const { file, entry } of entries) {
      if (!STATUSES.has(entry.status))
        problems.push(`${file}: unknown status ${entry.status}`);
      if (entry.status === 'pending' && !ALLOW_PENDING)
        problems.push(`${file}: still pending`);
      if (
        (entry.status === 'exempt' || entry.status === 'partial') &&
        !entry.note
      )
        problems.push(`${file}: ${entry.status} needs a note saying why`);
      if (entry.status === 'ported' || entry.status === 'partial') {
        if (!Array.isArray(entry.swift) || entry.swift.length === 0)
          problems.push(`${file}: ${entry.status} but names no Swift file`);
        if (!/^[0-9a-f]{12}$/.test(entry.synced || ''))
          problems.push(
            `${file}: ${entry.status} needs \`synced\` (npm run parity:stamp -- ${file})`,
          );
      }
    }
    expect(problems).toEqual([]);
  });

  it('names Swift files that exist and say which web file they port', () => {
    const problems = [];
    for (const { file, entry } of entries) {
      for (const swift of entry.swift || []) {
        const full = path.join(ROOT, swift);
        if (!fs.existsSync(full)) {
          problems.push(`${file}: ${swift} does not exist`);
          continue;
        }
        if (entry.status === 'exempt') continue;
        // A Swift file says what it ports in its header, so the map can be
        // read from either side.
        const head = fs
          .readFileSync(full, 'utf8')
          .split('\n')
          .slice(0, 40)
          .join('\n');
        if (!head.includes(file))
          problems.push(
            `${swift}: its header doesn't name ${file} (write \`// Ports ${file}\`)`,
          );
      }
    }
    expect(problems).toEqual([]);
  });

  it('has a case generator for every fixture name it mentions', () => {
    const cases = new Set(
      fs
        .readdirSync(path.join(here, 'cases'))
        .filter((f) => !f.startsWith('_'))
        .map((f) => path.basename(f, '.js')),
    );
    const problems = [];
    for (const { file, entry } of entries) {
      for (const name of entry.fixtures || [])
        if (!cases.has(name))
          problems.push(`${file}: no ios/parity/cases/${name}.js`);
    }
    expect(problems).toEqual([]);
  });
});
