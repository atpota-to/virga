import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
const { rewrites, crons, functions, headers } = config;
const catchAll = rewrites.find((r) => r.destination === '/index.html');
const matchesCatchAll = (path) => new RegExp(`^${catchAll.source}$`).test(path);

describe('vercel.json functions', () => {
  it('gives the five area functions their durations', () => {
    expect(functions).toEqual({
      'api/oauth/[action].js': { maxDuration: 60 },
      'api/schedule/[action].js': { maxDuration: 60 },
      'api/self-destruct/[action].js': { maxDuration: 60 },
      'api/ai/[action].js': { maxDuration: 60 },
      'api/limits/[action].js': { maxDuration: 30 },
    });
  });

  it('names files that exist (a pattern that matches nothing fails the deployment)', () => {
    for (const file of Object.keys(functions)) expect(existsSync(new URL(file, root)), file).toBe(true);
  });
});

describe('vercel.json crons', () => {
  it('runs both workers every minute', () => {
    expect(crons).toEqual([
      { path: '/api/schedule/run', schedule: '* * * * *' },
      { path: '/api/self-destruct/run', schedule: '* * * * *' },
    ]);
  });

  it('points each cron at a router that has a run action', () => {
    for (const { path } of crons) {
      const [, area, action] = path.split('/').filter(Boolean);
      expect(action).toBe('run');
      const text = readFileSync(new URL(`api/${area}/[action].js`, root), 'utf8');
      expect(text).toMatch(/\brun\b/);
    }
  });

  it('has no `schedules` key beside the crons (a path in both runs twice)', () => {
    expect(config.schedules).toBeUndefined();
  });
});

describe('vercel.json rewrites', () => {
  it('serves both OAuth clients’ metadata and the JWKS from their fixed URLs', () => {
    expect(rewrites.slice(0, -1)).toEqual([
      { source: '/oauth-client-metadata.json', destination: '/api/client-metadata' },
      { source: '/api/oauth/client-metadata.json', destination: '/api/oauth/client-metadata' },
      { source: '/api/oauth/jwks.json', destination: '/api/oauth/jwks' },
    ]);
  });

  it('puts the SPA catch-all last, excluding api/ and assets/', () => {
    expect(rewrites.at(-1)).toEqual({ source: '/((?!api/|assets/).*)', destination: '/index.html' });
    for (const path of ['/api/oauth/jwks.json', '/api/oauth/login', '/api/schedule/list', '/api/self-destruct/run', '/assets/index-abc.js']) {
      expect(matchesCatchAll(path), path).toBe(false);
    }
    for (const path of ['/', '/settings/account', '/oauth/return', '/oauth/callback', '/backend/jwks.json']) {
      expect(matchesCatchAll(path), path).toBe(true);
    }
  });

  it('sends nothing to another host, and nothing to the old backend', () => {
    for (const { source, destination } of rewrites) {
      expect(destination.startsWith('/'), destination).toBe(true);
      expect(destination).not.toMatch(/cocoon|anisota/i);
      expect(source.startsWith('/backend')).toBe(false);
    }
    expect(JSON.stringify(config)).not.toMatch(/cocoon|anisota/i);
  });
});

describe('vercel.json headers', () => {
  it('keeps the security headers and the immutable asset cache', () => {
    const all = headers.find((h) => h.source === '/(.*)').headers;
    expect(all).toEqual(expect.arrayContaining([
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ]));
    expect(headers.find((h) => h.source === '/assets/(.*)').headers).toEqual([
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ]);
  });

  it('adds no CORS headers (the router answers allowed origins itself)', () => {
    expect(JSON.stringify(headers)).not.toMatch(/Access-Control/i);
  });
});
