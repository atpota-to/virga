// The languages a post can say it's written in (ISO 639-1, which is what
// Bluesky's language filters read), named in the reader's own language by
// the browser.

export const LANGUAGE_CODES = Object.freeze(
  (
    'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy ' +
    'da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht ' +
    'hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky ' +
    'la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny ' +
    'oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss ' +
    'st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo ' +
    'za zh zu'
  ).split(' '),
);

const namers = new Map();

function namer(locale) {
  if (!namers.has(locale)) {
    let n = null;
    try {
      n =
        typeof Intl?.DisplayNames === 'function'
          ? new Intl.DisplayNames([locale], { type: 'language' })
          : null;
    } catch {
      n = null;
    }
    namers.set(locale, n);
  }
  return namers.get(locale);
}

/** "English" for "en", in `locale`; the code itself when the browser can't say. */
export function languageName(code, locale = 'en') {
  const clean = String(code || '').trim();
  if (!clean) return '';
  try {
    const name = namer(locale)?.of(clean);
    if (name && name.toLowerCase() !== clean.toLowerCase())
      return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    // An odd code: fall through to the code itself.
  }
  return clean;
}

/**
 * Languages matching `query` (by name or code), the chosen ones left out,
 * sorted by name, at most `limit`. With no query, the browser's own
 * languages come first.
 */
export function searchLanguages(
  query,
  { chosen = [], locale = 'en', preferred = [], limit = 8 } = {},
) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const taken = new Set(chosen);
  // A code the browser can't name is offered only when it's typed exactly.
  const all = LANGUAGE_CODES.filter((c) => !taken.has(c))
    .map((code) => ({ code, name: languageName(code, locale) }))
    .filter((l) => l.name !== l.code || l.code === q);
  if (!q) {
    const pref = [
      ...new Set(
        preferred.map((p) => String(p).split(/[-_]/)[0].toLowerCase()),
      ),
    ].filter((c) => LANGUAGE_CODES.includes(c) && !taken.has(c));
    const first = pref.map((code) => ({
      code,
      name: languageName(code, locale),
    }));
    const rest = all
      .filter((l) => !pref.includes(l.code))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...first, ...rest].slice(0, limit);
  }
  return all
    .filter((l) => l.code === q || l.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.code === q || a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.code === q || b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

/** The self-labels, as the composer offers them. */
export const ADULT_LABEL_OPTIONS = Object.freeze([
  { value: 'sexual', label: 'Suggestive', hint: 'Revealing, but not explicit' },
  { value: 'nudity', label: 'Nudity', hint: 'Artistic or non-sexual nudity' },
  { value: 'porn', label: 'Adult', hint: 'Sexually explicit' },
]);
export const GRAPHIC_LABEL = Object.freeze({
  value: 'graphic-media',
  label: 'Graphic media',
  hint: 'Violence, injury or gore',
});

/** "English, Spanish" for the composer's options row. */
export function langsSummary(langs, locale = 'en') {
  const list = (langs || []).map((c) => languageName(c, locale));
  return list.length ? list.join(', ') : 'No language set';
}

/** "Nudity, Graphic media", or ''. */
export function labelsSummary(labels) {
  const all = [...ADULT_LABEL_OPTIONS, GRAPHIC_LABEL];
  return (labels || [])
    .map((l) => all.find((o) => o.value === l)?.label)
    .filter(Boolean)
    .join(', ');
}
