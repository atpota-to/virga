// The hillside's clouds, drawn the way atmosphere.online draws its sky: each
// cloud is a heap of soft, lit sphere impostors ("puffs") with noisy, eroded
// edges, sun on one side and a warm rim on the other, all in one instanced
// batch sorted back to front. The noise, the puff material and the cumulus,
// cirrus and stratus generators come from atmosphere.online's sky, kept as
// close to it as a background allows: no picking, no reshaping, no weather.

import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngAt = (seed, i) => {
  const r = mulberry((seed * 7919 + i * 104729 + 17) | 0);
  r();
  return r;
};

// Tileable value noise: puff edges, and the grass, its patches and the cloud
// shadows on the hill. Seeded, so the hill looks the same every visit.
export function makeNoise(size, seed = 7) {
  const rand = mulberry(seed);
  const oct = [
    [4, 0.42],
    [8, 0.28],
    [16, 0.16],
    [32, 0.09],
    [64, 0.05],
  ];
  const grids = oct.map(([p]) => {
    const g = new Float32Array(p * p);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return g;
  });
  const sum = oct.reduce((s, o) => s + o[1], 0);
  const tmp = new Float32Array(size * size);
  let lo = 1e9;
  let hi = -1e9;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let k = 0; k < oct.length; k++) {
        const p = oct[k][0];
        const g = grids[k];
        const fx = (x / size) * p;
        const fy = (y / size) * p;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        let tx = fx - ix;
        let ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const x0 = ix % p;
        const x1 = (ix + 1) % p;
        const y0 = iy % p;
        const y1 = (iy + 1) % p;
        const a = g[y0 * p + x0];
        const b = g[y0 * p + x1];
        const c = g[y1 * p + x0];
        const d = g[y1 * p + x1];
        v +=
          oct[k][1] * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
      }
      v /= sum;
      tmp[y * size + x] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(((tmp[i] - lo) / (hi - lo)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// One material for every puff. Each puff is an instance: aPos (where), aRad
// (how big), aData (overall light, shade, alpha, seed), aFx (edge erosion in
// z) and aShape (an axis in world space and the stretch along it: over 1 a
// streak, under 1 a pancake).
function puffMaterial(o) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uTime: o.uTime,
      uNoise: { value: o.noise },
      uSunView: o.uSunView,
      uLit: { value: o.colors.lit },
      uShadow: { value: o.colors.shadow },
      uRim: { value: o.colors.rim },
      uStorm: { value: o.storm },
      uFog: { value: o.colors.fog },
      uFogNear: { value: o.fogNear },
      uFogFar: { value: o.fogFar },
      uFogMax: { value: o.fogMax },
      uBillow: { value: o.billow },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute float aRad; attribute vec4 aData; attribute vec4 aFx; attribute vec4 aShape;
      uniform float uTime, uFogNear, uFogFar, uFogMax, uBillow;
      varying vec2 vUv; varying vec4 vData; varying vec4 vFx; varying float vFog; varying vec2 vE1; varying float vFiber; varying float vFlat;
      void main(){
        vec4 mv = viewMatrix * vec4(aPos, 1.0);
        float r = aRad * (1.0 + 0.045 * uBillow * sin(uTime * 0.8 + aData.w * 40.0));
        // the spheroid's outline on screen, in units of r: I + k a a^T, a being its axis as seen from here
        vec2 a = (mat3(viewMatrix) * aShape.xyz).xy;
        float k = aShape.w * aShape.w - 1.0;
        float cxx = 1.0 + k * a.x * a.x, cyy = 1.0 + k * a.y * a.y, cxy = k * a.x * a.y;
        float m = 0.5 * (cxx + cyy), dl = sqrt(0.25 * (cxx - cyy) * (cxx - cyy) + cxy * cxy);
        float l1 = m + dl, l2 = max(m - dl, 0.0004);
        vec2 e1 = abs(cxy) > 1e-5 ? normalize(vec2(l1 - cyy, cxy)) : (cxx >= cyy ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
        mv.xy += (position.x * sqrt(l1) * e1 + position.y * sqrt(l2) * vec2(-e1.y, e1.x)) * r * 1.25;
        gl_Position = projectionMatrix * mv;
        vUv = position.xy; vData = aData; vFx = aFx; vE1 = e1;
        vFiber = smoothstep(1.7, 3.6, sqrt(l1 / l2));
        vFlat = smoothstep(0.95, 0.45, aShape.w);
        vFog = smoothstep(uFogNear, uFogFar, -mv.z) * uFogMax;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunView, uLit, uShadow, uRim, uStorm, uFog;
      varying vec2 vUv; varying vec4 vData; varying vec4 vFx; varying float vFog; varying vec2 vE1; varying float vFiber; varying float vFlat;
      void main(){
        vec2 p = vUv * 1.25; float r2 = dot(p, p);
        if (r2 > 1.5625) discard;
        // x runs along the puff's long axis: a streak's noise changes slowly along it and fast across it
        vec2 nuv = vUv * vec2(0.32, 0.32 + vFiber * 0.9) + vData.w * vec2(13.17, 7.71) + uTime * vec2(0.006, 0.0025);
        float nn = texture2D(uNoise, nuv).r * 0.6 + texture2D(uNoise, nuv * 2.6 + 0.43).r * 0.4;
        float ero = vFx.z;
        // pancakes get softer edges, so a sheet of them melts into one
        float a = smoothstep(0.0, 0.42 + ero * 0.35 + vFlat * 0.3, (1.0 - r2) + (nn - 0.5) * ero * 1.5 - ero * 0.06);
        float alpha = a * vData.z;
        if (alpha < 0.004) discard;
        vec2 ps = p.x * vE1 + p.y * vec2(-vE1.y, vE1.x);
        float z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
        vec3 N = normalize(vec3(ps * 0.5, z + 0.6));
        // mostly the cloud's own light, a little of the puff's roundness
        float L = clamp(mix(dot(N, uSunView) * 0.5 + 0.5, vData.x, 0.75 + vFlat * 0.2) + (nn - 0.5) * (0.2 - vFlat * 0.1), 0.0, 1.0);
        vec3 col = mix(uShadow, uLit, smoothstep(0.0, 0.78, L));
        col = mix(col, uStorm, vData.y);
        float rimF = pow(clamp(1.0 - z, 0.0, 1.0), 1.6) * (1.0 - vFlat * 0.75);
        float svl = length(uSunView.xy);
        float toward = svl > 0.001 ? clamp(dot(normalize(ps + 1e-4), uSunView.xy / svl), 0.0, 1.0) : 0.0;
        col += uRim * rimF * toward * (1.0 - vData.y * 0.7) * (0.3 + 0.5 * clamp(-uSunView.z, 0.0, 1.0));
        col = mix(col, uFog, vFog);
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
  });
}

/* ---------- cloud types ---------- */

const TYPES = {
  cumulus: { base: 160, alpha: 0.96, ero: 0.55, drift: 1 },
  stratus: { base: 170, alpha: 0.8, ero: 0.45, drift: 0.7 },
  cirrus: { base: 260, alpha: 0.34, ero: 0.95, drift: 1.6 },
};

// Puffs come out in the cloud's own space: about 12 units wide at size 1, base
// at y = 0.
const GEN = {
  cumulus(seed, P) {
    const R = mulberry(seed);
    const n = Math.round(TYPES.cumulus.base * P.count);
    const out = [];
    const k = 3 + Math.floor(R() * 3);
    const domes = [];
    for (let j = 0; j < k; j++) {
      const f = j / (k - 1) - 0.5;
      const big = 1 - Math.abs(f) * 0.9;
      const rad = 1.9 + big * 1.9 + R() * 0.8;
      domes.push({
        cx: f * 8.5 + (R() - 0.5) * 1.2,
        cz: (R() - 0.5) * 2.6,
        rad,
        H: rad * (0.95 + R() * 0.5) * P.height,
        w: rad,
      });
    }
    const wsum = domes.reduce((s, d) => s + d.w, 0);
    for (let i = 0; i < n; i++) {
      const r = rngAt(seed, i);
      if (r() < 0.22) {
        // the base: wide, flattened puffs, so the bottom reads as one level line
        const x = (r() - 0.5) * 12.4;
        const pr = (1.15 + r() * 0.7) * (0.75 + P.fluff * 0.5);
        out.push({
          x,
          y: pr * 0.3,
          z: (r() - 0.5) * 4.8 * (1 - Math.abs(x) / 9),
          r: pr,
          sh: 0.04,
          st: 0.42,
        });
        continue;
      }
      let pick = r() * wsum;
      let d = domes[0];
      for (const q of domes) {
        pick -= q.w;
        if (pick <= 0) {
          d = q;
          break;
        }
      }
      const u = r() * TAU;
      const v = r() ** 0.7;
      const s = Math.sqrt(1 - v * v);
      const rad = r() ** 0.3;
      // most fill the dome; some are small, crisp florets right on its skin, the cauliflower look
      const floret = r() < 0.2;
      const pr = floret
        ? (0.5 + r() * 0.3) * (0.8 + P.fluff * 0.4)
        : (0.8 + r() * 1.1) * (1 - rad * 0.25) * (0.7 + P.fluff * 0.6);
      const reach = floret ? 1.08 : rad;
      const x = d.cx + Math.cos(u) * s * d.rad * 1.2 * reach;
      const z = d.cz + Math.sin(u) * s * d.rad * 0.95 * reach;
      out.push({
        x,
        y: Math.max(v * d.H * reach + 0.4, pr * 0.6),
        z,
        r: pr,
        sh: 0,
      });
    }
    return out;
  },
  stratus(seed, P) {
    const R = mulberry(seed);
    const n = Math.round(TYPES.stratus.base * P.count);
    const out = [];
    const W = 14 + R() * 4;
    const D = 6.5 + R() * 2.5;
    const ph = R() * TAU;
    for (let i = 0; i < n; i++) {
      const r = rngAt(seed, i);
      const gx = (r() + r() + r() - 1.5) / 1.5;
      const gz = r() + r() - 1;
      const edge = 1 - Math.min(1, Math.hypot(gx, gz * 0.8));
      const x = gx * W;
      const z = gz * D;
      const swell =
        Math.sin(x * 0.3 + ph) * 0.3 + Math.sin(z * 0.55 + ph * 1.7) * 0.18;
      const pr =
        (1.8 + r() * 1.2) * (0.75 + P.fluff * 0.5) * (0.55 + edge * 0.5);
      out.push({
        x,
        y: 0.8 + (swell + (r() - 0.5) * 0.5) * P.height * (0.5 + edge * 0.7),
        z,
        r: pr,
        sh: 0.07 + (1 - edge) * 0.05,
        st: 0.3 + r() * 0.1,
      });
    }
    return out;
  },
  cirrus(seed, P) {
    const R = mulberry(seed);
    const n = Math.round(TYPES.cirrus.base * P.count);
    const out = [];
    const S = 4 + Math.floor(R() * 3);
    const flow = (R() - 0.5) * 0.5;
    const strands = Array.from({ length: S }, (_, j) => ({
      x0: -9 + R() * 3,
      z0: (j / (S - 1) - 0.5) * 10 + (R() - 0.5) * 2,
      y0: (R() - 0.5) * 1.2,
      len: 11 + R() * 7,
      ang: flow + (R() - 0.5) * 0.35,
      ph: R() * TAU,
      amp: 0.5 + R() * 0.9,
      waves: 1 + R() * 1.5,
      hook: R() < 0.65,
      lift: 1 + R() * 1.4,
    }));
    // a point on a strand: a long, slow wave, most ending in a hook that curls
    // up and back, the "mares' tails"
    const at = (s, t) => {
      const ca = Math.cos(s.ang);
      const sa = Math.sin(s.ang);
      const u = t * s.len;
      const wig = Math.sin(t * s.waves * Math.PI + s.ph) * s.amp;
      let x = s.x0 + u * ca - wig * sa;
      let z = s.z0 + u * sa + wig * ca;
      let y = s.y0 + Math.sin(t * 2.2 + s.ph) * 0.35;
      if (s.hook && t > 0.7) {
        const c = (t - 0.7) / 0.3;
        y += c * c * s.lift * 0.6;
        x -= c * c * 0.7 * ca;
        z -= c * c * 0.7 * sa;
      }
      return [x, y * P.height, z];
    };
    for (let i = 0; i < n; i++) {
      const r = rngAt(seed, i);
      const s = strands[Math.floor(r() * S)];
      const t = r();
      const p = at(s, t);
      const a = at(s, Math.max(0, t - 0.02));
      const b = at(s, Math.min(1, t + 0.02));
      let ax = b[0] - a[0];
      let ay = b[1] - a[1];
      let az = b[2] - a[2];
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al;
      ay /= al;
      az /= al;
      const off = (r() - 0.5) * 1.1;
      const head = s.hook && t > 0.86;
      const pr =
        (0.3 + r() * 0.28) *
        (0.75 + P.fluff * 0.5) *
        (1 - Math.abs(t - 0.5) * 0.5) *
        (head ? 1.35 : 1);
      out.push({
        x: p[0] - az * off,
        y: 1 + p[1] + (r() - 0.5) * 0.25,
        z: p[2] + ax * off,
        r: pr,
        sh: 0,
        ax,
        ay,
        az,
        st: head ? 1.3 : 3.4 + r() * 2.2,
      });
    }
    return out;
  },
};

function measureTop(puffs) {
  let top = 0.5;
  for (const p of puffs) top = Math.max(top, p.y + p.r * 0.5);
  return top;
}

function makeCloud(kind, seed, P, pos, rotY) {
  const T = TYPES[kind];
  const grow = 1 / Math.sqrt(P.count);
  const R = mulberry(seed + 1);
  const puffs = GEN[kind](seed, P).map((g) => ({
    ...g,
    r: g.r * grow,
    ax: g.ax ?? 0,
    ay: g.ay ?? 1,
    az: g.az ?? 0,
    st: g.st ?? 1,
    seed: R(),
  }));
  return {
    kind,
    size: P.size,
    rotY,
    pos,
    puffs,
    top: measureTop(puffs),
    alpha: T.alpha,
    ero: T.ero * (0.55 + P.fluff * 0.9),
  };
}

// The sky of a fair day, the same one every visit: fat cumulus scattered
// through the middle of the sky, little ones low over the far hills, and
// mares' tails way up. The camera looks down -z; one unit is a metre.
function layout(seed) {
  const R = mulberry(seed);
  const out = [];
  const add = (kind, dist, ang, alt, size, count) => {
    const P = { size, height: 0.8 + R() * 0.5, fluff: 0.55 + R() * 0.3, count };
    const pos = new THREE.Vector3(
      Math.sin(ang) * dist,
      alt,
      -Math.cos(ang) * dist,
    );
    out.push(makeCloud(kind, (R() * 1e9) | 0, P, pos, R() * TAU));
  };
  // the big ones, in the middle of the sky
  for (let i = 0; i < 9; i++)
    add(
      'cumulus',
      2800 + R() * 3600,
      (i / 9 - 0.5) * 2.4 + (R() - 0.5) * 0.2,
      700 + R() * 900,
      55 + R() * 35,
      0.55,
    );
  // small ones low over the horizon, far off
  for (let i = 0; i < 16; i++)
    add(
      'cumulus',
      9000 + R() * 5000,
      (i / 16 - 0.5) * 2.4 + (R() - 0.5) * 0.12,
      500 + R() * 600,
      55 + R() * 40,
      0.3,
    );
  // a thin sheet or two along the horizon
  for (let i = 0; i < 5; i++)
    add(
      'stratus',
      15000 + R() * 3000,
      (i / 5 - 0.5) * 2.2,
      700 + R() * 400,
      120 + R() * 60,
      0.3,
    );
  // mares' tails, way up and far off
  for (let i = 0; i < 5; i++)
    add(
      'cirrus',
      8000 + R() * 4000,
      (i / 5 - 0.5) * 1.9 + (R() - 0.5) * 0.3,
      4200 + R() * 1600,
      110 + R() * 50,
      0.8,
    );
  return out;
}

/* ---------- the batch ---------- */

export function createClouds(o) {
  const clouds = layout(20061);
  const MAX = clouds.reduce((n, c) => n + c.puffs.length, 0);
  const geo = new THREE.InstancedBufferGeometry();
  {
    const pl = new THREE.PlaneGeometry(2, 2);
    geo.index = pl.index;
    geo.setAttribute('position', pl.getAttribute('position'));
  }
  const attr = (n) =>
    new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(
      THREE.DynamicDrawUsage,
    );
  const aPos = attr(3);
  const aRad = attr(1);
  const aData = attr(4);
  const aFx = attr(4);
  const aShape = attr(4);
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aRad', aRad);
  geo.setAttribute('aData', aData);
  geo.setAttribute('aFx', aFx);
  geo.setAttribute('aShape', aShape);
  geo.instanceCount = 0;
  const uSunView = { value: new THREE.Vector3() };
  const mat = puffMaterial({
    uTime: o.uTime,
    uSunView,
    noise: o.noise,
    colors: o.colors,
    storm: new THREE.Color('#7d86b0'),
    fogNear: 2500,
    fogFar: 16000,
    fogMax: 0.62,
    billow: o.billow,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  o.scene.add(mesh);

  const stPos = new Float32Array(MAX * 3);
  const stRad = new Float32Array(MAX);
  const stData = new Float32Array(MAX * 4);
  const stFx = new Float32Array(MAX * 4);
  const stAx = new Float32Array(MAX * 4);
  const depth = new Float32Array(MAX);
  const order = new Uint32Array(MAX);
  const fwd = new THREE.Vector3();

  // How far round from straight ahead a cloud can drift before it wraps to
  // the other side, and where it starts to fade.
  const EDGE = 1.25;
  const FADE = 1.05;

  function stage(c, ca, n) {
    const s = c.size;
    const cs = Math.cos(c.rotY);
    const sn = Math.sin(c.rotY);
    const bx = c.pos.x;
    const by = c.pos.y;
    const bz = c.pos.z;
    const my = by + c.top * s * 0.45;
    const sun = o.sunDir;
    const cam = o.camera.position;
    for (const p of c.puffs) {
      const lx = p.x * s;
      const ly = p.y * s;
      const lz = p.z * s;
      const wx = bx + lx * cs + lz * sn;
      const wy = by + ly;
      const wz = bz - lx * sn + lz * cs;
      const ox = wx - bx;
      const oy = wy - my;
      const oz = wz - bz;
      const ol = Math.hypot(ox, oy, oz) || 1;
      const side = (ox * sun.x + oy * sun.y + oz * sun.z) / ol;
      const h = p.hl ?? clamp(p.y / c.top, 0, 1);
      const al = Math.hypot(p.ax, p.ay, p.az) || 1;
      const i4 = n * 4;
      stPos[n * 3] = wx;
      stPos[n * 3 + 1] = wy;
      stPos[n * 3 + 2] = wz;
      stRad[n] = p.r * s;
      stData[i4] = 0.1 + 0.5 * h + 0.45 * (0.5 + 0.5 * side);
      stData[i4 + 1] = clamp(p.sh, 0, 0.92);
      stData[i4 + 2] = ca;
      stData[i4 + 3] = p.seed;
      stFx[i4] = 0;
      stFx[i4 + 1] = 0;
      stFx[i4 + 2] = c.ero;
      stFx[i4 + 3] = 0;
      stAx[i4] = (p.ax * cs + p.az * sn) / al;
      stAx[i4 + 1] = p.ay / al;
      stAx[i4 + 2] = (p.az * cs - p.ax * sn) / al;
      stAx[i4 + 3] = p.st;
      depth[n] =
        (wx - cam.x) * fwd.x + (wy - cam.y) * fwd.y + (wz - cam.z) * fwd.z;
      n++;
    }
    return n;
  }

  // Wind carries the clouds sideways across the view, at their own pace by
  // type, round the back to come in again from the other side.
  function update(dt, wind) {
    o.camera.getWorldDirection(fwd);
    let n = 0;
    for (const c of clouds) {
      const T = TYPES[c.kind];
      const d = Math.hypot(c.pos.x, c.pos.z);
      let ang = Math.atan2(c.pos.x, -c.pos.z) + (wind * T.drift * dt) / d;
      if (ang > EDGE) ang -= EDGE * 2;
      else if (ang < -EDGE) ang += EDGE * 2;
      c.pos.x = Math.sin(ang) * d;
      c.pos.z = -Math.cos(ang) * d;
      const ca = c.alpha * (1 - smooth(FADE, EDGE, Math.abs(ang)));
      if (ca > 0.003) n = stage(c, ca, n);
    }
    for (let i = 0; i < n; i++) order[i] = i;
    order.subarray(0, n).sort((a, b) => depth[b] - depth[a]);
    const P = aPos.array;
    const Rr = aRad.array;
    const D = aData.array;
    const F = aFx.array;
    const A = aShape.array;
    for (let i = 0; i < n; i++) {
      const j = order[i];
      P[i * 3] = stPos[j * 3];
      P[i * 3 + 1] = stPos[j * 3 + 1];
      P[i * 3 + 2] = stPos[j * 3 + 2];
      Rr[i] = stRad[j];
      for (let k = 0; k < 4; k++) {
        D[i * 4 + k] = stData[j * 4 + k];
        F[i * 4 + k] = stFx[j * 4 + k];
        A[i * 4 + k] = stAx[j * 4 + k];
      }
    }
    geo.instanceCount = n;
    aPos.needsUpdate =
      aRad.needsUpdate =
      aData.needsUpdate =
      aFx.needsUpdate =
        true;
    aShape.needsUpdate = true;
    uSunView.value
      .copy(o.sunDir)
      .transformDirection(o.camera.matrixWorldInverse);
  }

  return {
    update,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
