// A real PNG, made without a canvas, so the link-card image the fake card
// service hands out can be fetched, decoded and shrunk by the same code a real
// one goes through (src/posting/lib/linkCard.js), in the browser and in tests.
// Uncompressed (stored deflate blocks): bigger than it needs to be, which is
// the point; the composer has to shrink it under the thumbnail limit.

let CRC_TABLE = null;

function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n) => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];

function chunk(type, data) {
  const head = new TextEncoder().encode(type);
  const body = new Uint8Array(head.length + data.length);
  body.set(head);
  body.set(data, head.length);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length));
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

/** zlib with stored (uncompressed) deflate blocks. */
function zlibStore(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = part.length & 255;
    out[o++] = part.length >>> 8;
    out[o++] = ~part.length & 255;
    out[o++] = (~part.length >>> 8) & 255;
    out.set(part, o);
    o += part.length;
  }
  out.set(u32(adler32(raw)), o);
  return out;
}

/**
 * An RGB PNG of `width` × `height`, each pixel from `pixel(x, y)` → [r, g, b].
 * @returns {Uint8Array}
 */
export function encodePng(width, height, pixel) {
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const i = y * stride + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const header = new Uint8Array([...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibStore(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A link card's picture: a sky and two hills, in colours from `seed`. */
export function cardImage(seed, { width = 600, height = 315 } = {}) {
  const hue = seed % 360;
  const rgb = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) =>
      Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return [f(0), f(8), f(4)];
  };
  const sky = rgb(hue, 0.5, 0.82);
  const far = rgb((hue + 30) % 360, 0.3, 0.6);
  const near = rgb((hue + 60) % 360, 0.35, 0.42);
  return encodePng(width, height, (x, y) => {
    const hillFar = height * 0.55 + Math.sin(x / 70 + hue) * height * 0.08;
    const hillNear = height * 0.72 + Math.sin(x / 45 + hue / 2) * height * 0.06;
    if (y > hillNear) return near;
    if (y > hillFar) return far;
    return sky;
  });
}
