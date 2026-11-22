// Shared by the composer generators (composer.*.js).
//
// Files. The composer's state holds File objects (a picked image, a video).
// A fixture holds one as `{ $file: true, name, type, size, lastModified }`
// (a Blob without a name has only `type` and `size`): `withFiles(value)`
// turns those markers into real Files before the web code runs, and
// `markFiles(value)` turns every File or Blob in a result back into its
// marker. The Swift port's ComposerFile is that object.
//
// Fresh ids. composerModel.js names new posts and images with
// `${prefix}${Date.now().toString(36)}${counter}${random}`, and autosave.js
// names restored and set-aside posts `restored-…` and `aside-…`, so a result
// holds ids no two runs agree on. `canonIds(value, input)` replaces each id
// of those shapes that the input doesn't hold with `$new1`, `$new2`, … in
// the order they first appear (object members walked in sorted order), and
// the Swift test does the same to its own result, so the same post gets the
// same name on both sides and a port that mints an id where the web keeps
// one (or the reverse) fails.

const FRESH = [
  /^[pi]m[0-9a-z]{8,}$/,
  /^restored-[0-9a-z]+-\d+$/,
  /^aside-[0-9a-z]+-\d+$/,
];

/** A File (or a Blob, without `name`) as a fixture's marker. */
export function fileMarker({
  name,
  type = '',
  size = 1,
  lastModified = 0,
} = {}) {
  return name === undefined
    ? { $file: true, type, size }
    : { $file: true, name, type, size, lastModified };
}

function isMarker(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && v.$file === true;
}

/** `value` with every file marker made a real File (or Blob). */
export function withFiles(value) {
  if (isMarker(value)) {
    const bytes = new Uint8Array(Number(value.size) || 0);
    if (value.name === undefined)
      return new Blob([bytes], { type: value.type || '' });
    return new File([bytes], value.name, {
      type: value.type || '',
      lastModified: value.lastModified ?? 0,
    });
  }
  if (Array.isArray(value)) return value.map(withFiles);
  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      Object.defineProperty(out, k, {
        value: withFiles(v),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

/** `value` with every File and Blob in it made a fixture's marker. */
export function markFiles(value, path = new Set()) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return typeof File !== 'undefined' && value instanceof File
      ? fileMarker({
          name: value.name,
          type: value.type,
          size: value.size,
          lastModified: value.lastModified,
        })
      : fileMarker({ type: value.type, size: value.size });
  }
  if (!value || typeof value !== 'object') return value;
  // Only a cycle stops the walk; a value met again elsewhere is walked again.
  if (path.has(value)) return value;
  if (value instanceof Map || value instanceof Set || value instanceof Date)
    return value;
  path.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => markFiles(v, path));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      Object.defineProperty(out, k, {
        value: markFiles(v, path),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  } finally {
    path.delete(value);
  }
}

function strings(value, out = new Set()) {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** `value` (JSON) with the ids the run minted named `$new<n>`. */
export function canonIds(value, input) {
  const known = strings(input);
  const names = new Map();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (known.has(v) || !FRESH.some((re) => re.test(v))) return v;
      if (!names.has(v)) names.set(v, `$new${names.size + 1}`);
      return names.get(v);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        Object.defineProperty(out, k, {
          value: walk(v[k]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

/** A file for a state: a picked JPEG by default. */
export const file = (name = 'a.jpg', type = 'image/jpeg', size = 1) =>
  fileMarker({ name, type, size });

/** A blob as a record carries it. */
export const blob = (cid, mimeType = 'image/jpeg', size = 1) => ({
  $type: 'blob',
  ref: { $link: cid },
  mimeType,
  size,
});
