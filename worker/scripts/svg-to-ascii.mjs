// Experiment: rasterize the Kuyfi logo SVG and turn it into ASCII art, three ways.
//   node scripts/svg-to-ascii.mjs [path/to/logo.svg]
// Writes public/ascii-lab/{ramp,blocks,braille}-{60,100}.txt and public/ascii-lab/preview.html.
import {mkdirSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Resvg} from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = process.argv[2] ?? join(here, 'logo/kuyfi-fox-white-on-black.svg');
const outDir = join(here, '../public/ascii-lab');
const WIDTHS = [60, 100, 140, 180];
// Preview only: braille and half blocks (no ramp), each width at its own font size.
const PREVIEW = [[100, 4], [140, 5], [180, 6]];
const RAMP = ' .:-=+*#%@';
const RENDER_WIDTH = 2400; // high-res raster; cells average over it

// 1. Rasterize and read the luminance (white logo on black = 1 where there is ink).
const svg = readFileSync(svgPath);
const image = new Resvg(svg, {fitTo: {mode: 'width', value: RENDER_WIDTH}, background: 'black'}).render();
const {width: W, height: H} = image;
const px = image.pixels;
const lum = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;

// 2. Crop to the logo's bounding box so the shape fills the columns.
let x0 = W, y0 = H, x1 = -1, y1 = -1;
for (let y = 0; y < H; y++) {
	for (let x = 0; x < W; x++) {
		if (lum[y * W + x] > 0.25) {
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	}
}

const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;

/** Area-average coverage of the cropped logo on a gx × gy grid of equal cells. */
function grid(gx, gy) {
	const out = new Float32Array(gx * gy);
	for (let j = 0; j < gy; j++) {
		const ya = y0 + Math.floor((j * ch) / gy);
		const yb = y0 + Math.max(Math.floor(((j + 1) * ch) / gy), Math.floor((j * ch) / gy) + 1);
		for (let i = 0; i < gx; i++) {
			const xa = x0 + Math.floor((i * cw) / gx);
			const xb = x0 + Math.max(Math.floor(((i + 1) * cw) / gx), Math.floor((i * cw) / gx) + 1);
			let sum = 0;
			let n = 0;
			for (let y = ya; y < yb; y++) {
				for (let x = xa; x < xb; x++) {
					sum += lum[y * W + x];
					n++;
				}
			}

			out[j * gx + i] = sum / n;
		}
	}

	return out;
}

// A character cell is about twice as tall as wide, so square samples need
// rows = columns * (h / w) / 2 for one sample per character.
const aspect = ch / cw;
const trim = lines => lines.map(l => l.replace(/[ ⠀]+$/u, '')).join('\n');

function ramp(cols) {
	const rows = Math.max(1, Math.round((cols * aspect) / 2));
	const g = grid(cols, rows);
	const lines = [];
	for (let j = 0; j < rows; j++) {
		let s = '';
		for (let i = 0; i < cols; i++) s += RAMP[Math.min(RAMP.length - 1, Math.round(g[j * cols + i] * (RAMP.length - 1)))];
		lines.push(s);
	}

	return trim(lines);
}

function blocks(cols) {
	const rows = Math.max(1, Math.round((cols * aspect) / 2)); // character rows
	const g = grid(cols, rows * 2); // two square samples per character
	const lines = [];
	for (let j = 0; j < rows; j++) {
		let s = '';
		for (let i = 0; i < cols; i++) {
			const top = g[2 * j * cols + i] >= 0.5;
			const bottom = g[(2 * j + 1) * cols + i] >= 0.5;
			s += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
		}

		lines.push(s);
	}

	return trim(lines);
}

// Braille dot bits for (column, row) inside a 2 × 4 cell.
const DOT = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];
function braille(cols) {
	const rows = Math.max(1, Math.round((cols * aspect) / 2));
	const g = grid(cols * 2, rows * 4);
	const lines = [];
	for (let j = 0; j < rows; j++) {
		let s = '';
		for (let i = 0; i < cols; i++) {
			let bits = 0;
			for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 4; dy++) if (g[(4 * j + dy) * cols * 2 + 2 * i + dx] >= 0.5) bits |= DOT[dx][dy];
			s += String.fromCodePoint(0x2800 + bits);
		}

		lines.push(s);
	}

	return trim(lines);
}

const variants = [
	['ramp', 'Density ramp  " .:-=+*#%@"', ramp],
	['blocks', 'Half blocks  ▀ ▄ █', blocks],
	['braille', 'Braille  ⠀ … ⣿', braille],
];

mkdirSync(outDir, {recursive: true});
copyFileSync(svgPath, join(outDir, 'logo.svg'));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cards = [];
for (const [key, title, fn] of variants) {
	// The density ramp stays at the original two widths; braille and blocks also get 140 and 180.
	for (const cols of key === 'ramp' ? [60, 100] : WIDTHS) {
		const text = fn(cols);
		writeFileSync(join(outDir, `${key}-${cols}.txt`), text + '\n');
		const size = PREVIEW.find(([c]) => c === cols);
		if (key !== 'ramp' && size) {
			cards.push(`<section><h2>${esc(title)} · ${cols} col · ${size[1]}px</h2><pre style="font-size:${size[1]}px">${esc(text)}</pre></section>`);
		}
	}
}

writeFileSync(
	join(outDir, 'preview.html'),
	`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ASCII lab</title>
<style>
body{margin:0;padding:2rem 1rem;background:#0E1113;color:#EBB700;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
h1,h2{font-weight:500;font-size:.9rem;margin:0 0 .75rem;color:#EBB700}
.grid{display:grid;grid-template-columns:repeat(3,max-content);gap:2.5rem 3rem;align-items:start}
section{overflow-x:auto}
pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono",monospace;line-height:1;white-space:pre}
img{display:block;width:240px;height:240px;background:#0E1113}
.orig{margin-bottom:2.5rem}
</style></head><body>
<div class="orig"><h1>Original (SVG)</h1><img src="logo.svg" alt="Kuyfi logo, original SVG"></div>
<div class="grid">
${cards.join('\n')}
</div>
</body></html>
`,
);

console.log(`logo ${cw}x${ch}px (aspect ${aspect.toFixed(3)}); wrote ${variants.length * WIDTHS.length} text files and preview.html to ${outDir}`);
