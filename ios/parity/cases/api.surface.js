// Virga's server API as the routers in api/*/[action].js define it: every
// area and action. The Swift client (VirgaNetwork, VirgaAPI) is held to cover
// each action the app calls, and to say which ones it deliberately doesn't
// (the crons, the OAuth plumbing a browser follows, the worker's routes), so
// a new server route can't go unnoticed by the iOS app.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { value } from './_helpers.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const API = path.join(ROOT, 'api');

/** The keys of the object literal passed to createRouter in `source`. */
function routerActions(source, file) {
  const start = source.indexOf('createRouter(');
  if (start < 0) throw new Error(`${file}: no createRouter call`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = source.slice(open + 1, end);
  const actions = [];
  for (const raw of body.split(',')) {
    const entry = raw.replace(/\/\/.*$/gm, '').trim();
    if (!entry) continue;
    const quoted = entry.match(/^['"]([^'"]+)['"]\s*:/);
    const keyed = entry.match(/^([A-Za-z_$][\w$]*)\s*:/);
    const shorthand = entry.match(/^([A-Za-z_$][\w$]*)$/);
    const key = quoted?.[1] || keyed?.[1] || shorthand?.[1];
    if (!key) throw new Error(`${file}: can't read router entry "${entry}"`);
    actions.push(key);
  }
  return actions.sort();
}

export const sources = fs
  .readdirSync(API, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => `api/${d.name}/[action].js`)
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .sort();

export default async function cases() {
  const areas = {};
  for (const file of sources) {
    const area = file.split('/')[1];
    areas[area] = routerActions(
      fs.readFileSync(path.join(ROOT, file), 'utf8'),
      file,
    );
  }
  return [value('areas', areas)];
}
