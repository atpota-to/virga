// The web app's words are the iOS app's words: VirgaKit ports them word for
// word (ios/PORTING.md, "Copy is behaviour"). So copy is written to be true
// in both places. Where things are kept is "on this device"; what Virga's
// server does without the app open happens "while Virga is closed"; a
// sign-out that ends only one session ends it "here". Nothing tells the
// reader to reload a page.
//
// This finds copy in src/ that names the browser, a tab or a reload, and
// fails unless it is listed below as web-only: text on a path the iOS app
// never takes (a browser session, another tab, IndexedDB), or words the
// legal documents quote, which change only with them. A listed line that no
// longer exists fails too, so the list stays honest.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourceFiles } from './sync.mjs';

const BROWSER_WORDS =
  /\b(?:this|your|the|that|another|other|any) browser(?:’s|s)?\b|\b(?:this|that|another)(?: Virga)? tab\b|\breload (?:the page|to |this one)/i;

// file → [the words that may stay, why]. A match passes when its line holds
// one of the file's phrases.
const WEB_ONLY = {
  'src/settings/SettingsPage.jsx': [
    [
      'Another Virga tab is holding the archive open',
      'IndexedDB held by another tab; the iOS archive is files',
    ],
    [
      'A browser session stays in the browser',
      'describes the web’s other kind of session, true wherever it’s read',
    ],
    [
      'Asks the browser not to clear the archive',
      'Keep it when space runs low: iOS asks nothing like it (STATUS.md)',
    ],
    ['The browser will keep the archive', 'Keep it when space runs low'],
    ['Ask the browser', 'Keep it when space runs low'],
  ],
  'src/shell/FirstRun.jsx': [
    [
      'Another Virga tab is holding the archive open',
      'IndexedDB held by another tab; the iOS archive is files',
    ],
    [
      'This browser is blocking IndexedDB',
      'on iOS only if its files can’t be opened, and then the archive still lasts the session',
    ],
  ],
  'src/accounts/SessionNotices.jsx': [
    [
      'This tab is still signed in as',
      'another tab switched accounts; iOS has no tabs',
    ],
  ],
  'src/lib/analyticsStore.js': [
    [
      'indexedDB blocked by another tab',
      'an internal error, never shown as it is',
    ],
  ],
  'src/accounts/AccountsSettings.jsx': [
    [
      'from this browser',
      'Remove from this browser: the Privacy Policy and the Terms quote it',
    ],
    ['Remove from this browser', 'the Privacy Policy and the Terms quote it'],
    [
      'Also delete what it keeps in this browser',
      'part of Remove from this browser',
    ],
    [
      'The sign-in is kept by the browser',
      'describes the web’s other kind of session, true wherever it’s read',
    ],
    [
      'your other browsers and devices',
      'true from either: other browsers and devices stay signed in',
    ],
    ['any browser or device is signed in', 'true from either'],
    [
      'signs new accounts in through the browser',
      'only when new accounts sign in with a browser session',
    ],
  ],
  'src/accounts/accountCopy.js': [
    ['no other browser or device is signed in', 'true from either'],
  ],
  'src/signin/SignInFlow.jsx': [
    ['Forget ${name} on this browser', 'goes with Remove from this browser'],
    ['Forget on this browser', 'goes with Remove from this browser'],
  ],
  'src/signin/HowSigningInWorks.jsx': [
    [
      'The pass is kept in this browser',
      'a browser session; iOS signs in with long sessions only',
    ],
  ],
  'src/posting/ui/NeedsBackend.jsx': [
    [
      'so they keep working while this browser is',
      'shown for a browser session only',
    ],
  ],
  'src/legal/TermsGate.jsx': [
    [
      'notes in this browser that this account agreed',
      'a browser session only',
    ],
    [
      'the IP address and browser the agreement came from',
      'mirrors the Privacy Policy',
    ],
  ],
  'src/legal/acceptance.js': [
    [
      'Reload to read the current ones',
      'the page loaded old documents; iOS needs its own answer (an app update)',
    ],
  ],
  'src/lib/oauthClient.js': [
    [
      'started from this tab',
      'the browser’s own OAuth client; iOS signs in through the server',
    ],
  ],
  'src/session/sessionController.js': [
    ['another tab signed it out', 'a session another tab ended'],
  ],
  'src/share/chartImage.js': [
    [
      'This browser can’t draw the picture',
      'a canvas failure; iOS draws with Swift Charts',
    ],
  ],
};

/** Each line of `text`, with comments blanked so their words don't count. */
function codeLines(text) {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  return blanked
    .split('\n')
    .map((line) =>
      /^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, ''),
    );
}

function findings() {
  const out = [];
  for (const file of sourceFiles()) {
    if (!/\.(?:js|jsx|mjs)$/.test(file)) continue;
    const lines = codeLines(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    lines.forEach((line, i) => {
      if (BROWSER_WORDS.test(line))
        out.push({ file, line: i + 1, text: line.trim() });
    });
  }
  return out;
}

describe('copy shared with the iOS app', () => {
  const found = findings();

  it('names the browser, a tab or a reload only where iOS never shows it', () => {
    const stray = found
      .filter(
        ({ file, text }) =>
          !(WEB_ONLY[file] ?? []).some(([words]) => text.includes(words)),
      )
      .map(({ file, line, text }) => `${file}:${line}  ${text}`);
    expect(
      stray,
      'The iOS app shows these words too. Say "on this device", "while Virga is closed" or "here", ' +
        'or list the line in WEB_ONLY with the reason iOS never shows it.',
    ).toEqual([]);
  });

  it('lists only words that are still there', () => {
    const stale = Object.entries(WEB_ONLY).flatMap(([file, entries]) =>
      entries
        .filter(
          ([words]) =>
            !found.some((f) => f.file === file && f.text.includes(words)),
        )
        .map(([words]) => `${file}: ${words}`),
    );
    expect(stale).toEqual([]);
  });
});
