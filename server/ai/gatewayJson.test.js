// parseJSONResponse is the seam between a language model's free-form output and
// every /api/ai/* handler that expects structured data. It has to be generous
// about how the JSON is wrapped and strict about what it hands back.
//
// Generous: a model wraps its JSON in fences, a preamble or trailing
// commentary, and that commentary is most likely to carry brackets ("…left
// out [not asked for]") exactly when part of the request could not be done.
// A greedy first-bracket-to-last-bracket match would swallow it and fail.
//
// Strict: a truncated response contains complete-looking fragments
// ("checks":[] out of a half-written object), and returning one as if it were
// the whole answer is worse than failing — nothing downstream can tell a
// fragment from a genuinely sparse response.
//
// Pure module: no network, no Supabase, no timers.

import { describe, it, expect } from 'vitest';
import { parseJSONResponse } from './gateway.js';

const RESULT = JSON.stringify({
  overallStatus: 'caution',
  sentiment: { label: 'neutral', score: 0 },
  checks: [
    {
      id: 'custom',
      label: 'Stay kind',
      status: 'caution',
      note: 'Sharp.',
      excerpt: null,
    },
  ],
  suggestion: null,
  notes: 'a brace } and a bracket ] living inside a string',
});

describe('parseJSONResponse — shapes it must accept', () => {
  it('parses a bare object', () => {
    expect(parseJSONResponse(RESULT).overallStatus).toBe('caution');
  });

  it('parses a bare array', () => {
    expect(parseJSONResponse('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('strips ```json fences', () => {
    expect(
      parseJSONResponse('```json\n' + RESULT + '\n```').overallStatus,
    ).toBe('caution');
  });

  it('ignores a preamble before the JSON', () => {
    expect(
      parseJSONResponse('Here is the read:\n' + RESULT).overallStatus,
    ).toBe('caution');
  });

  it('ignores trailing commentary', () => {
    expect(
      parseJSONResponse(RESULT + '\n\nNote: the tone check was skipped.')
        .overallStatus,
    ).toBe('caution');
  });

  it('ignores trailing commentary containing brackets', () => {
    // The most likely thing a model writes when it could not do everything
    // that was asked.
    expect(
      parseJSONResponse(RESULT + '\n\nLeft out "grammar" [not requested].')
        .overallStatus,
    ).toBe('caution');
  });

  it('ignores trailing commentary containing braces', () => {
    expect(
      parseJSONResponse(RESULT + '\n\nSkipped {clarity} — nothing to flag.')
        .overallStatus,
    ).toBe('caution');
  });

  it('ignores a preamble that itself contains braces', () => {
    // The first bracket in the response is not necessarily the one that opens
    // the value we want, so the scan tries each candidate.
    expect(
      parseJSONResponse('I will judge {custom} for this:\n' + RESULT)
        .overallStatus,
    ).toBe('caution');
  });

  it('is not confused by braces and brackets inside string values', () => {
    expect(parseJSONResponse(RESULT).notes).toBe(
      'a brace } and a bracket ] living inside a string',
    );
  });

  it('handles fences plus trailing prose together', () => {
    expect(
      parseJSONResponse(
        '```json\n' + RESULT + '\n```\n\nThat covers it [mostly].',
      ).overallStatus,
    ).toBe('caution');
  });
});

describe('parseJSONResponse — what it must refuse', () => {
  const rejects = (label, body) => {
    it(label, () => {
      expect(() => parseJSONResponse(body)).toThrow(/Failed to parse JSON/);
    });
  };

  rejects('prose with no JSON at all', 'I could not read that draft, sorry.');
  rejects('an empty response', '');
  rejects('only whitespace', '   \n  ');

  // A cut-off response ends mid-value. The scan stops at the unterminated
  // bracket instead of hunting inside it for something that happens to close.
  rejects(
    'an object truncated mid-key',
    '{"overallStatus":"ok","checks":[],"sugg',
  );
  rejects(
    'an object truncated after a complete inner array',
    '{"a":1,"checks":[],"x',
  );
  rejects(
    'an object truncated after a complete inner object',
    '{"a":{"b":1},"c',
  );

  it('does not return an inner fragment from a truncated response', () => {
    // The sharp edge: "checks":[] is complete and parseable on its own.
    // Returning [] here would look to the caller like a valid empty result.
    let result;
    try {
      result = parseJSONResponse('{"overallStatus":"x","checks":[],"sugg');
    } catch {
      result = 'threw';
    }
    expect(result).toBe('threw');
  });
});
