import { describe, expect, it } from 'vitest';
import { pathParts } from '../lib/router.jsx';
import { historyEvents } from '../tools/Identity.jsx';

describe('addresses', () => {
  it('split into their parts, decoded, without empties', () => {
    expect(pathParts('/')).toEqual([]);
    expect(pathParts('/reports/followers/')).toEqual(['reports', 'followers']);
    expect(pathParts('/dashboard/my%20board')).toEqual(['dashboard', 'my board']);
  });
});

describe('a DID’s history', () => {
  it('says what each operation changed, newest first, skipping nullified ones', () => {
    const log = [
      { at: '2024-01-01', handles: ['a.bsky.social'], pds: 'https://bsky.social', nullified: false },
      { at: '2024-06-01', handles: ['a.bsky.social'], pds: 'https://bsky.social', nullified: true },
      { at: '2025-01-01', handles: ['a.example.com'], pds: 'https://bsky.social', nullified: false },
      { at: '2026-01-01', handles: ['a.example.com'], pds: 'https://pds.example.com', nullified: false },
    ];
    expect(historyEvents(log).map((e) => e.text)).toEqual([
      'Moved to pds.example.com',
      'Handle changed to @a.example.com',
      'Created as @a.bsky.social on bsky.social',
    ]);
  });
});
