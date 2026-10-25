import {ToolError} from './guards.js';

const REPORT_TTL_SECONDS = 24 * 60 * 60;

interface StoredReport<T> {
	owner: string;
	createdAt: string;
	report: T;
}

/** Reports live in KV for 24 h and can only be read by the GitHub login that created them. */
export async function saveReport<T extends {reportId: string}>(
	kv: KVNamespace,
	owner: string,
	report: T,
): Promise<void> {
	const value: StoredReport<T> = {owner, createdAt: new Date().toISOString(), report};
	await kv.put(`report:${report.reportId}`, JSON.stringify(value), {
		expirationTtl: REPORT_TTL_SECONDS,
	});
}

export async function loadReport(
	kv: KVNamespace,
	owner: string,
	reportId: string,
): Promise<unknown> {
	if (!/^kyf-\d{8}T\d{6}Z-[0-9a-f]{8,32}$/.test(reportId)) {
		throw new ToolError('Invalid report_id format.');
	}

	const raw = await kv.get(`report:${reportId}`);
	const stored = raw ? (JSON.parse(raw) as StoredReport<unknown>) : null;
	// Same answer for "missing", "expired" and "someone else's": do not reveal which.
	if (!stored || stored.owner !== owner) {
		throw new ToolError('Report not found. Reports expire after 24 hours and are only visible to the user who created them.');
	}

	return stored.report;
}

/**
 * Best-effort per-user hourly counter. KV is eventually consistent and has no
 * atomic increment, so a burst of parallel calls can slip a few extra through.
 */
export async function consumeQuota(
	kv: KVNamespace,
	owner: string,
	bucket: 'fuzz' | 'scan',
	limit: number,
	now: Date = new Date(),
): Promise<{used: number; limit: number}> {
	const hour = now.toISOString().slice(0, 13);
	const key = `rl:${bucket}:${owner}:${hour}`;
	const used = Number((await kv.get(key)) ?? '0');
	if (used >= limit) {
		const minutes = 60 - now.getUTCMinutes();
		throw new ToolError(
			`Rate limit reached: ${limit} ${bucket} calls per hour per user. Try again in about ${minutes} minute(s).`,
		);
	}

	await kv.put(key, String(used + 1), {expirationTtl: 2 * 60 * 60});
	return {used: used + 1, limit};
}

export function newReportId(now: Date = new Date()): string {
	const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
	return `kyf-${stamp}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
