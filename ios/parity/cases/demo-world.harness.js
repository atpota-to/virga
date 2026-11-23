// What harness/harness.js decides about the worlds it builds: the scope a
// session was granted (READ_ONLY_SCOPE, withDefense, the address flags'
// scope), the scope and PDS createHarness puts on each world, grantOf, and
// regrant as Turn on Defense uses it. Swift: VirgaDemo/Harness/Harness.swift
// and DemoWorld.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/HarnessParityTests.swift.

import {
  READ_ONLY_SCOPE,
  createHarness,
  readFlags,
  withDefense,
} from '../../../harness/harness.js';
import {
  DEFENSE_TOKENS,
  LIST_TOKENS,
  OAUTH_SCOPE,
} from '../../../src/config.js';
import { LAB, ME } from '../../../harness/world.js';
import { each, grid, value } from './_helpers.js';
import { NOW } from './_demoWorld.js';

export const sources = ['harness/harness.js'];

const SCOPES = [
  OAUTH_SCOPE,
  READ_ONLY_SCOPE,
  `${OAUTH_SCOPE} ${DEFENSE_TOKENS.join(' ')}`,
  `${DEFENSE_TOKENS[0]} ${LIST_TOKENS.join(' ')} atproto`,
  `${LIST_TOKENS[1]} ${LIST_TOKENS[1]} atproto atproto`,
  '  atproto   repo:x  ',
  '',
  null,
];

// What `level` can be: the flags' false, 'scan' and 'lists', regrant's
// `defense` (true, false), and whatever else a caller passes.
const LEVELS = [false, true, 'scan', 'lists', 'on', '', null, 0];

const FLAGS = [
  '',
  '?accounts=1',
  '?scope=read',
  '?defense=on',
  '?defense=lists',
  '?scope=read&defense=lists',
  '?defense=yes&scope=write',
  '?scope=READ&defense=ON',
];

const REGRANTS = [
  [ME.did, 'lists'],
  [ME.did, true],
  [LAB.did, 'lists'],
  [ME.did, false],
  ['did:plc:nobody', 'scan'],
];

export default async function cases() {
  return [
    value('READ_ONLY_SCOPE', READ_ONLY_SCOPE),
    ...(await each(
      'withDefense',
      grid({ scope: SCOPES, level: LEVELS }),
      ({ scope, level }) => withDefense(scope, level),
    )),
    ...(await each(
      'createHarness',
      FLAGS.map((search) => {
        const params = new URLSearchParams(search);
        return {
          search,
          accounts: params.get('accounts'),
          scope: params.get('scope'),
          defense: params.get('defense'),
        };
      }),
      ({ search }) => {
        const harness = createHarness(readFlags(search), { now: NOW });
        const dids = [ME.did, LAB.did, 'did:plc:nobody'];
        const out = {
          scope: harness.flags.scope,
          worlds: harness.worlds.map((w) => ({
            did: w.me.did,
            scope: w.scope,
            pdsUrl: w.pdsUrl,
          })),
          grants: dids.map((did) => harness.grantOf(did)),
          regrants: REGRANTS.map(([did, defense]) => {
            try {
              return harness.regrant(did, { defense });
            } catch (error) {
              return { $throws: error.message };
            }
          }),
        };
        out.grantsAfter = dids.map((did) => harness.grantOf(did));
        return out;
      },
    )),
  ];
}
