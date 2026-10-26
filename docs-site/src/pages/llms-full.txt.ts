import type {APIRoute} from 'astro';
import raw from '../content/llms-full.txt?raw';
import {SITE} from '../content/nav';

// Generated at build time so every link follows the configured site (DOCS_SITE).
export const GET: APIRoute = () =>
	new Response(raw.replaceAll('https://kuyfi.vercel.app', SITE.url), {
		headers: {'Content-Type': 'text/plain; charset=utf-8'},
	});
