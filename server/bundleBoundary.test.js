import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The browser bundle must never reach server code: it would drag the
// service-role client and Node built-ins into the build. ESLint enforces the
// same for static imports; this also catches dynamic import() and re-exports.
// Tests aren't bundled, so they are left out.

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'src');
const FORBIDDEN_PACKAGES = [/^@supabase\//, /^@atproto\/oauth-client-node(\/|$)/, /^node:/];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.(js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

/** Every module specifier a file names: import/export ... from, bare import, and import(). */
function specifiersOf(text) {
  const found = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) found.push(m[2]);
  return found;
}

function violation(file, spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const target = spec.startsWith('/') ? join(ROOT, spec) : resolve(dirname(file), spec);
    const rel = relative(ROOT, target).split(sep).join('/');
    if (rel === 'server' || rel.startsWith('server/') || rel === 'api' || rel.startsWith('api/')) return rel;
    return null;
  }
  return FORBIDDEN_PACKAGES.some((re) => re.test(spec)) ? spec : null;
}

describe('the browser bundle boundary', () => {
  it('finds the specifiers it has to check', () => {
    expect(
      specifiersOf(`
        import a from '../server/x.js';
        import { b } from "./b.js";
        import './side-effect.js';
        export { c } from '../../api/c.js';
        const d = await import('../server/d.js');
      `),
    ).toEqual(['../server/x.js', './b.js', '../../api/c.js', './side-effect.js', '../server/d.js']);
  });

  it('keeps src/ off server/, api/ and Node-only packages', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(0);
    const problems = [];
    for (const file of files) {
      for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
        const hit = violation(file, spec);
        if (hit) problems.push(`${relative(ROOT, file)} → ${spec}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
