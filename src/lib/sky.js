// The sky behind every page. There are four: dawn, day, dusk and night. Each
// is a wash of colour at the top of the page that fades into the page's own
// ground (styles/theme.css draws them), and night is also the dark theme:
// its ground is dark and its ink is light. Settings › Appearance keeps one,
// or lets the sky follow the clock; this is the one place that decides.

export const SKY_PHASES = ['dawn', 'day', 'dusk', 'night'];

/** What Settings offers: the clock, or one sky kept. */
export const SKY_CHOICES = ['clock', ...SKY_PHASES];

// The clock's day, in hours: dawn from five, day from eight, dusk from five in
// the evening, night from eight. Fixed, not worked out from where the sun
// really is: that would need the reader's location, and a background has no
// business asking for it.
const DAWN_FROM = 5;
const DAY_FROM = 8;
const DUSK_FROM = 17;
const NIGHT_FROM = 20;

/** The sky at an hour of the local day (0 to 24, fractions welcome). */
export function phaseAtHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (!Number.isFinite(h)) return 'day';
  if (h < DAWN_FROM) return 'night';
  if (h < DAY_FROM) return 'dawn';
  if (h < DUSK_FROM) return 'day';
  if (h < NIGHT_FROM) return 'dusk';
  return 'night';
}

/** The hour of the local day at a moment, with its minutes as a fraction. */
export function hourOf(date = new Date()) {
  return date.getHours() + date.getMinutes() / 60;
}

/**
 * The sky for a setting:
 *
 *   'dawn' | 'day' | 'dusk' | 'night'   that one, whatever else is so
 *   'clock' (and anything unknown)      the local time of day. A device set
 *                                       to dark stays on night: it has asked
 *                                       for a dark page, and night is the
 *                                       only sky with one.
 *
 * `dark` is whether the device asks for a dark page; `hour` is the local
 * hour.
 */
export function skyFor(choice, { dark = false, hour = 12 } = {}) {
  if (SKY_PHASES.includes(choice)) return choice;
  return dark ? 'night' : phaseAtHour(hour);
}

/** The theme a sky brings with it: night is dark, the other three are light. */
export function themeOf(sky) {
  return sky === 'night' ? 'dark' : 'light';
}

/**
 * The colour at the very top of a sky, for the browser's own chrome (a
 * phone's toolbar), so it runs into the page. The same as --sky-top in
 * styles/theme.css; theme.test.js checks. High contrast has no sky, only its
 * flat ground.
 */
export function skyColor(sky, contrast = 'normal') {
  if (contrast === 'high') return sky === 'night' ? '#000000' : '#ffffff';
  return { dawn: '#ffd8c4', day: '#b9d5ff', dusk: '#cbc5f4', night: '#0e1a3a' }[sky] || '#b9d5ff';
}
