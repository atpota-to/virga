// The clouds' noise: mulberry's random numbers and makeNoise's texture.
// Swift: VirgaCore/Hillside/HillsideClouds.swift.

import { makeNoise, mulberry } from '../../../src/hillside/clouds.js';
import { each } from './_helpers.js';

export const sources = ['src/hillside/clouds.js'];

const SEEDS = [
  7, 0, 1, -3, 42, 123456789, 2147483647, -2147483648, 4294967295, 2.75,
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'mulberry',
      SEEDS.map((seed) => ({ seed })),
      ({ seed }) => {
        const r = mulberry(seed);
        return Array.from({ length: 12 }, () => r());
      },
    )),
  );
  // The gray channel (r; g and b are the same, alpha 255), whole for the
  // small sizes and sampled for the app's 256.
  out.push(
    ...(await each(
      'makeNoise',
      [
        { size: 8, seed: 7 },
        { size: 16, seed: 7 },
        { size: 32, seed: 3 },
        { size: 64, seed: 7 },
        { size: 16, seed: -11 },
      ],
      ({ size, seed }) => {
        const data = makeNoise(size, seed).image.data;
        const gray = [];
        for (let i = 0; i < size * size; i++) gray.push(data[i * 4]);
        const extra = [data[1], data[2], data[3]];
        return { gray, extra };
      },
    )),
  );
  out.push(
    ...(await each(
      'makeNoiseSampled',
      [{ size: 256, seed: 7, step: 251 }],
      ({ size, seed, step }) => {
        const data = makeNoise(size, seed).image.data;
        const sample = [];
        let sum = 0;
        for (let i = 0; i < size * size; i++) {
          sum += data[i * 4];
          if (i % step === 0) sample.push(data[i * 4]);
        }
        return { sample, sum };
      },
    )),
  );
  return out;
}
