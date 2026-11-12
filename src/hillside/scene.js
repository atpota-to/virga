// The hillside: a green hill under a big blue sky with fair-weather clouds,
// in the spirit of the photo every Windows XP desktop opened on. Something
// old and familiar, and open: the place a group ends up once it's out of
// someone else's app.
//
// It's a background and nothing more: nothing to click or change. The clouds
// drift, their shadows slide over the hill, gusts run through the grass, and
// the view eases a little with the pointer. It draws at a gentle frame rate,
// stops when it's off screen, the tab is hidden or the page says it isn't in
// view, and with reduced motion it holds still.
//
// Loaded on demand (see Hillside.tsx), so only the pages that use it pay for
// three.js.

import * as THREE from 'three';
import { createClouds, makeNoise } from './clouds.js';
import { createLand, height } from './land.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;

/* ---------- the light ---------- */

// Day is the picture: deep blue overhead, paler to the horizon, bright white
// clouds lit from behind you and a vivid green hill. Dawn is where Thread
// starts, before the group moves: a warm, low sun just behind the far hills.
const PALETTES = {
  day: {
    top: '#1c54cc',
    mid: '#3a7fe2',
    low: '#8bbaf0',
    hor: '#d4e7f8',
    sunCol: '#fff1d2',
    sun: [-0.62, 0.6, 0.4],
    disc: 0,
    cloudLit: '#ffffff',
    cloudShadow: '#a9bee6',
    cloudRim: '#fff4e4',
    cloudFog: '#cde1f6',
    lit: '#86c93a',
    mid2: '#43a026',
    shade: '#1d5c16',
    haze: '#a9c9e9',
  },
  dawn: {
    top: '#3b5aa8',
    mid: '#7890cf',
    low: '#e7b7a6',
    hor: '#ffd59e',
    sunCol: '#ffbf6e',
    sun: [0.6, 0.035, -0.8],
    disc: 1,
    cloudLit: '#ffe0c4',
    cloudShadow: '#8d8bbd',
    cloudRim: '#ffad62',
    cloudFog: '#f2cdb0',
    lit: '#9cb04a',
    mid2: '#557c2c',
    shade: '#22431e',
    haze: '#e4c2aa',
  },
};

const COLOR_KEYS = [
  'top',
  'mid',
  'low',
  'hor',
  'sunCol',
  'cloudLit',
  'cloudShadow',
  'cloudRim',
  'cloudFog',
  'lit',
  'mid2',
  'shade',
  'haze',
];

/**
 * Draw the hillside on `canvas`. Returns null where WebGL isn't available.
 *
 * `opts`:
 *   calm     reduced motion: a still picture, drawn when something changes
 *   day      0 is dawn, 1 is day
 *   depth    how deep a blue the sky reaches at the top of the frame: 1 is the
 *            full deep blue, less is paler, for a page with a lot of words on
 *            its sky
 *   soft     shown out of focus (the page blurs the canvas): drawn at a lower
 *            resolution, since the blur hides it, which is also much cheaper
 *   onReady  the first picture is up
 *   onLost   WebGL went away; the page's own background shows again
 *
 * The scene it returns:
 *   resize(width, height, crest)  the canvas's size, and how far down it the
 *                                 hill's crest should sit (0 to 1)
 *   setDay(day, instant)          ease toward dawn (0) or day (1); `instant`
 *                                 jumps there
 *   setActive(on)                 whether the page has it in view; out of
 *                                 view, it doesn't draw
 *   intro()                       step outside: the view comes down from the
 *                                 sky onto the hill
 *   dispose()
 */
export function createHillside(canvas, opts) {
  // The colours here are the ones written, as in atmosphere.online's sky: no
  // conversion on the way in or out.
  THREE.ColorManagement.enabled = false;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: (window.devicePixelRatio || 1) < 2,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const calm = opts.calm;

  /* ---------- colours, eased between dawn and day ---------- */
  const C = {};
  const A = {};
  const B = {};
  for (const k of COLOR_KEYS) {
    C[k] = new THREE.Color();
    A[k] = new THREE.Color(PALETTES.dawn[k]);
    B[k] = new THREE.Color(PALETTES.day[k]);
  }
  const sunA = new THREE.Vector3(...PALETTES.dawn.sun).normalize();
  const sunB = new THREE.Vector3(...PALETTES.day.sun).normalize();
  const sunDir = new THREE.Vector3();
  const qA = new THREE.Quaternion();
  const qT = new THREE.Quaternion();
  const ref = new THREE.Vector3(0, 0, -1);
  const uDisc = { value: 0 };
  const uSpan = { value: 0.45 };
  let dayGoal = clamp(opts.day, 0, 1);
  let dayT = dayGoal;
  function applyDay() {
    const e = smooth(dayT);
    for (const k of COLOR_KEYS) C[k].copy(A[k]).lerp(B[k], e);
    // the sun climbs the short way round, from the dawn spot to the day one
    qA.setFromUnitVectors(ref, sunA);
    qT.setFromUnitVectors(ref, sunB);
    qA.slerp(qT, e);
    sunDir.copy(ref).applyQuaternion(qA);
    uDisc.value = lerp(PALETTES.dawn.disc, PALETTES.day.disc, e);
  }
  applyDay();

  /* ---------- scene ---------- */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 40000);
  const noise = makeNoise(256);
  const uTime = { value: 0 };
  const uWindOff = { value: new THREE.Vector2() };
  const windDir = new THREE.Vector2(1, -0.18).normalize();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTop: { value: C.top },
      uMid: { value: C.mid },
      uLow: { value: C.low },
      uHor: { value: C.hor },
      uHaze: { value: C.haze },
      uSunDir: { value: sunDir },
      uSunCol: { value: C.sunCol },
      uDisc: uDisc,
      uSpan,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uLow, uHor, uHaze, uSunDir, uSunCol; uniform float uDisc, uSpan;
      varying vec3 vDir;
      void main(){
        // u is 0 at the horizon and 1 at the top of the frame, so the deep blue is always overhead
        vec3 d = normalize(vDir); float y = d.y, u = max(y, 0.0) / uSpan;
        vec3 c = mix(uHor, uLow, smoothstep(0.0, 0.22, u));
        c = mix(c, uMid, smoothstep(0.18, 0.75, u));
        c = mix(c, uTop, smoothstep(0.67, 1.38, u));
        if (y < 0.0) c = mix(uHor, uHaze, smoothstep(0.0, -0.02, y));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        c += uSunCol * (pow(sd, 6.0) * 0.2 + pow(sd, 48.0) * 0.32);
        // the sun itself, at dawn: a warm, soft-edged disc in its own glow
        c += uSunCol * uDisc * (pow(sd, 900.0) * 0.45 + smoothstep(0.99935, 0.9997, sd) * 0.5);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  const landColors = { lit: C.lit, mid: C.mid2, shade: C.shade, haze: C.haze };
  const land = createLand({
    scene,
    noise,
    colors: landColors,
    sunDir,
    uTime,
    uWindOff,
    windDir,
  });
  const cloudColors = {
    lit: C.cloudLit,
    shadow: C.cloudShadow,
    rim: C.cloudRim,
    fog: C.cloudFog,
  };
  const clouds = createClouds({
    scene,
    camera,
    noise,
    colors: cloudColors,
    sunDir,
    uTime,
    billow: calm ? 0 : 1,
  });

  /* ---------- the view ---------- */
  // Where you stand, and how the view is aimed so the crest of the hill
  // lands where the page wants it. A tall, narrow screen stands nearer the
  // foot of the hill, so the slope fills it rather than the grass at your feet.
  const EYE = 6.5;
  const view = { w: 1, h: 1, crest: 0.5, fov: 50, x: 0, z: 0, pitch: 0 };
  function aim() {
    const aspect = view.w / view.h;
    // at least about 52° across, short of a fish-eye on a phone
    view.fov = clamp(
      (2 * Math.atan(Math.tan(26 * DEG) / aspect)) / DEG,
      44,
      72,
    );
    const tall = smooth((0.34 - view.crest) / 0.22);
    view.z = lerp(0, -110, tall);
    view.x = lerp(0, -30, tall);
    const camY = height(view.x, view.z) + EYE;
    // the crest straight ahead: the highest the land rises, seen from here
    let crestAng = -0.2;
    for (let d = 8; d < 9000; d *= 1.04) {
      const h = height(view.x, view.z - d);
      crestAng = Math.max(crestAng, Math.atan2(h - camY, d));
    }
    const half = Math.tan((view.fov / 2) * DEG);
    view.pitch = crestAng - Math.atan((0.5 - view.crest) * 2 * half);
    // the sky's gradient spans the frame, from the horizon to its top edge
    uSpan.value =
      Math.max(0.12, Math.sin(view.pitch + (view.fov / 2) * DEG)) /
      clamp(opts.depth, 0.3, 1.2);
    camera.fov = view.fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  // The pointer leans the view a little; the intro looks up at the sky first.
  const lean = { x: 0, y: 0, gx: 0, gy: 0 };
  let introT = 1;
  function place(t) {
    const i = easeOut(introT);
    const look = (1 - i) * 7 * DEG;
    const step = (1 - i) * 26;
    const yaw =
      -lean.x * 1.4 * DEG + (calm ? 0 : Math.sin(t * 0.09) * 0.35 * DEG);
    const pitch =
      view.pitch +
      look -
      lean.y * 0.6 * DEG +
      (calm ? 0 : Math.sin(t * 0.13 + 1) * 0.12 * DEG);
    const x = view.x + lean.x * 3;
    const z = view.z + step;
    camera.position.set(x, height(x, z) + EYE + (1 - i) * 2, z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
  }

  /* ---------- drawing ---------- */
  let ratio = Math.min(window.devicePixelRatio || 1, opts.soft ? 0.75 : 1.5);
  const floor = opts.soft ? 0.5 : 0.6;
  let active = true;
  let shown = !document.hidden;
  let raf = 0;
  let last = 0;
  let since = 0;
  let clock = 0;
  let ready = false;
  let dead = false;
  // the pace check: if frames come slowly, draw fewer pixels
  let slowN = 0;
  let slowSum = 0;

  const WIND = 22;

  function draw(dt) {
    clock += dt;
    uTime.value = clock;
    uWindOff.value.addScaledVector(windDir, WIND * 0.9 * dt);
    if (dayT !== dayGoal) {
      const rate = dayGoal > dayT ? 1 / 3.6 : 1 / 0.8;
      dayT =
        dayGoal > dayT
          ? Math.min(dayGoal, dayT + dt * rate)
          : Math.max(dayGoal, dayT - dt * rate);
      applyDay();
    }
    if (introT < 1) introT = Math.min(1, introT + dt / 3.4);
    const k = 1 - Math.exp(-dt * 2.2);
    lean.x += (lean.gx - lean.x) * k;
    lean.y += (lean.gy - lean.y) * k;
    place(clock);
    clouds.update(dt, calm ? 0 : WIND);
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      opts.onReady();
    }
  }

  // Something on screen is moving fast enough to want every frame.
  const busy = () =>
    introT < 1 ||
    dayT !== dayGoal ||
    Math.abs(lean.gx - lean.x) > 0.002 ||
    Math.abs(lean.gy - lean.y) > 0.002;

  // Draw while the page has it in view, and, out of view, until a change of
  // light under way has finished, so it never stops halfway to dawn.
  const wanted = () => !dead && shown && (active || dayT !== dayGoal);

  function tick(now) {
    raf = 0;
    if (!wanted()) {
      last = 0;
      return;
    }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    since += dt;
    // a gentle 30 frames a second, unless the view is on the move
    if (busy() || since >= 1 / 31) {
      if (!busy()) {
        slowSum += since;
        if (++slowN >= 45) {
          if (slowSum / slowN > 1 / 20 && ratio > floor + 0.02) {
            ratio = Math.max(floor, ratio * 0.8);
            renderer.setPixelRatio(ratio);
            renderer.setSize(view.w, view.h, false);
          }
          slowN = 0;
          slowSum = 0;
        }
      }
      draw(since);
      since = 0;
    }
    raf = requestAnimationFrame(tick);
  }

  // With reduced motion, one picture whenever something changes.
  let pending = 0;
  function still() {
    if (pending || dead) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (!dead) draw(0);
    });
  }

  function run() {
    if (calm) {
      still();
      return;
    }
    if (!raf && wanted()) raf = requestAnimationFrame(tick);
  }

  const onVisibility = () => {
    shown = !document.hidden;
    run();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onPointer = (e) => {
    if (e.pointerType !== 'mouse') return;
    lean.gx = e.clientX / window.innerWidth - 0.5;
    lean.gy = e.clientY / window.innerHeight - 0.5;
  };
  if (!calm)
    window.addEventListener('pointermove', onPointer, { passive: true });

  const onLost = (e) => {
    e.preventDefault();
    dead = true;
    opts.onLost();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  renderer.setPixelRatio(ratio);

  return {
    resize(w, h, crest) {
      const nextW = Math.max(1, w);
      const nextH = Math.max(1, h);
      // Only when the size has changed: while the crest eases to a new place
      // this is called every frame, and setting a canvas's size, even to what
      // it already is, throws its picture away.
      const resized = nextW !== view.w || nextH !== view.h;
      view.w = nextW;
      view.h = nextH;
      view.crest = clamp(crest, 0.04, 0.96);
      if (resized) renderer.setSize(view.w, view.h, false);
      aim();
      if (calm || !raf) {
        // draw now, so a resize never shows a stretched frame
        if (!dead) draw(0);
      }
      run();
    },
    setDay(day, instant) {
      dayGoal = clamp(day, 0, 1);
      if (instant || calm) {
        dayT = dayGoal;
        applyDay();
      }
      run();
    },
    setActive(on) {
      active = on;
      run();
    },
    intro() {
      if (calm) return;
      introT = 0;
      run();
    },
    dispose() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      if (pending) cancelAnimationFrame(pending);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('webglcontextlost', onLost);
      clouds.dispose();
      land.dispose();
      sky.geometry.dispose();
      skyMat.dispose();
      noise.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
