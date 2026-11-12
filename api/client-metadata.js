// Vercel serverless function that serves the atproto OAuth client metadata.
//
// The atproto OAuth spec requires:
//   - client_id to equal the URL the metadata JSON is served from
//   - every redirect_uri to share the same origin as client_id
//
// The app runs on more than one origin (the production domain, and a new one
// for every preview deployment), so a single static JSON file can't be right
// for all of them. This answers for whichever host it was asked at, and each
// host is an independent OAuth client as far as an authorization server is
// concerned.
//
// Routed in vercel.json:    /oauth-client-metadata.json  ->  /api/client-metadata
//
// The object itself comes from src/lib/oauthClient.js, the same function the
// browser uses to describe itself, so the two can't drift apart.

import { buildClientMetadata } from '../src/lib/oauthClient.js';

/** A bare host name, with an optional port. Nothing a URL could smuggle. */
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

export default function handler(req, res) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();

  if (!HOST.test(host)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Unrecognized host' });
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Short cache so a change here reaches authorization servers quickly while
  // still letting them and the CDN cache modestly.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  return res
    .status(200)
    .send(JSON.stringify(buildClientMetadata(`https://${host}`), null, 2));
}
