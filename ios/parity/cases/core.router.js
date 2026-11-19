// The app's addresses: a path split into its parts, and where a move lands
// with the current query string. Swift: VirgaCore/Lib/Router.swift.

import { hrefFor, pathParts } from '../../../src/lib/router.jsx';
import { each } from './_helpers.js';

export const sources = ['src/lib/router.jsx'];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'pathParts',
      [
        '/',
        '',
        null,
        '/reports/followers/',
        '/dashboard/my%20board',
        '//double//slashes//',
        '/posting/drafts/xyz',
        '/a%2Fb/c',
        '/caf%C3%A9/%F0%9F%91%8D',
        '/%E2%9C%93?x=1',
        '/emoji/👍🏽',
        '/bad/%',
        '/bad/%zz',
        '/bad/%C3%28',
        'relative/path',
        '/intent/compose',
      ].map((path) => ({ path })),
      ({ path }) => pathParts(path),
    )),
  );
  out.push(
    ...(await each(
      'hrefFor',
      [
        ['/reports', '?latency=0', true],
        ['/reports?x=1', '?latency=0', true],
        ['/posting', '?text=hello', false],
        ['/posting', '', true],
        ['/privacy#contact', '?latency=0', true],
        ['/privacy#contact', '', true],
        ['/privacy?x=1#contact', '?latency=0', true],
        ['/privacy#contact', '?text=hello', false],
        ['/a#b#c', '?q', true],
        ['#top', '?q=1', true],
        ['', '?q=1', true],
        ['/x?', '?q=1', true],
        ['/👍#🙂', '?é=1', true],
        ['/reports', null, true],
      ].map(([to, currentSearch, keepQuery]) => ({
        to,
        currentSearch,
        keepQuery,
      })),
      ({ to, currentSearch, keepQuery }) =>
        hrefFor(to, currentSearch ?? undefined, { keepQuery }),
    )),
  );
  return out;
}
