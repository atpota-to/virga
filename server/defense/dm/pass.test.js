import { describe, expect, it } from 'vitest';
import { chunkText, isDirect, sharedUri } from './pass.js';

describe('the pass’s helpers', () => {
  it('cut a reply at line ends, then spaces, never past the limit', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `• line ${i} ${'x'.repeat(30)}`).join('\n');
    const parts = chunkText(lines, 200);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.join('\n')).toBe(lines);
    expect(chunkText('a'.repeat(450), 200)).toEqual(['a'.repeat(200), 'a'.repeat(200), 'a'.repeat(50)]);
    expect(chunkText('  ')).toEqual([]);
  });

  it('tell a one-to-one conversation from a group', () => {
    expect(isDirect({ kind: { $type: 'chat.bsky.convo.defs#directConvo' } })).toBe(true);
    expect(isDirect({ kind: { $type: 'chat.bsky.convo.defs#groupConvo' }, members: [{}, {}] })).toBe(false);
    expect(isDirect({ members: [{}, {}] })).toBe(true);
    expect(isDirect({ members: [{}, {}, {}] })).toBe(false);
    expect(isDirect(null)).toBe(false);
  });

  it('read the record a message shares', () => {
    expect(sharedUri({ embed: { record: { uri: 'at://did:plc:a/app.bsky.feed.post/3x' } } })).toBe('at://did:plc:a/app.bsky.feed.post/3x');
    expect(sharedUri({ embed: { record: { record: { uri: 'at://did:plc:a/app.bsky.feed.post/3y' } } } })).toBe('at://did:plc:a/app.bsky.feed.post/3y');
    expect(sharedUri({ embed: { record: { uri: 'https://example.com' } } })).toBeNull();
    expect(sharedUri({})).toBeNull();
  });
});
