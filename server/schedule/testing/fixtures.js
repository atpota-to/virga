// Shared by the schedule tests: accounts, times, payloads, and a stand-in PDS
// a real @atproto/api Agent can call through.

export const DID = 'did:plc:schedwriter00000000000000';
export const OTHER_DID = 'did:plc:schedsomeoneelse000000000';

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const iso = (ms) => new Date(ms).toISOString();
export const inHours = (h) => iso(Date.now() + h * HOUR);

export const CIDS = [
  'bafyreidfzmkivfo3xsvnt4224jmalfujijjevs7htny75ekhfawnobkzc4',
  'bafyreiaru4nxx365jxznh5c3kkny6pbqpqdfeuzvnlaqigxia5tgowzgwe',
  'bafyreidgkxwemzwqhfpbv3phvkwmvx3a3g5lxyssxvfkrmcl2tbbxpwvv4',
  'bafyreibzez7t7ucofbp73wqbstsysr4cflap7lvnwqcggsqorbkrf3irxy',
  'bafyreidlh7pnolvy77fsuuepmzupscquzc7blduyhjm4og7n7vhok4ozd4',
];
export const BLOB_CID =
  'bafkreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm';

// A 1x1 PNG, as the composer would send it.
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A create body as the client's serializeForSchedule sends it. */
export function createBody({
  texts = ['hello moths'],
  scheduledFor = inHours(2),
  gates,
  selfDestruct,
  images = 0,
  queued = false,
} = {}) {
  const posts = texts.map((text) => ({ record: { text } }));
  const mediaBytes = {};
  if (images > 0) {
    posts[0].embed = {
      type: 'images',
      images: Array.from({ length: images }, (_, n) => ({
        mediaId: `p0-img${n}`,
        alt: `image ${n}`,
      })),
    };
    for (let n = 0; n < images; n++) {
      mediaBytes[`p0-img${n}`] = { base64: PNG_BASE64, encoding: 'image/png' };
    }
  }
  return {
    scheduledFor,
    target: 'bluesky',
    queued,
    payload: {
      posts,
      gates: gates || { threadgate: null, postgate: null },
      mediaBytes,
      tz: 'Europe/Paris',
      selfDestruct: selfDestruct ?? null,
    },
  };
}

/**
 * A session an Agent can call through. Every putRecord is recorded and
 * answered with the next fixture CID; uploadBlob answers a blob ref.
 * `behaviour(nsid, body, session)` may throw or answer instead.
 */
export function fakePds({ did = DID, id = 'session', behaviour } = {}) {
  const writes = [];
  const blobs = [];
  let posts = 0;
  const make = (sessionId) => ({
    did,
    id: sessionId,
    async fetchHandler(url, init) {
      const nsid = String(url).split('/xrpc/')[1]?.split('?')[0];
      if (behaviour) {
        const answer = await behaviour(nsid, init, sessionId);
        if (answer) return answer;
      }
      if (nsid === 'com.atproto.repo.uploadBlob') {
        const bytes = new Uint8Array(
          await new Response(init.body).arrayBuffer(),
        );
        const mimeType =
          new Headers(init.headers).get('content-type') ||
          'application/octet-stream';
        blobs.push({ session: sessionId, size: bytes.byteLength, mimeType });
        return json({
          blob: {
            $type: 'blob',
            ref: { $link: BLOB_CID },
            mimeType,
            size: bytes.byteLength,
          },
        });
      }
      const body = JSON.parse(await new Response(init.body).text());
      writes.push({ nsid, session: sessionId, ...body });
      const cid =
        body.collection === 'app.bsky.feed.post'
          ? CIDS[posts++ % CIDS.length]
          : CIDS[4];
      return json({
        uri: `at://${body.repo}/${body.collection}/${body.rkey}`,
        cid,
      });
    },
  });
  return {
    session: make(id),
    sessionFor: make,
    writes,
    blobs,
    posts: () => writes.filter((w) => w.collection === 'app.bsky.feed.post'),
  };
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** An XRPC "Invalid token" answer, as a PDS sends one for a rotated token. */
export function invalidTokenResponse() {
  return json({ error: 'InvalidToken', message: 'Invalid token' }, 400);
}
