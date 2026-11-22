// The clouds: mulberry's random numbers and makeNoise's texture; the
// cloud kinds (TYPES), their generators (GEN), makeCloud, measureTop and
// the fair day's layout, which clouds.js doesn't export and so are read
// from its own source (_moduleScope.js); and createClouds' batch, its
// drift and its staging, over a real camera and a stand-in scene.
// Swift: VirgaCore/Hillside/HillsideClouds*.swift.

import * as THREE from 'three';
import {
  createClouds,
  makeNoise,
  mulberry,
} from '../../../src/hillside/clouds.js';
import { each, value } from './_helpers.js';
import { moduleScope } from './_moduleScope.js';

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
  out.push(...(await kinds()));
  out.push(...(await batches()));
  return out;
}

const FIELDS = ['x', 'y', 'z', 'r', 'sh', 'st', 'ax', 'ay', 'az', 'seed'];

/** A heap of puffs: how many, each field summed (undefined as null), and some whole. */
function heap(puffs, every) {
  const sums = {};
  const missing = {};
  for (const f of FIELDS) {
    sums[f] = 0;
    missing[f] = 0;
    for (const p of puffs) {
      if (p[f] === undefined) missing[f] += 1;
      else sums[f] += p[f];
    }
  }
  return {
    count: puffs.length,
    sums,
    missing,
    sample: puffs
      .map((p, i) => ({ i, ...p }))
      .filter(({ i }) => i % every === 0 || i === puffs.length - 1),
  };
}

async function kinds() {
  const scope = moduleScope(
    'src/hillside/clouds.js',
    ['TYPES', 'GEN', 'makeCloud', 'measureTop', 'layout'],
    { THREE },
  );
  const out = [value('types', scope.TYPES)];
  const P = [
    { size: 60, height: 1, fluff: 0.7, count: 0.3 },
    { size: 140, height: 0.8, fluff: 0.55, count: 0.05 },
    { size: 55, height: 1.3, fluff: 0.85, count: 0.8 },
  ];
  const SEEDS = [1, 424242, -7, 987654321];
  const inputs = [];
  for (const kind of ['cumulus', 'stratus', 'cirrus'])
    for (const seed of SEEDS)
      for (const p of P) inputs.push({ kind, seed, P: p });
  out.push(
    ...(await each('gen', inputs, ({ kind, seed, P: p }) =>
      heap(scope.GEN[kind](seed, p), 9),
    )),
  );
  out.push(
    ...(await each(
      'makeCloud',
      [
        {
          kind: 'cumulus',
          seed: 5,
          P: P[0],
          pos: [100, 700, -2800],
          rotY: 1.2,
        },
        { kind: 'stratus', seed: 77, P: P[1], pos: [-9, 900, -15000], rotY: 0 },
        { kind: 'cirrus', seed: -3, P: P[2], pos: [0, 4200, -8000], rotY: 6 },
      ],
      ({ kind, seed, P: p, pos, rotY }) => {
        const c = scope.makeCloud(
          kind,
          seed,
          p,
          new THREE.Vector3(...pos),
          rotY,
        );
        return {
          kind: c.kind,
          size: c.size,
          rotY: c.rotY,
          pos: [c.pos.x, c.pos.y, c.pos.z],
          top: c.top,
          alpha: c.alpha,
          ero: c.ero,
          puffs: heap(c.puffs, 11),
        };
      },
    )),
  );
  out.push(
    ...(await each('layout', [{ seed: 20061 }, { seed: 3 }], ({ seed }) =>
      scope.layout(seed).map((c) => ({
        kind: c.kind,
        size: c.size,
        rotY: c.rotY,
        pos: [c.pos.x, c.pos.y, c.pos.z],
        top: c.top,
        alpha: c.alpha,
        ero: c.ero,
        puffs: heap(c.puffs, 1000),
      })),
    )),
  );
  return out;
}

/** createClouds' batch after each of `steps` updates, the camera placed as given. */
function batch({ camera: cam, sun, steps }) {
  let mesh = null;
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 40000);
  camera.position.set(...cam.position);
  camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
  const sunDir = new THREE.Vector3(...sun);
  const clouds = createClouds({
    scene: { add: (m) => (mesh = m) },
    camera,
    noise: null,
    colors: {
      lit: new THREE.Color(),
      shadow: new THREE.Color(),
      rim: new THREE.Color(),
      fog: new THREE.Color(),
    },
    sunDir,
    uTime: { value: 0 },
    billow: 1,
  });
  const geo = mesh.geometry;
  const u = mesh.material.uniforms;
  return steps.map(({ dt, wind }) => {
    clouds.update(dt, wind);
    const n = geo.instanceCount;
    const attr = (name, size, i) => [
      ...geo.getAttribute(name).array.slice(i * size, i * size + size),
    ];
    const rows = [];
    for (let i = 0; i < n; i += 97)
      rows.push({
        i,
        pos: attr('aPos', 3, i),
        rad: attr('aRad', 1, i)[0],
        data: attr('aData', 4, i),
        fx: attr('aFx', 4, i),
        shape: attr('aShape', 4, i),
      });
    let sum = 0;
    for (const name of ['aPos', 'aRad', 'aData', 'aFx', 'aShape']) {
      const a = geo.getAttribute(name).array;
      const size = geo.getAttribute(name).itemSize;
      for (let i = 0; i < n * size; i++) sum += a[i];
    }
    return {
      count: n,
      sunView: [u.uSunView.value.x, u.uSunView.value.y, u.uSunView.value.z],
      sum,
      rows,
    };
  });
}

async function batches() {
  return each(
    'update',
    [
      {
        $id: 'ahead',
        camera: { position: [0, 9.5, 0], pitch: 0.06, yaw: 0.001 },
        sun: [-0.62, 0.6, 0.4],
        steps: [
          { dt: 0, wind: 22 },
          { dt: 1 / 30, wind: 22 },
          { dt: 0.1, wind: 22 },
          { dt: 0.1, wind: 0 },
        ],
      },
      {
        // a long way round: clouds wrap past the edge and fade at it
        $id: 'wrapping',
        camera: { position: [-30, 70, -110], pitch: 0.2, yaw: -0.02 },
        sun: [0.6, 0.035, -0.8],
        steps: [
          { dt: 60, wind: 22 },
          { dt: 300, wind: 22 },
          { dt: 900, wind: 22 },
          { dt: 50, wind: -22 },
        ],
      },
    ],
    batch,
  );
}
