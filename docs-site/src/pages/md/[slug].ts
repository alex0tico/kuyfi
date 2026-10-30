import type {APIRoute} from 'astro';
import {
	getDocMarkdown,
	listDocMarkdown,
	renderDocMarkdownFile,
} from '../../lib/doc-markdown';

export const prerender = true;

export function getStaticPaths() {
	return listDocMarkdown().map((doc) => ({
		params: {slug: `${doc.slug}.md`},
	}));
}

export const GET: APIRoute = ({params}) => {
	const raw = params.slug ?? '';
	const slug = raw.replace(/\.md$/i, '');
	const doc = getDocMarkdown(slug);
	if (!doc) {
		return new Response('Not found\n', {
			status: 404,
			headers: {'Content-Type': 'text/plain; charset=utf-8'},
		});
	}

	const body = renderDocMarkdownFile(doc);
	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Cache-Control': 'public, max-age=300',
			'X-Robots-Tag': 'noindex',
			'X-Markdown-Format': 'markdown-for-agents',
			'X-Not-MDX': 'true',
		},
	});
};
