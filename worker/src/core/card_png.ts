import {initWasm, Resvg} from '@resvg/resvg-wasm';

let ready: Promise<void> | null = null;

export interface CardRenderDeps {
	/** resvg wasm as a compiled WebAssembly.Module (Workers) or raw bytes (Node tests). */
	wasm: WebAssembly.Module | ArrayBuffer | Uint8Array;
	fonts: Uint8Array[];
}

/** SVG -> PNG with resvg-wasm. Initializes the wasm once per isolate. No WebAssembly.compile. */
export async function renderPng(svg: string, deps: CardRenderDeps): Promise<Uint8Array> {
	ready ??= initWasm(deps.wasm as never);
	await ready;
	const resvg = new Resvg(svg, {
		font: {fontBuffers: deps.fonts, defaultFontFamily: 'IBM Plex Mono', loadSystemFonts: false},
		fitTo: {mode: 'original'},
	});
	return resvg.render().asPng();
}
