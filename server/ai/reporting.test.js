// The gateway's Custom Reporting metadata: every request is tagged app:virga
// and with its feature, and carries the requester's DID as `user`, so spend
// can be read per feature and per account.

import { describe, it, expect } from 'vitest';
import {
  APP_TAG,
  buildReporting,
  isEnabled,
  normalizeTags,
  normalizeUser,
} from './reporting.js';

const DID = 'did:plc:aiclientfixture000000000000';

describe('buildReporting', () => {
  it('tags the call app:virga and with its feature, and names the DID', () => {
    expect(APP_TAG).toBe('app:virga');
    expect(buildReporting({ feature: 'alt-text', did: DID, env: {} })).toEqual({
      user: DID,
      tags: ['app:virga', 'feature:alt-text'],
    });
  });

  it('attaches no user for something that is not a DID', () => {
    const out = buildReporting({
      feature: 'posting-adviser',
      did: 'alice.example.com',
      env: {},
    });
    expect(out).toEqual({ tags: ['app:virga', 'feature:posting-adviser'] });
    expect(out).not.toHaveProperty('user');
  });

  it('adds the Vercel environment it runs in, and only a known one', () => {
    expect(
      buildReporting({
        feature: 'alt-text',
        did: DID,
        env: { VERCEL_ENV: 'preview' },
      }).tags,
    ).toEqual(['app:virga', 'env:preview', 'feature:alt-text']);
    expect(
      buildReporting({
        feature: 'alt-text',
        env: { VERCEL_ENV: 'something-else' },
      }).tags,
    ).toEqual(['app:virga', 'feature:alt-text']);
  });

  it('sends nothing when AI_GATEWAY_REPORTING=false', () => {
    expect(
      buildReporting({
        feature: 'alt-text',
        did: DID,
        env: { AI_GATEWAY_REPORTING: 'false' },
      }),
    ).toEqual({ tags: [] });
    expect(
      buildReporting({
        feature: 'alt-text',
        did: DID,
        env: { AI_GATEWAY_REPORTING: ' FALSE ' },
      }),
    ).toEqual({ tags: [] });
    expect(isEnabled({})).toBe(true);
    expect(isEnabled({ AI_GATEWAY_REPORTING: 'true' })).toBe(true);
  });

  it('reads process.env when no env is given', () => {
    const saved = {
      r: process.env.AI_GATEWAY_REPORTING,
      v: process.env.VERCEL_ENV,
    };
    try {
      delete process.env.VERCEL_ENV;
      process.env.AI_GATEWAY_REPORTING = 'false';
      expect(buildReporting({ feature: 'alt-text', did: DID })).toEqual({
        tags: [],
      });
      delete process.env.AI_GATEWAY_REPORTING;
      expect(buildReporting({ feature: 'alt-text', did: DID }).tags).toEqual([
        'app:virga',
        'feature:alt-text',
      ]);
    } finally {
      if (saved.r === undefined) delete process.env.AI_GATEWAY_REPORTING;
      else process.env.AI_GATEWAY_REPORTING = saved.r;
      if (saved.v === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = saved.v;
    }
  });
});

describe('normalizeUser / normalizeTags', () => {
  it('trims and caps a user, and drops a blank one', () => {
    expect(normalizeUser('  did:plc:x  ')).toBe('did:plc:x');
    expect(normalizeUser('d'.repeat(300))).toHaveLength(256);
    expect(normalizeUser('   ')).toBeUndefined();
    expect(normalizeUser(42)).toBeUndefined();
  });

  it('keeps tags within the gateway’s limits: strings, trimmed, ≤64 chars, deduped, ≤10', () => {
    expect(normalizeTags([' a ', 'a', '', 7, null, 'b'])).toEqual(['a', 'b']);
    expect(normalizeTags(['x'.repeat(80)])).toEqual(['x'.repeat(64)]);
    expect(
      normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`)),
    ).toHaveLength(10);
    expect(normalizeTags('not a list')).toEqual([]);
  });
});
