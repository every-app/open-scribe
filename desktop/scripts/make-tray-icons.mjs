// Draws the tray icons (16 pt, @1x and @2x) as PNGs into resources/tray. Run once; the output is
// committed. idle = a waveform (template image, follows the menu bar's color), recording = a red
// dot, attention = the waveform with an orange dot.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// Coordinates in points (0–16); s = pixels per point.
const bars = [[3, 4], [5.5, 8], [8, 11], [10.5, 7], [13, 4]]; // [centerX, height]
const wave = (x, y) => {
  let a = 0;
  for (const [cx, h] of bars) {
    const dx = Math.abs(x - cx) - 0.75, dy = Math.abs(y - 8) - h / 2;
    const d = Math.max(dx, dy);
    a = Math.max(a, Math.min(1, Math.max(0, 0.5 - d * 2)));
  }
  return a;
};
const dot = (x, y, cx, cy, r) => Math.min(1, Math.max(0, (r - Math.hypot(x - cx, y - cy)) * 2 + 0.5));
const icons = {
  idleTemplate: (x, y) => [0, 0, 0, wave(x, y)],
  recording: (x, y) => [235, 64, 52, dot(x, y, 8, 8, 5)],
  attention: (x, y) => {
    const d = dot(x, y, 13, 3.5, 3);
    const w = wave(x, y) * (1 - Math.min(1, dot(x, y, 13, 3.5, 4.2)));
    return d > 0.01 ? [245, 158, 11, d] : [110, 110, 110, w];
  },
};
const dir = join(import.meta.dirname, "..", "resources", "tray");
mkdirSync(dir, { recursive: true });
for (const [name, fn] of Object.entries(icons)) {
  for (const scale of [1, 2]) {
    const size = 16 * scale;
    writeFileSync(join(dir, `${name}${scale === 2 ? "@2x" : ""}.png`), png(size, (px, py) => fn(px / scale, py / scale)));
  }
}
console.log("wrote", dir);
