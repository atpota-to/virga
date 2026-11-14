// Which origins Virga's frontend lives on. The server hands a session token to
// a page on one of these and answers cross-origin requests only from them, so
// they are exact origins from the environment: never a wildcard (a preview
// pattern can be matched by someone else's deployment) and never the Host
// header (which a request names for itself).

import { envList } from './env.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export const isLoopback = (hostname) => LOOPBACK.has(String(hostname || '').toLowerCase());

/**
 * The exact origin of a URL string, or null. https only, except http on a
 * loopback host for local development.
 */
export function exactOrigin(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('*')) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))) {
      return url.origin;
    }
  } catch {
    // not a URL
  }
  return null;
}

/** The origin of OAUTH_PUBLIC_URL, or null when it is unset or not a usable origin. */
export function publicUrl(env = process.env) {
  return exactOrigin(env?.OAUTH_PUBLIC_URL);
}

/** OAUTH_PUBLIC_URL's origin plus every exact origin in OAUTH_EXTRA_RETURN_ORIGINS, deduplicated. */
export function frontendOrigins(env = process.env) {
  const origins = [publicUrl(env), ...envList(env, 'OAUTH_EXTRA_RETURN_ORIGINS').map(exactOrigin)];
  return [...new Set(origins.filter(Boolean))];
}

/** Whether `origin` (an Origin header, or a URL) is exactly one of the frontend origins. */
export function isAllowedFrontendOrigin(origin, env = process.env) {
  const exact = exactOrigin(origin);
  if (!exact) return false;
  // An Origin header is a bare origin; anything with a path is not one.
  if (typeof origin === 'string' && origin.trim().replace(/\/$/, '') !== exact) return false;
  return frontendOrigins(env).includes(exact);
}
