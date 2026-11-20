// The words for a sign-in that couldn't start or didn't finish
// (src/lib/oauthClient.js's signInErrorMessage and callbackErrorMessage),
// over every code and message they read. Swift: VirgaSession/Lib/OAuthClient.swift.

import {
  callbackErrorMessage,
  signInErrorMessage,
} from '../../../src/lib/oauthClient.js';
import { each } from './_helpers.js';

export const sources = ['src/lib/oauthClient.js'];

function errorOf(shape) {
  if (shape == null) return shape ?? undefined;
  const make = shape.name === 'TypeError' ? TypeError : Error;
  const error = new make(shape.message ?? '');
  for (const [k, v] of Object.entries(shape)) {
    if (k === 'message') continue;
    if (k === 'name')
      Object.defineProperty(error, 'name', {
        value: v,
        configurable: true,
        writable: true,
      });
    else if (k === 'params') error.params = new URLSearchParams(v);
    else error[k] = v;
  }
  return error;
}

const SIGN_IN = [
  { message: 'x', code: 'HANDLE_NOT_FOUND' },
  { message: 'x', code: 'AUTHORIZE_FAILED' },
  { message: 'x', code: 'VIRGA_CLIENT_UNAVAILABLE' },
  { message: 'x', status: 503 },
  { message: 'x', code: null, status: 503 },
  { message: 'x', code: 'OTHER', status: 503 },
  { message: 'x', code: 503, status: 503 },
  { message: 'x', code: 'NETWORK_ERROR' },
  { message: 'x', code: 'RATE_LIMITED' },
  { message: 'x', code: 'REDIRECT_NOT_ALLOWED' },
  { message: 'The redirect_uri is not allowed' },
  { message: 'origin is not an allowed frontend' },
  { message: 'Failed to Resolve Identity: x' },
  { message: 'invalid handle' },
  { message: 'Invalid DID' },
  { message: 'handle must be lowercase' },
  { message: 'Failed to resolve OAuth server metadata' },
  { message: 'not protected by issuer' },
  { message: 'Authorization server does not support PAR' },
  { message: 'invalid_scope' },
  { message: 'Bad SCOPE' },
  { name: 'TypeError', message: 'Failed to fetch' },
  {
    name: 'TypeError',
    message: 'NetworkError when attempting to fetch resource.',
  },
  { name: 'TypeError', message: 'Load failed' },
  { name: 'TypeError', message: 'Cannot read properties of undefined' },
  { message: 'Failed to fetch' },
  { message: '' },
  {
    message: 'Sign-in couldn’t start (HTTP 500)',
    code: 'INTERNAL',
    status: 500,
  },
  { message: 'x', code: 'handle_not_found' },
  {},
  null,
];

const CALLBACK = [
  { message: 'x', params: { error: 'access_denied' } },
  { message: 'x', params: { error: 'unexpected_return' } },
  { message: 'x', params: { error: 'invalid_scope' } },
  { message: 'x', params: { error: 'VIRGA_CLIENT_UNAVAILABLE' } },
  {
    message: 'x',
    params: { error: 'callback_failed', error_description: 'nope' },
  },
  { message: 'x', params: { error: 'Access_Denied' } },
  { message: 'x', params: {} },
  { message: 'access_denied' },
  { message: 'x', code: 'access_denied' },
  null,
];

export default async function cases() {
  return [
    ...(await each(
      'signInErrorMessage',
      SIGN_IN.map((error) => ({ error })),
      ({ error }) => signInErrorMessage(errorOf(error)),
    )),
    ...(await each(
      'callbackErrorMessage',
      CALLBACK.map((error) => ({ error })),
      ({ error }) => callbackErrorMessage(errorOf(error)),
    )),
  ];
}
