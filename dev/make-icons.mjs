// Dev-only: renders the app icon SVG into the PNGs the manifest and iOS need.
//   cd dev && npm install && node make-icons.mjs
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const PINE = '#1F3B2D';
const CREAM = '#F3EAD7';
const RED = '#C8402F';

// A dinner plate set for tonight: fork, plate with a rim, knife, and one small red dot.
function mark({ scale = 1 } = {}) {
  const t = (x, y) => [256 + (x - 256) * scale, 256 + (y - 256) * scale];
  const P = (pts) => pts.map(([x, y]) => t(x, y).map((v) => v.toFixed(1)).join(' '));
  const [cx, cy] = t(256, 256);
  const fork = `<g fill="${CREAM}">${[66, 81, 96].map((x) => { const [a, b] = t(x, 132); return `<rect x="${a.toFixed(1)}" y="${b.toFixed(1)}" width="${(9 * scale).toFixed(1)}" height="${(80 * scale).toFixed(1)}" rx="${(4.5 * scale).toFixed(1)}"/>`; }).join('')}
    <path d="M ${P([[66, 200]])} L ${P([[105, 200]])} C ${P([[105, 236], [96, 246], [92, 250]])} L ${P([[92, 384]])} A ${(7 * scale).toFixed(1)} ${(7 * scale).toFixed(1)} 0 0 1 ${P([[78, 384]])} L ${P([[78, 250]])} C ${P([[74, 246], [66, 236], [66, 200]])} Z"/></g>`;
  const knife = `<path fill="${CREAM}" d="M ${P([[424, 128]])} C ${P([[452, 150], [458, 222], [446, 262]])} L ${P([[436, 264]])} L ${P([[436, 384]])} A ${(7 * scale).toFixed(1)} ${(7 * scale).toFixed(1)} 0 0 1 ${P([[422, 384]])} L ${P([[422, 136]])} C ${P([[422, 131], [423, 128], [424, 128]])} Z"/>`;
  return `${fork}${knife}<circle cx="${cx}" cy="${cy}" r="${(132 * scale).toFixed(1)}" fill="${CREAM}"/><circle cx="${cx}" cy="${cy}" r="${(94 * scale).toFixed(1)}" fill="none" stroke="${PINE}" stroke-opacity="0.22" stroke-width="${(7 * scale).toFixed(1)}"/><circle cx="${cx}" cy="${cy}" r="${(17 * scale).toFixed(1)}" fill="${RED}"/>`;
}

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="${PINE}"/>${mark()}</svg>`;
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${PINE}"/>${mark()}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${PINE}"/>${mark({ scale: 0.78 })}</svg>`;
const bare = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${mark()}</svg>`;

writeFileSync(path.join(OUT, 'icon.svg'), rounded + '\n');
writeFileSync(path.join(OUT, 'mark.svg'), bare + '\n');
const jobs = [
  [square, 180, 'apple-touch-icon.png'],
  [rounded, 192, 'icon-192.png'],
  [rounded, 512, 'icon-512.png'],
  [maskable, 192, 'icon-maskable-192.png'],
  [maskable, 512, 'icon-maskable-512.png'],
  [rounded, 32, 'favicon-32.png'],
];
for (const [svg, size, name] of jobs) {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log('wrote', name);
}
