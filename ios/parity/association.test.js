// The iOS app's sign-in comes back to https://<server>/oauth/return, which
// ASWebAuthenticationSession can only catch for an associated domain. That
// needs the web deployment to serve /.well-known/apple-app-site-association
// naming the app, as JSON. This holds the web side and the iOS build
// settings to each other.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './sync.mjs';

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function xcconfigValue(text, key) {
  const line = text
    .split('\n')
    .find(
      (l) => l.trim().startsWith(`${key} =`) || l.trim().startsWith(`${key}=`),
    );
  return line ? line.split('=').slice(1).join('=').trim() : null;
}

describe('apple-app-site-association', () => {
  const association = JSON.parse(
    read('public/.well-known/apple-app-site-association'),
  );
  const bundleId = xcconfigValue(
    read('ios/Config/Base.xcconfig'),
    'VIRGA_BUNDLE_ID',
  );

  it('lets the app use the sign-in return as a web credential', () => {
    expect(bundleId).toBeTruthy();
    const apps = association.webcredentials?.apps || [];
    expect(
      apps.some((id) => id.endsWith(`.${bundleId}`)),
      `webcredentials names <team>.${bundleId}`,
    ).toBe(true);
  });

  it('opens only compose links in the app, never the sign-in return', () => {
    const details = association.applinks?.details || [];
    const paths = details.flatMap((d) =>
      (d.components || []).map((c) => c['/']),
    );
    expect(paths).toContain('/intent/compose');
    expect(paths.some((p) => p && p.startsWith('/oauth'))).toBe(false);
    for (const d of details)
      expect(d.appIDs.every((id) => id.endsWith(`.${bundleId}`))).toBe(true);
  });

  it('is served as JSON', () => {
    const vercel = JSON.parse(read('vercel.json'));
    const rule = vercel.headers.find(
      (h) => h.source === '/.well-known/apple-app-site-association',
    );
    expect(rule?.headers).toContainEqual({
      key: 'Content-Type',
      value: 'application/json',
    });
  });

  it('names the host the app signs in at in its entitlements', () => {
    const spec = read('ios/project.yml');
    expect(spec).toContain('webcredentials:$(VIRGA_HOST)');
    expect(
      xcconfigValue(read('ios/Config/Base.xcconfig'), 'VIRGA_HOST'),
    ).toBeTruthy();
  });
});
