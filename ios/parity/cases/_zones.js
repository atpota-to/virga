// Running a generator's computation in a given local time zone, for the
// web code that reads the local calendar (new Date(y, m, d), getHours()).
// The runner sets TZ=UTC; these set it for one synchronous call and put it
// back, so nothing else sees the change.

/** Runs `fn` with the process's local zone set to `zone`. */
export function inZone(zone, fn) {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    process.env.TZ = was;
  }
}

/** Zones with every kind of offset and clock change. */
export const ZONES = [
  'UTC',
  'America/New_York',
  'Europe/London',
  'Asia/Kolkata',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'America/Sao_Paulo',
];
