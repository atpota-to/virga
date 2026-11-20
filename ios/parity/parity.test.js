// The parity fixtures: the web app's own functions, run over fixed inputs,
// with their output written to ios/parity/fixtures/<name>.json for the Swift
// tests to hold the iOS app to (ios/parity/README.md).
//
//   npm run parity:write    write every fixture from the current web code
//   npm test                (and npm run parity:check) fail if any fixture
//                           is stale, missing, orphaned or nondeterministic
//
// A stale fixture means the web app's behaviour changed: regenerate it, then
// `swift test` in ios/VirgaKit says which Swift port has to follow.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Before any case module is imported (they're loaded lazily below), so
// nothing a generator computes depends on the machine's zone.
process.env.TZ = 'UTC';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');
const WRITE = process.env.PARITY_WRITE === '1';
const ONLY = (process.env.PARITY_ONLY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const loaders = import.meta.glob(['./cases/*.js', '!./cases/_*.js']);
const nameOf = (file) => path.basename(file, '.js');

async function build(file) {
  const mod = await loaders[file]();
  if (typeof mod.default !== 'function') {
    throw new Error(`${file} must export a default function returning cases`);
  }
  if (!Array.isArray(mod.sources) || mod.sources.length === 0) {
    throw new Error(
      `${file} must export \`sources\`: the web files it exercises`,
    );
  }
  const cases = await mod.default();
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`${file} returned no cases`);
  }
  const ids = new Set();
  for (const c of cases) {
    if (!c || typeof c.fn !== 'string' || typeof c.id !== 'string') {
      throw new Error(`${file}: every case needs a string \`id\` and \`fn\``);
    }
    const key = `${c.fn}\u0000${c.id}`;
    if (ids.has(key))
      throw new Error(`${file}: duplicate case id ${c.id} for ${c.fn}`);
    ids.add(key);
  }
  const fixture = { name: nameOf(file), sources: mod.sources, cases };
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

function firstDifference(actualText, expectedText) {
  try {
    const actual = JSON.parse(actualText);
    const expected = JSON.parse(expectedText);
    const byKey = (f) =>
      new Map(f.cases.map((c) => [`${c.fn} [${c.id}]`, JSON.stringify(c)]));
    const a = byKey(actual);
    const e = byKey(expected);
    const changed = [];
    for (const [k, v] of a)
      if (e.get(k) !== v) changed.push(e.has(k) ? `changed ${k}` : `new ${k}`);
    for (const k of e.keys()) if (!a.has(k)) changed.push(`removed ${k}`);
    if (JSON.stringify(actual.sources) !== JSON.stringify(expected.sources))
      changed.unshift('sources changed');
    return (
      changed.slice(0, 12).join('\n    ') +
      (changed.length > 12 ? `\n    … ${changed.length - 12} more` : '')
    );
  } catch {
    return 'the committed file is not valid JSON';
  }
}

const files = Object.keys(loaders)
  .filter((f) => ONLY.length === 0 || ONLY.includes(nameOf(f)))
  .sort();

describe('parity fixtures', () => {
  if (WRITE) fs.mkdirSync(FIXTURES, { recursive: true });

  for (const file of files) {
    const name = nameOf(file);
    const target = path.join(FIXTURES, `${name}.json`);

    it(`${name} is deterministic and ${WRITE ? 'written' : 'up to date'}`, async () => {
      const first = await build(file);
      const second = await build(file);
      expect(
        second === first,
        `${name}: two runs of the generator disagree; it depends on time, randomness or order`,
      ).toBe(true);

      if (WRITE) {
        fs.writeFileSync(target, first);
        return;
      }
      const committed = fs.existsSync(target)
        ? fs.readFileSync(target, 'utf8')
        : null;
      if (committed === null) {
        throw new Error(
          `ios/parity/fixtures/${name}.json is missing. Run \`npm run parity:write\`.`,
        );
      }
      if (committed !== first) {
        throw new Error(
          `ios/parity/fixtures/${name}.json is stale: the web app's output changed.\n` +
            `    ${firstDifference(first, committed)}\n` +
            `Run \`npm run parity:write\`, then \`swift test\` in ios/VirgaKit to see which Swift port must follow.`,
        );
      }
    });
  }

  if (ONLY.length === 0) {
    it('has no fixture without a generator', () => {
      const generated = new Set(
        Object.keys(loaders).map((f) => `${nameOf(f)}.json`),
      );
      const orphans = fs.existsSync(FIXTURES)
        ? fs
            .readdirSync(FIXTURES)
            .filter((f) => f.endsWith('.json') && !generated.has(f))
        : [];
      if (WRITE) {
        for (const orphan of orphans)
          fs.unlinkSync(path.join(FIXTURES, orphan));
        return;
      }
      expect(
        orphans,
        'fixtures whose generator is gone; delete them or run `npm run parity:write`',
      ).toEqual([]);
    });
  }
});
