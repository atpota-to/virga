import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createReq, createRes } from './test/http.js';

// The five api/<area>/[action].js functions are thin: each builds a router
// over exactly the handler modules the design names. The handlers are mocked
// here (each answers with its own module path), so this pins the wiring
// whatever the handlers do. Vite can't resolve an import of a file that
// doesn't exist even when it is mocked, so an entrypoint whose handlers aren't
// all written yet has only its import list checked.

const MAP = {
  'api/oauth/[action].js': {
    'client-metadata': 'server/oauth/handlers/clientMetadata.js',
    // The published names, in case the dynamic segment matches before the
    // rewrite that strips the extension.
    'client-metadata.json': 'server/oauth/handlers/clientMetadata.js',
    jwks: 'server/oauth/handlers/jwks.js',
    'jwks.json': 'server/oauth/handlers/jwks.js',
    login: 'server/oauth/handlers/login.js',
    callback: 'server/oauth/handlers/callback.js',
    session: 'server/oauth/handlers/session.js',
    proxy: 'server/oauth/handlers/proxy.js',
    'upload-blob': 'server/oauth/handlers/uploadBlob.js',
    logout: 'server/oauth/handlers/logout.js',
  },
  'api/schedule/[action].js': Object.fromEntries(
    ['create', 'list', 'get', 'media', 'update', 'reorder', 'cancel', 'run'].map((a) => [a, `server/schedule/handlers/${a}.js`]),
  ),
  'api/self-destruct/[action].js': Object.fromEntries(
    ['create', 'list', 'cancel', 'run'].map((a) => [a, `server/timers/handlers/${a}.js`]),
  ),
  'api/ai/[action].js': {
    'analyze-post': 'server/ai/handlers/analyzePost.js',
    'synthesize-style': 'server/ai/handlers/synthesizeStyle.js',
    'alt-text': 'server/ai/handlers/altText.js',
  },
  'api/limits/[action].js': { status: 'server/limits/handlers/status.js' },
};

// vi.mock is hoisted and takes literal paths, so each module is listed once.
const answer = (path) => ({ default: vi.fn(async (req, res) => res.status(200).json({ success: true, handler: path })) });
vi.mock('./oauth/handlers/clientMetadata.js', () => answer('server/oauth/handlers/clientMetadata.js'));
vi.mock('./oauth/handlers/jwks.js', () => answer('server/oauth/handlers/jwks.js'));
vi.mock('./oauth/handlers/login.js', () => answer('server/oauth/handlers/login.js'));
vi.mock('./oauth/handlers/callback.js', () => answer('server/oauth/handlers/callback.js'));
vi.mock('./oauth/handlers/session.js', () => answer('server/oauth/handlers/session.js'));
vi.mock('./oauth/handlers/proxy.js', () => answer('server/oauth/handlers/proxy.js'));
vi.mock('./oauth/handlers/uploadBlob.js', () => answer('server/oauth/handlers/uploadBlob.js'));
vi.mock('./oauth/handlers/logout.js', () => answer('server/oauth/handlers/logout.js'));
vi.mock('./schedule/handlers/create.js', () => answer('server/schedule/handlers/create.js'));
vi.mock('./schedule/handlers/list.js', () => answer('server/schedule/handlers/list.js'));
vi.mock('./schedule/handlers/get.js', () => answer('server/schedule/handlers/get.js'));
vi.mock('./schedule/handlers/media.js', () => answer('server/schedule/handlers/media.js'));
vi.mock('./schedule/handlers/update.js', () => answer('server/schedule/handlers/update.js'));
vi.mock('./schedule/handlers/reorder.js', () => answer('server/schedule/handlers/reorder.js'));
vi.mock('./schedule/handlers/cancel.js', () => answer('server/schedule/handlers/cancel.js'));
vi.mock('./schedule/handlers/run.js', () => answer('server/schedule/handlers/run.js'));
vi.mock('./timers/handlers/create.js', () => answer('server/timers/handlers/create.js'));
vi.mock('./timers/handlers/list.js', () => answer('server/timers/handlers/list.js'));
vi.mock('./timers/handlers/cancel.js', () => answer('server/timers/handlers/cancel.js'));
vi.mock('./timers/handlers/run.js', () => answer('server/timers/handlers/run.js'));
vi.mock('./ai/handlers/analyzePost.js', () => answer('server/ai/handlers/analyzePost.js'));
vi.mock('./ai/handlers/synthesizeStyle.js', () => answer('server/ai/handlers/synthesizeStyle.js'));
vi.mock('./ai/handlers/altText.js', () => answer('server/ai/handlers/altText.js'));
vi.mock('./limits/handlers/status.js', () => answer('server/limits/handlers/status.js'));

const ENTRYPOINTS = {
  'api/oauth/[action].js': () => import('../api/oauth/[action].js'),
  'api/schedule/[action].js': () => import('../api/schedule/[action].js'),
  'api/self-destruct/[action].js': () => import('../api/self-destruct/[action].js'),
  'api/ai/[action].js': () => import('../api/ai/[action].js'),
  'api/limits/[action].js': () => import('../api/limits/[action].js'),
};

const root = new URL('../', import.meta.url);

function importsOf(file) {
  const text = readFileSync(new URL(file, root), 'utf8');
  return [...text.matchAll(/^import\s+[^;]*?from\s+'([^']+)';/gm)].map((m) =>
    new URL(m[1], new URL(file, root)).pathname.slice(root.pathname.length),
  );
}

describe.each(Object.entries(MAP))('%s', (file, actions) => {
  const missing = Object.values(actions).filter((path) => !existsSync(new URL(path, root)));

  it('imports exactly the router and the handler modules the design names', () => {
    expect(importsOf(file).sort()).toEqual(['server/route.js', ...new Set(Object.values(actions))].sort());
  });

  it.skipIf(missing.length)('dispatches every action to its handler', async () => {
    const { default: route } = await ENTRYPOINTS[file]();
    expect(typeof route).toBe('function');
    for (const [action, path] of Object.entries(actions)) {
      const res = createRes();
      await route(createReq({ query: { action } }), res);
      expect(res.body, action).toEqual({ success: true, handler: path });
    }
  });

  it.skipIf(missing.length)('answers an unknown action 404', async () => {
    const { default: route } = await ENTRYPOINTS[file]();
    const res = createRes();
    await route(createReq({ query: { action: 'no-such-action' } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Not found' });
  });
});

describe('api/', () => {
  it('holds nothing but functions: no tests or helpers are deployed as endpoints', async () => {
    const { readdirSync } = await import('node:fs');
    const walk = (dir) =>
      readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`],
      );
    const files = walk('api/').sort();
    expect(files).toEqual(['api/client-metadata.js', ...Object.keys(MAP)].sort());
  });
});
