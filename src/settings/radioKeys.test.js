import { describe, expect, it } from 'vitest';
import { radioKeyTarget } from './radioKeys.js';

describe('radioKeyTarget', () => {
  it('moves on with right and down, back with left and up', () => {
    expect(radioKeyTarget('ArrowRight', 1, 6)).toBe(2);
    expect(radioKeyTarget('ArrowDown', 1, 6)).toBe(2);
    expect(radioKeyTarget('ArrowLeft', 1, 6)).toBe(0);
    expect(radioKeyTarget('ArrowUp', 1, 6)).toBe(0);
  });

  it('wraps at both ends', () => {
    expect(radioKeyTarget('ArrowRight', 5, 6)).toBe(0);
    expect(radioKeyTarget('ArrowLeft', 0, 6)).toBe(5);
  });

  it('goes to the first with Home and the last with End', () => {
    expect(radioKeyTarget('Home', 3, 6)).toBe(0);
    expect(radioKeyTarget('End', 3, 6)).toBe(5);
  });

  it('leaves every other key alone, so Tab still leaves the group and Space still presses', () => {
    for (const key of ['Tab', ' ', 'Enter', 'a', 'Escape']) expect(radioKeyTarget(key, 2, 6)).toBeNull();
  });

  it('starts from the first choice when nothing is chosen, and does nothing in an empty group', () => {
    expect(radioKeyTarget('ArrowRight', -1, 3)).toBe(1);
    expect(radioKeyTarget('ArrowRight', 0, 0)).toBeNull();
  });
});
