// A reading of one OAuth scope token under the atproto permission grammar
// (https://atproto.com/specs/permission), for tests that hold a scope string
// to it. The authorization server drops a token it can't parse without saying
// so, so a malformed one is a permission that silently never arrives.
//
//   <resource>[:<positional>][?<params>]
//
// parsePermission(token) returns { resource, positional, params } or throws
// with the reason.

import { isValidNsid } from '@atproto/syntax';
import { isAtprotoAudience } from '@atproto/did';

const STATIC = new Set([
  'atproto',
  'transition:generic',
  'transition:chat.bsky',
  'transition:email',
]);
const REPO_ACTIONS = new Set(['create', 'update', 'delete']);
const ACCOUNT_ATTRS = new Set(['email', 'repo', 'status']);
const ACCOUNT_ACTIONS = new Set(['read', 'manage']);
const IDENTITY_ATTRS = new Set(['handle', '*']);
const MIME = /^(\*\/\*|[a-z0-9][a-z0-9.+-]*\/(\*|[a-z0-9][a-z0-9.+-]*))$/i;

function fail(token, why) {
  throw new Error(`"${token}": ${why}`);
}

export function parsePermission(token) {
  if (typeof token !== 'string' || !token || /\s/.test(token))
    fail(token, 'not a single token');
  if (STATIC.has(token))
    return { resource: token, positional: null, params: {} };
  // A scope token is URI-like: a bare # would start a fragment, so a service
  // fragment in an aud is written %23.
  if (token.includes('#')) fail(token, 'a raw # must be written %23');

  const q = token.indexOf('?');
  const head = q === -1 ? token : token.slice(0, q);
  const query = q === -1 ? '' : token.slice(q + 1);
  const colon = head.indexOf(':');
  const resource = colon === -1 ? head : head.slice(0, colon);
  const positional =
    colon === -1 ? null : decodeURIComponent(head.slice(colon + 1));

  const params = {};
  for (const [k, v] of new URLSearchParams(query)) (params[k] ||= []).push(v);
  const one = (name) => {
    if ((params[name] || []).length > 1) fail(token, `${name} given twice`);
    return params[name] ? params[name][0] : undefined;
  };
  const only = (...names) => {
    for (const k of Object.keys(params))
      if (!names.includes(k)) fail(token, `unknown parameter ${k}`);
  };

  switch (resource) {
    case 'repo': {
      only('collection', 'action');
      const collections =
        positional != null ? [positional] : params.collection || [];
      if (!collections.length) fail(token, 'repo needs a collection');
      for (const c of collections)
        if (c !== '*' && !isValidNsid(c)) fail(token, `bad collection ${c}`);
      for (const a of params.action || [])
        if (!REPO_ACTIONS.has(a)) fail(token, `bad action ${a}`);
      break;
    }
    case 'rpc': {
      only('lxm', 'aud');
      const lxms = positional != null ? [positional] : params.lxm || [];
      if (!lxms.length) fail(token, 'rpc needs a method');
      for (const m of lxms)
        if (m !== '*' && !isValidNsid(m)) fail(token, `bad method ${m}`);
      const aud = one('aud');
      if (!aud) fail(token, 'rpc needs an aud');
      if (aud !== '*' && !isAtprotoAudience(aud))
        fail(token, `aud ${aud} is not a DID with a service fragment`);
      if (aud === '*' && lxms.includes('*'))
        fail(token, 'rpc:* with aud=* is not allowed');
      break;
    }
    case 'blob': {
      only('accept');
      const accepts = positional != null ? [positional] : params.accept || [];
      if (!accepts.length) fail(token, 'blob needs a mime type');
      for (const m of accepts) if (!MIME.test(m)) fail(token, `bad mime ${m}`);
      break;
    }
    case 'include': {
      only('nsid', 'aud');
      const nsid = positional != null ? positional : one('nsid');
      if (!nsid || !isValidNsid(nsid)) fail(token, 'include needs an NSID');
      const aud = one('aud');
      if (aud !== undefined && !isAtprotoAudience(aud))
        fail(token, `aud ${aud} is not a DID with a service fragment`);
      break;
    }
    case 'account': {
      only('attr', 'action');
      const attr = positional != null ? positional : one('attr');
      if (!ACCOUNT_ATTRS.has(attr)) fail(token, `bad attr ${attr}`);
      const action = one('action');
      if (action !== undefined && !ACCOUNT_ACTIONS.has(action))
        fail(token, `bad action ${action}`);
      break;
    }
    case 'identity': {
      only('attr');
      const attr = positional != null ? positional : one('attr');
      if (!IDENTITY_ATTRS.has(attr)) fail(token, `bad attr ${attr}`);
      break;
    }
    default:
      fail(token, `unknown resource ${resource}`);
  }
  return { resource, positional, params };
}
