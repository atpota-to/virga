import { describe, expect, it } from 'vitest';
import { SKY_PHASES, hourOf, phaseAtHour, skyPhase } from './phase.js';

describe('skyPhase', () => {
  it('following the archive, is dawn until the first build and day after, as it always was', () => {
    expect(skyPhase({ skyTime: 'archive', theme: 'light', built: false })).toBe('dawn');
    expect(skyPhase({ skyTime: 'archive', theme: 'light', built: true })).toBe('day');
  });

  it('following the archive in the dark theme, is dusk until the first build and night after', () => {
    expect(skyPhase({ skyTime: 'archive', theme: 'dark', built: false })).toBe('dusk');
    expect(skyPhase({ skyTime: 'archive', theme: 'dark', built: true })).toBe('night');
  });

  it('shows a fixed sky whatever the theme, the archive or the hour', () => {
    for (const phase of SKY_PHASES) {
      for (const theme of ['light', 'dark']) {
        for (const built of [false, true]) expect(skyPhase({ skyTime: phase, theme, built, hour: 3 })).toBe(phase);
      }
    }
  });

  it('following the clock, goes by the hour and nothing else', () => {
    expect(skyPhase({ skyTime: 'clock', theme: 'dark', built: true, hour: 12 })).toBe('day');
    expect(skyPhase({ skyTime: 'clock', theme: 'light', built: false, hour: 23 })).toBe('night');
    expect(skyPhase({ skyTime: 'clock', hour: 6.5 })).toBe('dawn');
    expect(skyPhase({ skyTime: 'clock', hour: 18 })).toBe('dusk');
  });

  it('treats a setting it doesn’t know as following the archive', () => {
    expect(skyPhase({ skyTime: 'noon', theme: 'light', built: true })).toBe('day');
    expect(skyPhase({ theme: 'dark' })).toBe('dusk');
    expect(skyPhase()).toBe('dawn');
  });
});

describe('phaseAtHour', () => {
  it('turns at five, eight, five in the evening and eight', () => {
    const at = (h) => phaseAtHour(h);
    expect([0, 4.99].map(at)).toEqual(['night', 'night']);
    expect([5, 7.99].map(at)).toEqual(['dawn', 'dawn']);
    expect([8, 12, 16.99].map(at)).toEqual(['day', 'day', 'day']);
    expect([17, 19.99].map(at)).toEqual(['dusk', 'dusk']);
    expect([20, 23.99].map(at)).toEqual(['night', 'night']);
  });

  it('wraps an hour past midnight, and answers day for nonsense', () => {
    expect(phaseAtHour(24)).toBe('night');
    expect(phaseAtHour(30)).toBe('dawn');
    expect(phaseAtHour(-1)).toBe('night');
    expect(phaseAtHour(NaN)).toBe('day');
    expect(phaseAtHour('six')).toBe('day');
  });

  it('only ever answers with a sky the scene has', () => {
    for (let h = 0; h < 24; h += 0.25) expect(SKY_PHASES).toContain(phaseAtHour(h));
  });
});

describe('hourOf', () => {
  it('is the local hour with its minutes as a fraction', () => {
    expect(hourOf(new Date(2026, 10, 14, 17, 30))).toBe(17.5);
    expect(hourOf(new Date(2026, 10, 14, 0, 0))).toBe(0);
  });
});
