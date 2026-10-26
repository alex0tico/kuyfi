// Worker-only wiring: the wasm and font files are imported as bundled modules.
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import plex400 from './assets/fonts/IBMPlexMono-400.ttf';
import plex500 from './assets/fonts/IBMPlexMono-500.ttf';
import {renderPng as render} from './core/card_png.js';

export const renderCardPng = (svg: string) =>
	render(svg, {wasm: resvgWasm, fonts: [new Uint8Array(plex400), new Uint8Array(plex500)]});
