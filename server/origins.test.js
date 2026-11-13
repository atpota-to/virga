import { describe, it, expect } from 'vitest';
import { exactOrigin, frontendOrigins, isAllowedFrontendOrigin, isLoopback, publicUrl } from './origins.js';

describe('exactOrigin', () => {
  it('keeps https origins and drops paths', () => {
    expect(exactOrigin('https://virga.example.com')).toBe('https://virga.example.com');
    expect(exactOrigin('https://virga.example.com/some/path?q=1')).toBe('https://virga.example.com');
    expect(exactOrigin('https://virga.example.com:8443/')).toBe('https://virga.example.com:8443');
  });

  it('accepts http only on loopback hosts', () => {
    expect(exactOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    expect(exactOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(exactOrigin('http://[::1]:5173')).toBe('http://[::1]:5173');
    expect(exactOrigin('http://virga.example.com')).toBeNull();
  });

  it('refuses wildcards, credentials, other schemes and junk', () => {
    expect(exactOrigin('https://*.vercel.app')).toBeNull();
    expect(exactOrigin('https://user:pw@virga.example.com')).toBeNull();
    expect(exactOrigin('ftp://virga.example.com')).toBeNull();
    expect(exactOrigin('not a url')).toBeNull();
    expect(exactOrigin('')).toBeNull();
    expect(exactOrigin(undefined)).toBeNull();
  });

  it('knows the loopback names', () => {
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('example.com')).toBe(false);
  });
});

describe('publicUrl', () => {
  it('is the origin of OAUTH_PUBLIC_URL, or null', () => {
    expect(publicUrl({ OAUTH_PUBLIC_URL: 'https://virga.example.com/' })).toBe('https://virga.example.com');
    expect(publicUrl({ OAUTH_PUBLIC_URL: 'http://virga.example.com' })).toBeNull();
    expect(publicUrl({})).toBeNull();
  });
});

describe('frontendOrigins', () => {
  const env = {
    OAUTH_PUBLIC_URL: 'https://virga.example.com',
    OAUTH_EXTRA_RETURN_ORIGINS: 'http://127.0.0.1:5173, https://*.vercel.app, https://virga.example.com, https://staging.virga.example.com/x',
  };

  it('is the public origin plus the exact extras, deduplicated, wildcards dropped', () => {
    expect(frontendOrigins(env)).toEqual([
      'https://virga.example.com',
      'http://127.0.0.1:5173',
      'https://staging.virga.example.com',
    ]);
  });

  it('is only the extras without a public URL, and empty with nothing set', () => {
    expect(frontendOrigins({ OAUTH_EXTRA_RETURN_ORIGINS: 'https://a.example' })).toEqual(['https://a.example']);
    expect(frontendOrigins({})).toEqual([]);
  });

  it('matches an Origin header exactly', () => {
    expect(isAllowedFrontendOrigin('https://virga.example.com', env)).toBe(true);
    expect(isAllowedFrontendOrigin('http://127.0.0.1:5173', env)).toBe(true);
    expect(isAllowedFrontendOrigin('https://preview-abc.vercel.app', env)).toBe(false);
    expect(isAllowedFrontendOrigin('https://virga.example.com.evil.test', env)).toBe(false);
    expect(isAllowedFrontendOrigin('http://127.0.0.1:5174', env)).toBe(false);
    expect(isAllowedFrontendOrigin('https://virga.example.com/oauth/return', env)).toBe(false);
    expect(isAllowedFrontendOrigin('null', env)).toBe(false);
    expect(isAllowedFrontendOrigin(undefined, env)).toBe(false);
  });
});
