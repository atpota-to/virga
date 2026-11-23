// The app's constants, the permission groups Settings › Permissions shows
// (word for word) and the scopes a sign-in asks for. Swift:
// VirgaCore/AppConfig.swift.

import {
  APPVIEW,
  APP_NAME,
  DECLARED_SCOPE,
  DEFENSE_SCOPE,
  DEFENSE_TOKENS,
  LISTS_SCOPE,
  LIST_TOKENS,
  OAUTH_CALLBACK_PATH,
  OAUTH_RETURN_PATH,
  OAUTH_SCOPE,
  PERMISSION_GROUPS,
  PLC_DIRECTORY,
  POSTING_TOKENS,
  defenseLevel,
  signInScope,
} from '../../../src/config.js';
import { each, value } from './_helpers.js';

export const sources = ['src/config.js'];

export default async function cases() {
  return [
    value('constants', {
      APP_NAME,
      APPVIEW,
      PLC_DIRECTORY,
      OAUTH_CALLBACK_PATH,
      OAUTH_RETURN_PATH,
    }),
    value('PERMISSION_GROUPS', PERMISSION_GROUPS),
    value('scopes', {
      OAUTH_SCOPE,
      DEFENSE_TOKENS,
      DEFENSE_SCOPE,
      LIST_TOKENS,
      LISTS_SCOPE,
      DECLARED_SCOPE,
      POSTING_TOKENS,
    }),
    ...(await each(
      'defenseLevel',
      [
        { value: true },
        { value: false },
        { value: 'scan' },
        { value: 'lists' },
        { value: 'other' },
        { value: null },
        { value: 1 },
      ],
      ({ value: v }) => defenseLevel(v),
    )),
    ...(await each(
      'signInScope',
      [
        { defense: false },
        { defense: true },
        { defense: 'scan' },
        { defense: 'lists' },
        { defense: 'nonsense' },
      ],
      ({ defense }) => signInScope({ defense }),
    )),
  ];
}
