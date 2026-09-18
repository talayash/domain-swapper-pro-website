/**
 * Renders the Domain Swapper Pro mark (A8 "Seam") to PNG at every size the
 * Chrome manifest and the site need. No dependencies: PNGs are encoded here
 * with node:zlib.
 *
 *   node scripts/generate-icons.mjs
 *
 * 16 and 32 are hand-hinted pixel grids — a diagonal cannot be scaled down
 * cleanly, and the 6-unit seam between the two bars would close up. Larger
 * sizes are rasterised from the same geometry as icon.svg with 4x4
 * supersampling.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const TILE = [0x0e, 0x11, 0x14];
const INK = [0xf2, 0xf6, 0xfa];
const SIGNAL = [0x2f, 0xe0, 0x8f];

/** icon.svg geometry, on the 128 unit grid. */
const BARS = [
  { fill: INK, points: [[46, 26], [72, 26], [50, 102], [24, 102]] },
  { fill: SIGNAL, points: [[78, 26], [104, 26], [82, 102], [56, 102]] },
];

/**
 * Hinted grids: [x, y, width, height] runs, in device pixels.
 * Four steps of three rows at 16; eight steps of three rows at 32.
 */
const HINTED = {
  16: [
    { fill: INK, runs: [[6, 2, 4, 3], [5, 5, 4, 3], [4, 8, 4, 3], [3, 11, 4, 3]] },
    { fill: SIGNAL, runs: [[11, 2, 4, 3], [10, 5, 4, 3], [9, 8, 4, 3], [8, 11, 4, 3]] },
  ],
  32: [
    {
      fill: INK,
      runs: [
        [10, 4, 8, 3], [9, 7, 8, 3], [8, 10, 8, 3], [7, 13, 8, 3],
        [6, 16, 8, 3], [5, 19, 8, 3], [4, 22, 8, 3], [3, 25, 8, 3],
      ],
    },
    {
      fill: SIGNAL,
      runs: [
        [20, 4, 8, 3], [19, 7, 8, 3], [18, 10, 8, 3], [17, 13, 8, 3],
        [16, 16, 8, 3], [15, 19, 8, 3], [14, 22, 8, 3], [13, 25, 8, 3],
      ],
    },
  ],
};

function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function blend(base, over, coverage) {
  return base.map((c, i) => Math.round(c * (1 - coverage) + over[i] * coverage));
}

function renderSized(size) {
  const pixels = new Uint8Array(size * size * 4);
  const put = (x, y, rgb) => {
    const o = (y * size + x) * 4;
    pixels[o] = rgb[0];
    pixels[o + 1] = rgb[1];
    pixels[o + 2] = rgb[2];
    pixels[o + 3] = 255;
  };

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, TILE);

  if (HINTED[size]) {
    for (const { fill, runs } of HINTED[size]) {
      for (const [rx, ry, rw, rh] of runs) {
        for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) put(x, y, fill);
      }
    }
    return pixels;
  }

  const scale = 128 / size;
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let colour = TILE;
      for (const bar of BARS) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const ux = (x + (sx + 0.5) / SS) * scale;
            const uy = (y + (sy + 0.5) / SS) * scale;
            if (insidePolygon(bar.points, ux, uy)) hits++;
          }
        }
        if (hits) colour = blend(colour, bar.fill, hits / (SS * SS));
      }
      put(x, y, colour);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(pixels, width, height) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = encodePng(renderSized(size), size, size);
  writeFileSync(join(OUT_DIR, `icon-${size}.png`), png);
  if (size === 128) writeFileSync(join(OUT_DIR, 'icon.png'), png);
  console.log(`icon-${size}.png  ${png.length} bytes`);
}
