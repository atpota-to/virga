// How fast Virga writes to a list. Swift: VirgaDefense/Pace.swift.

import {
  BATCH,
  BATCH_GAP_MS,
  POINTS_PER_CREATE,
  POINTS_PER_HOUR,
  RATE_LIMIT_HOLD_MS,
} from '../../../src/defense/pace.js';
import { value } from './_helpers.js';

export const sources = ['src/defense/pace.js'];

export default async function cases() {
  return [
    value('constants', {
      BATCH,
      BATCH_GAP_MS,
      RATE_LIMIT_HOLD_MS,
      POINTS_PER_CREATE,
      POINTS_PER_HOUR,
    }),
  ];
}
