// The land under the sky: one long, round hill across the whole view, a lower
// shoulder to the right with a saddle between, and far hills going blue in
// the haze beyond. The grass is drawn, not modelled: patches greener and
// yellower, fine streaks up close, the shadows of clouds you can't see
// sliding over it, and gusts of wind combing it over to show its paler side.
// The camera stands near (0, 0), looking down -z. One unit is a metre.

import * as THREE from 'three';

const bump = (u, v) => Math.exp(-(u * u + v * v));

export function height(x, z) {
  // the near meadow, rolling a little
  let h =
    2.5 * Math.sin(x * 0.012 + 1.1) * Math.cos(z * 0.01 + 0.3) +
    1.2 * Math.sin((x + z) * 0.021);
  // the hill
  h += 62 * bump((x + 90) / 270, (z + 430) / 210);
  // its shoulder to the right, lower and further off, with a saddle between
  h += 34 * bump((x - 430) / 260, (z + 780) / 220);
  // far hills, in the haze
  h += 95 * bump((x - 1500) / 800, (z + 2900) / 600);
  h += 80 * bump((x + 1700) / 1000, (z + 3400) / 700);
  h += 130 * bump((x - 300) / 1800, (z + 5600) / 1000);
  h += 70 * bump((x - 2800) / 900, (z + 2100) / 500);
  return h;
}

export function createLand(o) {
  // A polar grid round the camera: fine underfoot, coarse at the horizon.
  const RINGS = 190;
  const SEGS = 320;
  const R0 = 1;
  const R1 = 9000;
  const pos = new Float32Array(RINGS * SEGS * 3);
  const nrm = new Float32Array(RINGS * SEGS * 3);
  for (let i = 0; i < RINGS; i++) {
    const r = R0 * (R1 / R0) ** (i / (RINGS - 1));
    const e = Math.max(0.25, r * 0.004);
    for (let j = 0; j < SEGS; j++) {
      const a = (j / SEGS) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      const k = (i * SEGS + j) * 3;
      pos[k] = x;
      pos[k + 1] = height(x, z);
      pos[k + 2] = z;
      const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
      const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      const l = Math.hypot(dx, 1, dz);
      nrm[k] = -dx / l;
      nrm[k + 1] = 1 / l;
      nrm[k + 2] = -dz / l;
    }
  }
  const idx = [];
  for (let i = 0; i < RINGS - 1; i++)
    for (let j = 0; j < SEGS; j++) {
      const a = i * SEGS + j;
      const b = i * SEGS + ((j + 1) % SEGS);
      const c = a + SEGS;
      const d = b + SEGS;
      idx.push(a, b, c, b, d, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: o.noise },
      uTime: o.uTime,
      uWindOff: o.uWindOff,
      uWindDir: { value: o.windDir },
      uSunDir: { value: o.sunDir },
      uLit: { value: o.colors.lit },
      uMid: { value: o.colors.mid },
      uShade: { value: o.colors.shade },
      uHaze: { value: o.colors.haze },
      uFogDen: { value: 0.00021 },
      uShadows: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normal;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform float uTime, uFogDen, uShadows;
      uniform vec2 uWindOff, uWindDir;
      uniform vec3 uSunDir, uLit, uMid, uShade, uHaze;
      varying vec3 vW; varying vec3 vN;
      float tex(vec2 p){ return texture2D(uNoise, p).r; }
      void main(){
        vec3 N = normalize(vN);
        vec2 p = vW.xz;
        float dist = length(cameraPosition - vW);
        // grass catches the light softly, even a little past side-on
        float light = clamp(dot(N, uSunDir) * 0.72 + 0.3, 0.0, 1.0);
        // the shadows of clouds overhead, drifting downwind
        vec2 sp = (p - uWindOff) * 0.0010;
        float cl = tex(sp) * 0.65 + tex(sp * 2.13 + 0.37) * 0.35;
        light *= 1.0 - 0.55 * smoothstep(0.47, 0.58, cl) * uShadows;
        vec3 col = mix(uShade, uMid, smoothstep(0.08, 0.6, light));
        col = mix(col, uLit, smoothstep(0.6, 1.0, light));
        // fields of it greener, or going yellow
        float n1 = tex(p * 0.0021 + 0.11), n2 = tex(p * 0.0085 + 0.53);
        col *= 0.88 + 0.26 * n1;
        col = mix(col, col * vec3(1.14, 1.07, 0.6), smoothstep(0.5, 0.86, n2) * 0.32);
        // blades up close, combed downhill; longer streaks further off
        float fine = 1.0 - smoothstep(25.0, 240.0, dist);
        // two layers at odd angles and scales, so the noise never lines up into a weave
        vec2 q1 = mat2(0.83, -0.56, 0.56, 0.83) * p, q2 = mat2(0.96, 0.28, -0.28, 0.96) * p;
        float g = tex(q1 * vec2(1.37, 0.31)) * 0.55 + tex(q2 * vec2(0.71, 0.173) + 0.31) * 0.45;
        float g2 = tex(q2 * vec2(0.083, 0.027) + 0.2) * 0.6 + tex(q1 * vec2(0.031, 0.012) + 0.6) * 0.4;
        col *= mix(1.0, 0.84 + 0.32 * g, fine) * (0.9 + 0.2 * g2);
        // seen from above, grass shows the dark between its blades; at a glance along it, its sheen
        float ndv = clamp(dot(N, normalize(cameraPosition - vW)), 0.0, 1.0);
        col *= mix(1.0, 0.6, smoothstep(0.2, 0.8, ndv));
        // gusts: bands of wind running downwind, the grass bending over and showing its pale side
        float along = dot(p, uWindDir);
        float wave = sin(along * 0.065 - uTime * 1.25 + tex(p * 0.0045 + vec2(0.0, uTime * 0.003)) * 8.0);
        float gust = smoothstep(0.45, 1.0, wave) * smoothstep(0.4, 0.68, tex((p - uWindOff * 0.7) * 0.0026 + 0.7));
        col = mix(col, uLit * vec3(1.08, 1.12, 0.92), gust * 0.26 * (1.0 - smoothstep(500.0, 1600.0, dist)));
        // the air between here and there
        float fog = 1.0 - exp(-dist * uFogDen);
        col = mix(col, uHaze, fog);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  o.scene.add(mesh);

  return {
    material: mat,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
