// The hillside's scene (src/hillside/scene.js), which exports only
// createHillside: its module-level constants and helpers (PALETTES, TURN,
// COLOR_KEYS, phaseOf, smooth, easeOut, clamp, lerp) are read from its own
// source (_moduleScope.js), and createHillside itself is run the same way
// over a stand-in for the page: three.js as it is, but for a WebGLRenderer
// that records each picture instead of drawing it, a fake
// requestAnimationFrame whose frames the script sends at the times it
// says, and a window, document and canvas whose events the script fires.
// Each step of a script records how many pictures it drew, the last of
// them (the camera, the sky's, land's and clouds' uniforms, the clouds'
// batch summed), the frame callbacks left waiting, and any change of the
// pixel ratio. Swift: VirgaCore/Hillside/HillsideScene*.swift, held to it
// by HillsideSceneParityTests.

import * as THREE from 'three';
import { createClouds, makeNoise } from '../../../src/hillside/clouds.js';
import { createLand, height } from '../../../src/hillside/land.js';
import { each, value } from './_helpers.js';
import { moduleScope } from './_moduleScope.js';

export const sources = [
  'src/hillside/scene.js',
  'src/hillside/clouds.js',
  'src/hillside/land.js',
];

const SCENE = 'src/hillside/scene.js';

const v3 = (v) => [v.x, v.y, v.z];
const c3 = (c) => [c.r, c.g, c.b];

/** Sums of the batch's first `n` instances, per attribute. */
function batchSums(geo, n) {
  const sum = (name, size) => {
    const a = geo.getAttribute(name).array;
    let s = 0;
    for (let i = 0; i < n * size; i++) s += a[i];
    return s;
  };
  return {
    pos: sum('aPos', 3),
    rad: sum('aRad', 1),
    data: sum('aData', 4),
    fx: sum('aFx', 4),
    shape: sum('aShape', 4),
  };
}

/** What a picture is drawn from. */
function picture(scene, camera) {
  const at = (order) => scene.children.find((m) => m.renderOrder === order);
  const sky = at(-10).material.uniforms;
  const land = at(0).material.uniforms;
  const cloudMesh = at(5);
  const cl = cloudMesh.material.uniforms;
  const n = cloudMesh.geometry.instanceCount;
  return {
    time: land.uTime.value,
    windOff: [land.uWindOff.value.x, land.uWindOff.value.y],
    camera: {
      position: v3(camera.position),
      rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
      fov: camera.fov,
      aspect: camera.aspect,
      view: [...camera.matrixWorldInverse.elements],
      projection: [...camera.projectionMatrix.elements],
    },
    sky: {
      top: c3(sky.uTop.value),
      mid: c3(sky.uMid.value),
      low: c3(sky.uLow.value),
      hor: c3(sky.uHor.value),
      haze: c3(sky.uHaze.value),
      sunCol: c3(sky.uSunCol.value),
      sunDir: v3(sky.uSunDir.value),
      disc: sky.uDisc.value,
      stars: sky.uStars.value,
      span: sky.uSpan.value,
    },
    land: {
      lit: c3(land.uLit.value),
      mid: c3(land.uMid.value),
      shade: c3(land.uShade.value),
    },
    clouds: {
      lit: c3(cl.uLit.value),
      shadow: c3(cl.uShadow.value),
      rim: c3(cl.uRim.value),
      fog: c3(cl.uFog.value),
      billow: cl.uBillow.value,
      sunView: v3(cl.uSunView.value),
      count: n,
      sums: batchSums(cloudMesh.geometry, n),
    },
  };
}

/** createHillside(opts) over the stand-in page, through `script`. */
function run({ calm, phase, depth, soft, devicePixelRatio }, script) {
  const queued = new Map();
  let nextId = 1;
  const listeners = [];
  const on = (target) => (type, fn) => listeners.push({ target, type, fn });
  const off = () => {};
  const fire = (target, type, event) => {
    for (const l of listeners)
      if (l.target === target && l.type === type) l.fn(event);
  };
  const document = {
    hidden: false,
    addEventListener: on('document'),
    removeEventListener: off,
  };
  const window = {
    devicePixelRatio,
    innerWidth: 1,
    innerHeight: 1,
    addEventListener: on('window'),
    removeEventListener: off,
  };
  const canvas = { addEventListener: on('canvas'), removeEventListener: off };

  let pictures = [];
  let ratios = [];
  class WebGLRenderer {
    setPixelRatio(r) {
      ratios.push(r);
    }
    setSize() {}
    render(scene, camera) {
      pictures.push(picture(scene, camera));
    }
    dispose() {}
    forceContextLoss() {}
  }

  const { createHillside } = moduleScope(SCENE, ['createHillside'], {
    THREE: { ...THREE, WebGLRenderer },
    createClouds,
    makeNoise,
    createLand,
    height,
    window,
    document,
    requestAnimationFrame: (fn) => {
      const id = nextId++;
      queued.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => queued.delete(id),
  });

  const saved = THREE.ColorManagement.enabled;
  let readies = 0;
  let losts = 0;
  const steps = [];
  const record = (op) => {
    steps.push({
      ...op,
      draws: pictures.length,
      picture: pictures.at(-1) ?? null,
      queued: queued.size,
      ratios,
      ready: readies > 0,
      lost: losts > 0,
    });
    pictures = [];
    ratios = [];
  };
  try {
    const hill = createHillside(canvas, {
      calm,
      phase,
      depth,
      soft,
      onReady: () => readies++,
      onLost: () => losts++,
    });
    record({ op: 'create' });
    for (const op of script) {
      switch (op.op) {
        case 'resize':
          hill.resize(op.w, op.h, op.crest);
          break;
        case 'frames':
          for (let i = 0; i < op.count; i++) {
            // a frame runs the callbacks asked for before it
            const due = [...queued.values()];
            queued.clear();
            for (const fn of due) fn(op.start + i * op.step);
          }
          break;
        case 'phase':
          hill.setPhase(op.name, op.instant);
          break;
        case 'active':
          hill.setActive(op.on);
          break;
        case 'shown':
          document.hidden = !op.on;
          fire('document', 'visibilitychange', {});
          break;
        case 'pointer':
          window.innerWidth = op.width;
          window.innerHeight = op.height;
          fire('window', 'pointermove', {
            pointerType: op.type,
            clientX: op.x,
            clientY: op.y,
          });
          break;
        case 'intro':
          hill.intro();
          break;
        case 'lost':
          fire('canvas', 'webglcontextlost', { preventDefault() {} });
          break;
        case 'dispose':
          hill.dispose();
          break;
        default:
          throw new Error(`unknown step ${op.op}`);
      }
      record(op);
    }
  } finally {
    THREE.ColorManagement.enabled = saved;
  }
  return steps;
}

const HZ = 1000 / 60;
const frames = (start, step, count) => ({ op: 'frames', start, step, count });

// The live sky's (LiveSky.jsx: depth 0.55, not soft), on a phone of 3
// pixels a point: its canvas 30 bigger than the 390 × 1100 scene each way
// (the blur's bleed), the crest at 96% of the scene.
const LIVE = [
  { op: 'resize', w: 420, h: 1130, crest: (1056 + 15) / 1130 },
  frames(1000, HZ, 12),
  { op: 'pointer', type: 'mouse', x: 300, y: 200, width: 390, height: 844 },
  frames(1200, HZ, 10),
  { op: 'pointer', type: 'touch', x: 10, y: 10, width: 390, height: 844 },
  frames(1366.6666666666667, HZ, 90),
  { op: 'phase', name: 'night' },
  frames(3000, 100, 14),
  { op: 'phase', name: 'dawn' },
  frames(4400, 100, 20),
  { op: 'active', on: false },
  frames(6400, 100, 30),
  frames(9400, HZ, 5),
  { op: 'active', on: true },
  frames(10000, HZ, 6),
  { op: 'phase', name: 'night', instant: true },
  frames(10100, HZ, 4),
  { op: 'phase', name: 'night' },
  { op: 'phase', name: 'noon' },
  frames(10200, 250, 3),
  { op: 'shown', on: false },
  frames(11000, HZ, 4),
  { op: 'shown', on: true },
  frames(11100, HZ, 4),
  { op: 'resize', w: 420, h: 1130, crest: (1056 + 15) / 1130 },
  { op: 'resize', w: 1062, h: 1130, crest: (1056 + 15) / 1130 },
  frames(15000, 70, 50),
  frames(18500, 70, 50),
  frames(22000, 70, 100),
  { op: 'intro' },
  frames(30000, HZ, 30),
  frames(30500, 100, 35),
  { op: 'lost' },
  frames(40000, HZ, 4),
];

// Reduced motion: a still picture whenever something changes.
const CALM = [
  { op: 'resize', w: 1440, h: 930, crest: 0.62 },
  frames(1000, HZ, 1),
  frames(1100, HZ, 5),
  { op: 'phase', name: 'night' },
  frames(1200, HZ, 2),
  { op: 'intro' },
  { op: 'pointer', type: 'mouse', x: 100, y: 100, width: 1440, height: 930 },
  { op: 'resize', w: 1440, h: 930, crest: 0.62 },
  frames(1300, HZ, 1),
  { op: 'active', on: false },
  frames(1400, HZ, 1),
  { op: 'shown', on: false },
  frames(1500, HZ, 1),
  { op: 'resize', w: 800, h: 600, crest: 0.01 },
  { op: 'dispose' },
  frames(1600, HZ, 3),
];

// The hill behind a page, as Hillside.jsx starts it while the page has it
// covered (setActive, intro, then fit), on a tall phone with its crest
// high, then a wide desk with it low; soft, so at most 0.75 pixels a point.
const FRONT = [
  { op: 'active', on: false },
  { op: 'intro' },
  { op: 'resize', w: 420, h: 874, crest: (240 + 15) / 874 },
  frames(500, HZ, 3),
  { op: 'active', on: true },
  frames(1000, HZ, 40),
  frames(1700, 100, 40),
  { op: 'pointer', type: 'mouse', x: 1400, y: 20, width: 1440, height: 900 },
  { op: 'resize', w: 1470, h: 930, crest: (560 + 15) / 930 },
  frames(6000, HZ, 20),
  { op: 'phase', name: 'dusk' },
  frames(6400, 100, 10),
  { op: 'phase', name: 'day' },
  frames(7400, 100, 40),
  frames(11400, 70, 46),
  { op: 'resize', w: 300, h: 200, crest: 1.5 },
  frames(15000, HZ, 2),
];

export default async function cases() {
  const scope = moduleScope(
    SCENE,
    [
      'PALETTES',
      'TURN',
      'COLOR_KEYS',
      'DEG',
      'phaseOf',
      'clamp',
      'lerp',
      'smooth',
      'easeOut',
    ],
    { THREE },
  );
  const out = [];
  // The palettes as written, and each colour as three reads it with
  // colour management off (as createHillside has it).
  const saved = THREE.ColorManagement.enabled;
  THREE.ColorManagement.enabled = false;
  const rgb = {};
  for (const [name, p] of Object.entries(scope.PALETTES)) {
    rgb[name] = {};
    for (const key of scope.COLOR_KEYS)
      rgb[name][key] = c3(new THREE.Color().set(p[key]));
  }
  THREE.ColorManagement.enabled = saved;
  out.push(value('palettes', { palettes: scope.PALETTES, rgb }));
  out.push(
    value('constants', {
      TURN: scope.TURN,
      COLOR_KEYS: scope.COLOR_KEYS,
      DEG: scope.DEG,
    }),
  );
  out.push(
    ...(await each(
      'phaseOf',
      [
        'dawn',
        'day',
        'dusk',
        'night',
        'noon',
        'Day',
        '',
        null,
        '__proto__',
        'constructor',
        'hasOwnProperty',
      ].map((name) => ({ name })),
      ({ name }) => scope.phaseOf(name),
    )),
  );
  const TS = [-1, -0.25, 0, 0.1, 0.25, 0.5, 0.7, 0.999, 1, 1.5, 3];
  out.push(
    ...(await each(
      'easing',
      TS.map((t) => ({ t })),
      ({ t }) => ({
        smooth: scope.smooth(t),
        easeOut: scope.easeOut(t),
        clamp: scope.clamp(t, 0, 1),
        lerp: scope.lerp(-110, 30, t),
      }),
    )),
  );
  out.push(
    ...(await each(
      'createHillside',
      [
        {
          $id: 'live-sky',
          options: {
            calm: false,
            phase: 'day',
            depth: 0.55,
            soft: false,
            devicePixelRatio: 3,
          },
          script: LIVE,
        },
        {
          $id: 'calm',
          options: {
            calm: true,
            phase: 'dusk',
            depth: 1,
            soft: true,
            devicePixelRatio: 2,
          },
          script: CALM,
        },
        {
          $id: 'front',
          options: {
            calm: false,
            phase: 'dawn',
            depth: 1,
            soft: true,
            devicePixelRatio: 3,
          },
          script: FRONT,
        },
        {
          $id: 'unknown-sky',
          options: {
            calm: false,
            phase: 'aurora',
            depth: 2,
            soft: false,
            devicePixelRatio: 1,
          },
          script: [
            { op: 'resize', w: 0, h: 0, crest: 0.5 },
            frames(100, HZ, 3),
          ],
        },
      ],
      ({ options, script }) => run(options, script),
    )),
  );
  return out;
}
