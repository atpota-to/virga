// Which sky the hillside shows. The scene has four (scene.js): dawn, day,
// dusk and night. Settings › Appearance fixes one of them, or lets it follow
// the archive or the clock; this is the one place that decides.

export const SKY_PHASES = ['dawn', 'day', 'dusk', 'night'];

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
 *   'clock'                             the local time of day
 *   'archive' (and anything unknown)    the sun comes up when the archive is
 *                                       first built: dawn, then day. In the
 *                                       dark theme the same step is taken an
 *                                       evening later, so the sky sits with
 *                                       the page: dusk, then night.
 *
 * `theme` is the theme in force ('light' or 'dark'), not the preference.
 */
export function skyPhase({ skyTime = 'archive', theme = 'light', built = false, hour = 12 } = {}) {
  if (SKY_PHASES.includes(skyTime)) return skyTime;
  if (skyTime === 'clock') return phaseAtHour(hour);
  if (theme === 'dark') return built ? 'night' : 'dusk';
  return built ? 'day' : 'dawn';
}
