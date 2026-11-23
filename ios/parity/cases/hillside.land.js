// The land under the sky: its height field and the mesh createLand builds
// (positions, normals and the triangle list, sampled).
// Swift: VirgaCore/Hillside/HillsideLand.swift.

import * as THREE from 'three';
import { createLand, height } from '../../../src/hillside/land.js';
import { each } from './_helpers.js';

export const sources = ['src/hillside/land.js'];

const XS = [-6000, -1700, -430, -90, 0, 1, 37.5, 300, 430, 1500, 2800, 8999];
const ZS = [-9000, -5600, -3400, -2900, -780, -430, -1, 0, 12.25, 900, 6000];

function builtMesh() {
  let mesh = null;
  const v3 = () => new THREE.Vector3();
  createLand({
    scene: { add: (m) => (mesh = m) },
    noise: null,
    uTime: { value: 0 },
    uWindOff: { value: new THREE.Vector2() },
    windDir: new THREE.Vector2(1, 0),
    sunDir: v3(),
    colors: {
      lit: new THREE.Color(),
      mid: new THREE.Color(),
      shade: new THREE.Color(),
      haze: new THREE.Color(),
    },
  });
  return mesh.geometry;
}

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'height',
      XS.flatMap((x) => ZS.map((z) => ({ x, z }))),
      ({ x, z }) => height(x, z),
    )),
  );
  const geo = builtMesh();
  const pos = geo.getAttribute('position').array;
  const nrm = geo.getAttribute('normal').array;
  const idx = geo.getIndex().array;
  const VERTS = [0, 1, 319, 320, 321, 5000, 12345, 30000, 47999, 60000, 60799];
  out.push(
    ...(await each('mesh', [{ rings: 190, segs: 320 }], () => ({
      vertexCount: pos.length / 3,
      indexCount: idx.length,
      vertices: VERTS.map((v) => ({
        v,
        position: [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]],
        normal: [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]],
      })),
      triangles: [0, 1, 319, 320, 9000, 60000, 60479].map((t) => [
        idx[t * 3],
        idx[t * 3 + 1],
        idx[t * 3 + 2],
      ]),
    }))),
  );
  return out;
}
