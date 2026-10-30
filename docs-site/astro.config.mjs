// @ts-check
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'astro/config';
import sitemap from '@astrojs/sitemap';

const root = path.dirname(fileURLToPath(import.meta.url));

// Standalone docs app. Deploy at kuyfi.vercel.app/docs via rewrites,
// or as this project's root and reverse-proxy /docs → this build.
export default defineConfig({
	site: 'https://kuyfi.vercel.app',
	base: '/docs/',
	integrations: [sitemap()],
	trailingSlash: 'ignore',
	vite: {
		// Keep resolution inside docs-site so the monorepo root tsconfig
		// (extends @sindresorhus/tsconfig) is never loaded during this build.
		cacheDir: path.join(root, 'node_modules/.vite'),
		server: {
			fs: {
				allow: [root],
			},
		},
	},
});
