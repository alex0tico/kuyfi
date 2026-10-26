/**
 * Report card: a pure summary + SVG builder for a stored scan or fuzz report.
 * Everything shown comes from the report; nothing is estimated or rounded.
 * The logo file is not bundled: when it is missing the card uses a text
 * wordmark (see LOGO_SVG in card_brand.ts).
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const INK = '#0E1113';
const GOLD = '#EBB700';
const PURPLE = '#8E2F87';
const TEXT = '#E8E6E0';
const MUTED = '#A19F97';
const PANEL = '#161A1E';
const FONT = 'IBM Plex Mono';

export const DISCLAIMER = 'Bounded black-box simulation on Testnet. Not a security guarantee.';

export interface CardFinding {
	id: string;
	severity: string;
	status: string;
	functionName: string;
	vectorName: string;
}

export interface CardModel {
	kind: 'scan' | 'fuzz';
	title: string;
	network: 'testnet';
	mode: string;
	contract: string;
	date: string;
	reportId: string;
	verdict: string;
	stats: Array<{label: string; value: string; accent?: boolean}>;
	findings: CardFinding[];
	moreFindings: number;
	notEvaluated: string;
	functionsLine?: string;
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function abbreviateContract(id: string): string {
	return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id;
}

/** "2026-10-26T02:17:33.000Z" -> "2026-10-26 02:17 UTC" */
export function formatDate(iso: string): string {
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
	return m ? `${m[1]} ${m[2]} UTC` : iso;
}

const thousands = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Builds the card model from a stored report. Throws on an unknown shape. */
export function buildCardModel(report: unknown): CardModel {
	if (!isObj(report)) throw new Error('Unsupported report.');
	const base = {
		network: 'testnet' as const,
		contract: abbreviateContract(str(report.target?.contractId)),
		date: formatDate(str(report.generatedAt)),
		reportId: str(report.reportId),
	};

	if (report.kind === 'fuzz') {
		const s = report.summary ?? {};
		const by = s.byStatus ?? {};
		const e = report.execution ?? {};
		const findings: CardFinding[] = (Array.isArray(report.findings) ? report.findings : []).map((f: any) => ({
			id: str(f.id),
			severity: str(f.severity),
			status: str(f.status),
			functionName: str(f.functionName),
			vectorName: str(f.vectorName),
		}));
		const total = num(s.totalFindings);
		const verdict =
			total === 0
				? 'no findings in this run'
				: `${total} finding(s): ${num(by.supported)} supported · ${num(by.hypothesis)} hypothesis · ${num(by.inconclusive)} inconclusive`;
		const notRunSeq = Array.isArray(report.coverage?.notRun) && report.coverage.notRun.length > 0;
		const parts = [];
		if (num(s.notEvaluated) > 0) parts.push(`authorization checks (${num(s.notEvaluated)} vectors)`);
		if (notRunSeq) parts.push('stateful call sequences');
		return {
			...base,
			kind: 'fuzz',
			title: 'FUZZ REPORT',
			mode: str(report.mode) === 'simulate' ? 'simulation' : str(report.mode),
			verdict,
			stats: [
				{label: 'EXECUTED', value: `${num(e.vectorsExecuted)} of ${num(e.vectorsGenerated)}`},
				{label: 'SUPPORTED', value: String(num(by.supported)), accent: num(by.supported) > 0},
				{label: 'HYPOTHESIS', value: String(num(by.hypothesis)), accent: num(by.hypothesis) > 0},
				{label: 'INCONCLUSIVE', value: String(num(by.inconclusive)), accent: num(by.inconclusive) > 0},
				{label: 'NO FINDING', value: String(num(s.noFinding))},
				{label: 'NOT EVALUATED', value: String(num(s.notEvaluated))},
			],
			findings: findings.slice(0, 3),
			moreFindings: Math.max(0, findings.length - 3),
			notEvaluated: parts.length > 0 ? `Not evaluated: ${parts.join(' · ')}` : 'Not evaluated: nothing was flagged as skipped in this run',
		};
	}

	if (report.kind === 'scan') {
		const sc = report.scan ?? {};
		const fns = num(sc.totalFunctions);
		const udts = Array.isArray(sc.udts) ? sc.udts.length : 0;
		return {
			...base,
			kind: 'scan',
			title: 'SCAN REPORT',
			mode: 'read-only',
			verdict: `Attack surface: ${fns} function(s), ${udts} user-defined type(s)`,
			stats: [
				{label: 'FUNCTIONS', value: String(fns)},
				{label: 'TYPES', value: String(udts)},
				{label: 'BYTECODE', value: `${thousands(num(report.target?.bytecodeSize))} bytes`},
			],
			findings: [],
			moreFindings: 0,
			notEvaluated: 'Not run: no attack vectors were executed; this report lists the surface only',
		};
	}

	throw new Error('Unsupported report kind.');
}

/** Plain-text twin of the card, for clients that do not show images. */
export function cardText(m: CardModel): string {
	const lines = [
		`KUYFI · BEFORE THE BREACH`,
		`${m.title} · ${m.network} · ${m.mode}`,
		`contract ${m.contract} · ${m.date} · ${m.reportId}`,
		``,
		m.verdict,
		m.stats.map((s) => `${s.label}: ${s.value}`).join(' | '),
	];
	if (m.kind === 'fuzz') {
		lines.push('', m.findings.length === 0 ? 'Findings: none' : 'Findings:');
		for (const f of m.findings) lines.push(`- ${f.id} · ${f.severity} · ${f.status} · ${f.functionName} · ${f.vectorName}`);
		if (m.moreFindings > 0) lines.push(`+${m.moreFindings} more`);
	}

	lines.push('', m.notEvaluated, DISCLAIMER);
	return lines.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fit = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`);

const text = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
	`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${extra}>${esc(body)}</text>`;

export interface CardBrand {
	/** Official logo SVG markup (a complete <svg> element), or null to use the text wordmark. */
	logoSvg: string | null;
}

/** Pure: report model -> SVG string (1200x630). */
export function buildCardSvg(m: CardModel, brand: CardBrand = {logoSvg: null}): string {
	const out: string[] = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`);
	out.push(`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${INK}"/>`);
	out.push(`<rect x="12" y="12" width="${CARD_WIDTH - 24}" height="${CARD_HEIGHT - 24}" rx="10" fill="none" stroke="${PURPLE}" stroke-opacity="0.55" stroke-width="2"/>`);

	// Header: logo (or wordmark) + tagline on the left, report chips on the right.
	if (brand.logoSvg) {
		out.push(`<svg x="48" y="34" width="72" height="72" viewBox="0 0 1080 1080">${brand.logoSvg}</svg>`);
		out.push(text(136, 78, 22, GOLD, 'BEFORE THE BREACH', 'letter-spacing="5"'));
	} else {
		out.push(text(48, 88, 64, TEXT, 'KUYFI', 'font-weight="500" letter-spacing="6"'));
		out.push(text(300, 82, 22, GOLD, 'BEFORE THE BREACH', 'letter-spacing="5"'));
	}

	let cx = CARD_WIDTH - 48;
	for (const chip of [m.mode.toUpperCase(), m.network.toUpperCase(), m.title]) {
		const w = chip.length * 13.2 + 28;
		cx -= w;
		const gold = chip === m.title;
		out.push(`<rect x="${cx}" y="50" width="${w}" height="38" rx="6" fill="${gold ? GOLD : 'none'}" stroke="${gold ? GOLD : PURPLE}" stroke-width="2"/>`);
		out.push(text(cx + w / 2, 75, 20, gold ? INK : TEXT, chip, 'text-anchor="middle" font-weight="500"'));
		cx -= 12;
	}

	// Meta row.
	out.push(`<line x1="48" y1="128" x2="${CARD_WIDTH - 48}" y2="128" stroke="${PURPLE}" stroke-opacity="0.5"/>`);
	out.push(text(48, 164, 20, MUTED, `contract ${m.contract}   ·   ${m.date}   ·   ${m.reportId}`));

	// Verdict.
	const verdictSize = Math.max(20, Math.min(34, Math.floor(1104 / (0.6 * m.verdict.length))));
	out.push(text(48, 226, verdictSize, GOLD, m.verdict, 'font-weight="500"'));

	// Stat boxes.
	const n = m.stats.length;
	const gap = 14;
	const boxW = (CARD_WIDTH - 96 - gap * (n - 1)) / n;
	m.stats.forEach((s, i) => {
		const x = 48 + i * (boxW + gap);
		out.push(`<rect x="${x}" y="256" width="${boxW}" height="92" rx="8" fill="${PANEL}" stroke="${s.accent ? GOLD : '#2A313A'}" stroke-width="2"/>`);
		out.push(text(x + 16, 286, 15, MUTED, s.label, 'letter-spacing="2"'));
		const size = Math.min(38, Math.floor((boxW - 32) / (0.6 * s.value.length)));
		out.push(text(x + 16, 331, size, s.accent ? GOLD : TEXT, s.value, 'font-weight="500"'));
	});

	// Findings (fuzz only).
	let y = 392;
	if (m.kind === 'fuzz') {
		if (m.findings.length === 0) {
			out.push(text(48, y, 20, MUTED, 'Findings: none in this run'));
		} else {
			out.push(text(48, y, 15, MUTED, 'FINDINGS', 'letter-spacing="2"'));
			for (const f of m.findings) {
				y += 30;
				out.push(text(48, y, 19, TEXT, fit(`${f.id} · ${f.severity} · ${f.status} · ${f.functionName} · ${f.vectorName}`, 88)));
			}

			if (m.moreFindings > 0) {
				y += 30;
				out.push(text(48, y, 19, GOLD, `+${m.moreFindings} more`));
			}
		}
	}

	// Footer: what was not evaluated + disclaimer.
	out.push(`<line x1="48" y1="540" x2="${CARD_WIDTH - 48}" y2="540" stroke="${PURPLE}" stroke-opacity="0.5"/>`);
	out.push(text(48, 574, 18, TEXT, fit(m.notEvaluated, 96)));
	out.push(text(48, 602, 17, MUTED, DISCLAIMER));
	out.push('</svg>');
	return out.join('\n');
}
