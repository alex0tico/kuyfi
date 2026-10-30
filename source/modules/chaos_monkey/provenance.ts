import type {xdr} from '@stellar/stellar-sdk';

/**
 * Where an input value comes from. `test_data` is generated placeholder data
 * (e.g. a random address); `seeded` says whether a seed made it reproducible
 * (no seed exists yet, so it is always false until the D3 seed lands).
 */
export type InputSource =
	'spec' | 'type_boundary' | 'configured_context' | 'test_data';

/** Provenance of ONE generated argument of ONE invocation. */
export interface InputProvenance {
	param: string;
	/** The generating rule, e.g. `baseline`, `attack:MAX_U32`, `baseline:context`. */
	rule: string;
	source: InputSource;
	/** Config key (e.g. `roles.admin`) when the value came from configuration. */
	configKey?: string;
	seeded: boolean;
	/**
	 * Present only for COMPOSITE parameters (struct, union, Vec, Map, Option,
	 * Tuple, Result): the distinct sources of their leaves. One entry covers the
	 * whole parameter; `source` is `test_data` when ANY leaf is generated test
	 * data (e.g. a random Address nested in a struct), so a composite is never
	 * labelled `spec` while carrying random values.
	 */
	nested?: InputSource[];
}

export interface ProvenanceCoverage {
	invocations: number;
	invocationsWithProvenance: number;
	/** Invocations with no provenance, or fewer entries than arguments. */
	missing: Array<{functionName: string; vectorName: string}>;
}

interface Traceable {
	target: {functionName: string; params: unknown[]};
	vectorName: string;
	inputs?: InputProvenance[];
}

/**
 * Automatic check: every invocation must carry one provenance entry per
 * parameter. Reports gaps instead of assuming coverage.
 */
export function provenanceCoverage(results: Traceable[]): ProvenanceCoverage {
	const missing: ProvenanceCoverage['missing'] = [];
	for (const r of results) {
		if (!r.inputs || r.inputs.length !== r.target.params.length) {
			missing.push({
				functionName: r.target.functionName,
				vectorName: r.vectorName,
			});
		}
	}

	return {
		invocations: results.length,
		invocationsWithProvenance: results.length - missing.length,
		missing,
	};
}

export interface TracedInput {
	val: xdr.ScVal;
	provenance: InputProvenance;
}

const SOURCES: ReadonlySet<string> = new Set([
	'spec',
	'type_boundary',
	'configured_context',
	'test_data',
]);

/** True iff the entry is complete and self-consistent. */
export function isValidProvenance(p: InputProvenance | undefined): boolean {
	return (
		p !== undefined &&
		p.param !== '' &&
		p.rule !== '' &&
		SOURCES.has(p.source) &&
		typeof p.seeded === 'boolean' &&
		(p.source === 'configured_context') ===
			(p.configKey !== undefined && p.configKey !== '') &&
		(p.nested === undefined ||
			(p.nested.length > 0 && p.nested.every(n => SOURCES.has(n))))
	);
}

export interface InvocationAudit {
	functionName: string;
	vectorName: string;
	/** Number of parameters of the invoked function. */
	paramCount: number;
	inputs?: InputProvenance[];
}

export interface ProvenanceAudit {
	/** Definition used, recorded in the report so the figure is reproducible. */
	definition: string;
	/** Vectors whose inputs were generated: executed + refused by the vector budget. This is the denominator. */
	vectorsGenerated: number;
	vectorsExecuted: number;
	/** Generated but not started because the campaign vector budget was exhausted. */
	vectorsRefusedByBudget: number;
	/** Subset of the executed vectors that ended in an operational error (inputs were still generated). */
	executedWithOperationalFailure: number;
	/** Same figure as vectorsGenerated (kept as the audited population). */
	invocations: number;
	invocationsWithProvenance: number;
	/** Percentage with provenance; null when nothing was generated (no claim). */
	percent: number | null;
	missing: Array<{
		functionName: string;
		vectorName: string;
		status: 'executed' | 'refused_by_budget';
		reason: string;
	}>;
}

export const PROVENANCE_DEFINITION =
	'population = every vector whose inputs were generated: executed ones (broadcast or simulated, including those that ended in an operational error) plus those refused by the campaign vector budget; NOT in the population: functions excluded by campaign limits and functions with no resolvable parameter types (no inputs are generated for them; see coverage). A vector passes when it has exactly one valid provenance entry per function parameter, in parameter order, each with param, rule, source, seeded, configKey iff source is configured_context, and nested (leaf sources) for composite parameters. A composite parameter (struct, vec, map, option, tuple, result) is one entry; its source is test_data if any leaf is generated test data. Baseline values reused across the vectors of a function are recorded once per vector that uses them. Context values replace scalar parameters only; nested fields are never replaced by context.';

/**
 * The 100% metric: computed over ALL generated vectors from the report's own
 * records, so a fuzzer that forgets provenance lowers the figure instead of
 * being silently skipped.
 */
export function auditProvenance(
	executed: InvocationAudit[],
	refused: InvocationAudit[] = [],
	operationalFailures = 0,
): ProvenanceAudit {
	const missing: ProvenanceAudit['missing'] = [];
	const check = (
		records: InvocationAudit[],
		status: 'executed' | 'refused_by_budget',
	) => {
		for (const r of records) {
			let reason: string | undefined;
			if (!r.inputs) reason = 'no provenance recorded';
			else if (r.inputs.length !== r.paramCount)
				reason = `${r.inputs.length} entries for ${r.paramCount} parameters`;
			else if (!r.inputs.every(i => isValidProvenance(i)))
				reason = 'incomplete or inconsistent entry';
			if (reason)
				missing.push({
					functionName: r.functionName,
					vectorName: r.vectorName,
					status,
					reason,
				});
		}
	};

	check(executed, 'executed');
	check(refused, 'refused_by_budget');
	const total = executed.length + refused.length;
	return {
		definition: PROVENANCE_DEFINITION,
		vectorsGenerated: total,
		vectorsExecuted: executed.length,
		vectorsRefusedByBudget: refused.length,
		executedWithOperationalFailure: operationalFailures,
		invocations: total,
		invocationsWithProvenance: total - missing.length,
		percent:
			total === 0
				? null
				: Math.round(((total - missing.length) / total) * 10_000) / 100,
		missing,
	};
}
