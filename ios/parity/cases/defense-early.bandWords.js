// What each band is called and means on screen. Swift:
// VirgaDefense/BandWords.swift.

import {
  BAND_COUNTED,
  BAND_MEANS,
  BAND_WORD,
} from '../../../src/defense/bandWords.js';
import { value } from './_helpers.js';

export const sources = ['src/defense/bandWords.js'];

export default async function cases() {
  return [value('constants', { BAND_WORD, BAND_MEANS, BAND_COUNTED })];
}
