import { describe, expect, it } from 'vitest';
import { SKY_CHOICES, SKY_PHASES, hourOf, phaseAtHour, skyColor, skyFor, themeOf } from './sky.js';

describe('skyFor', () => {
  it('keeps a sky that was picked, whatever the hour or the device', () => {
    for (const phase of SKY_PHASES) {
      for (const dark of [false, true]) expect(skyFor(phase, { dark, hour: 3 })).toBe(phase);
    }
  });

  it('following the clock, goes by the hour', () => {
    expect(skyFor('clock', { hour: 12 })).toBe('day');
    expect(skyFor('clock', { hour: 23 })).toBe('night');
    expect(skyFor('clock', { hour: 6.5 })).toBe('dawn');
    expect(skyFor('clock', { hour: 18 })).toBe('dusk');
  });

  it('following the clock on a device set to dark, stays on night', () => {
    for (const hour of [0, 6, 12, 18, 22]) expect(skyFor('clock', { dark: true, hour })).toBe('night');
  });

  it('treats a setting it doesn’t know as following the clock', () => {
    expect(skyFor('noon', { hour: 12 })).toBe('day');
    expect(skyFor(undefined, { hour: 2 })).toBe('night');
    expect(skyFor()).toBe('day');
  });

  it('offers the clock and the four skies, the clock first', () => {
    expect(SKY_CHOICES).toEqual(['clock', 'dawn', 'day', 'dusk', 'night']);
  });
});

describe('themeOf', () => {
  it('is dark for night and light for the rest', () => {
    expect(SKY_PHASES.map(themeOf)).toEqual(['light', 'light', 'light', 'dark']);
  });
});

describe('skyColor', () => {
  it('has a colour for every sky, and the flat ground in high contrast', () => {
    for (const phase of SKY_PHASES) expect(skyColor(phase)).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(SKY_PHASES.map((p) => skyColor(p))).size).toBe(4);
    expect(skyColor('day', 'high')).toBe('#ffffff');
    expect(skyColor('night', 'high')).toBe('#000000');
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

  it('only ever answers with a sky there is', () => {
    for (let h = 0; h < 24; h += 0.25) expect(SKY_PHASES).toContain(phaseAtHour(h));
  });
});

describe('hourOf', () => {
  it('is the local hour with its minutes as a fraction', () => {
    expect(hourOf(new Date(2026, 10, 14, 17, 30))).toBe(17.5);
    expect(hourOf(new Date(2026, 10, 14, 0, 0))).toBe(0);
  });
});
