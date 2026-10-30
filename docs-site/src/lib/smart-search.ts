import {SYNONYMS, type SearchEntry} from '../content/search';

export type ScoredHit = {
	entry: SearchEntry;
	score: number;
	snippet: string;
	matched: string[];
};

function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[_./:-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tokenize(q: string): string[] {
	return normalize(q)
		.split(' ')
		.filter((t) => t.length > 0);
}

/** Expand query tokens with synonym neighbors. */
function expandTokens(tokens: string[]): string[] {
	const out = new Set(tokens);
	for (const t of tokens) {
		const syns = SYNONYMS[t];
		if (syns) syns.forEach((s) => out.add(normalize(s)));
		// also: if any synonym key contains token as value reverse-lookup
		for (const [key, values] of Object.entries(SYNONYMS)) {
			if (values.some((v) => normalize(v) === t || normalize(v).includes(t))) {
				out.add(normalize(key));
				values.forEach((v) => out.add(normalize(v)));
			}
			if (normalize(key) === t || normalize(key).includes(t)) {
				values.forEach((v) => out.add(normalize(v)));
			}
		}
	}
	return [...out];
}

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const row = Array.from({length: b.length + 1}, (_, i) => i);
	for (let i = 0; i < a.length; i++) {
		let prev = i;
		row[0] = i + 1;
		for (let j = 0; j < b.length; j++) {
			const tmp = row[j + 1];
			const cost = a[i] === b[j] ? 0 : 1;
			row[j + 1] = Math.min(row[j + 1] + 1, row[j] + 1, prev + cost);
			prev = tmp;
		}
	}
	return row[b.length];
}

function fuzzyHit(token: string, word: string): number {
	if (!token || !word) return 0;
	if (word === token) return 1;
	if (word.startsWith(token)) return 0.85;
	if (word.includes(token)) return 0.55;
	if (token.length >= 4 && word.length >= 4) {
		const d = levenshtein(token, word);
		const maxLen = Math.max(token.length, word.length);
		if (d <= 1) return 0.7;
		if (d === 2 && maxLen >= 6) return 0.45;
	}
	return 0;
}

function fieldScore(token: string, field: string, weight: number): {s: number; matched?: string} {
	const n = normalize(field);
	if (!n) return {s: 0};
	if (n === token) return {s: weight * 1.2, matched: token};
	if (n.startsWith(token)) return {s: weight, matched: token};
	if (n.includes(token)) return {s: weight * 0.7, matched: token};
	const words = n.split(' ');
	let best = 0;
	for (const w of words) {
		best = Math.max(best, fuzzyHit(token, w));
	}
	if (best > 0) return {s: weight * best * 0.6, matched: token};
	return {s: 0};
}

function makeSnippet(entry: SearchEntry, tokens: string[]): string {
	const text = `${entry.blurb} ${entry.body}`;
	const lower = text.toLowerCase();
	let idx = -1;
	for (const t of tokens) {
		idx = lower.indexOf(t);
		if (idx >= 0) break;
	}
	if (idx < 0) {
		return entry.blurb.slice(0, 120);
	}
	const start = Math.max(0, idx - 36);
	const end = Math.min(text.length, idx + 80);
	let snip = text.slice(start, end).trim();
	if (start > 0) snip = `…${snip}`;
	if (end < text.length) snip = `${snip}…`;
	return snip;
}

/**
 * Rank docs entries for a free-text query.
 * Empty query → curated “browse” order (weight desc).
 */
export function searchDocs(
	entries: SearchEntry[],
	query: string,
	limit = 10,
): ScoredHit[] {
	const rawTokens = tokenize(query);
	if (rawTokens.length === 0) {
		return [...entries]
			.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))
			.slice(0, limit)
			.map((entry) => ({
				entry,
				score: entry.weight ?? 1,
				snippet: entry.blurb,
				matched: [],
			}));
	}

	const tokens = expandTokens(rawTokens);
	const hits: ScoredHit[] = [];

	for (const entry of entries) {
		let score = 0;
		const matched = new Set<string>();
		const kw = entry.keywords.join(' ');

		for (const token of tokens) {
			const parts = [
				fieldScore(token, entry.title, 14),
				fieldScore(token, entry.group, 3),
				fieldScore(token, entry.blurb, 6),
				fieldScore(token, kw, 8),
				fieldScore(token, entry.body, 4),
				fieldScore(token, entry.id, 5),
			];
			for (const p of parts) {
				if (p.s > 0) {
					score += p.s;
					if (p.matched) matched.add(p.matched);
				}
			}
		}

		// Require at least one raw (non-expanded-only) token to contribute meaningfully
		let rawCoverage = 0;
		for (const t of rawTokens) {
			const blob = normalize(
				`${entry.title} ${entry.blurb} ${kw} ${entry.body} ${entry.group}`,
			);
			if (
				blob.includes(t) ||
				blob.split(' ').some((w) => fuzzyHit(t, w) >= 0.7)
			) {
				rawCoverage += 1;
			}
		}
		// synonym-only soft hits still allowed but discounted
		if (rawCoverage === 0) score *= 0.35;
		else score *= 1 + (rawCoverage / rawTokens.length) * 0.25;

		score *= entry.weight ?? 1;

		if (score > 1.5) {
			hits.push({
				entry,
				score,
				snippet: makeSnippet(entry, rawTokens),
				matched: [...matched],
			});
		}
	}

	hits.sort((a, b) => b.score - a.score);
	return hits.slice(0, limit);
}

export function highlight(text: string, matched: string[]): string {
	if (!matched.length) return escapeHtml(text);
	let out = escapeHtml(text);
	const uniq = [...new Set(matched.map(normalize))].filter((t) => t.length >= 2);
	for (const t of uniq) {
		const re = new RegExp(`(${escapeRegExp(t)})`, 'ig');
		out = out.replace(re, '<mark>$1</mark>');
	}
	return out;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveHref(entry: SearchEntry, baseJoin: (path: string) => string): string {
	const path = baseJoin(entry.href);
	return entry.hash ? `${path}#${entry.hash}` : path;
}
