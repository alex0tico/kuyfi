import type {GateInput} from '../gate.js';
import type {AuthzReport} from './run.js';

/**
 * How an authz report feeds the gate. A matrix has no severities of its own,
 * so a case whose observation CONTRADICTS its expectation is a supported
 * finding with a fixed severity:
 *  - unexpected_acceptance (a rejection was expected, the call went through):
 *    HIGH — a protection the matrix relies on did not hold.
 *  - unexpected_rejection (success was expected, it was rejected): MEDIUM —
 *    legitimate authorization failed.
 * Cases that could not be judged (inconclusive, not exercised) or that are
 * not accepted for lack of required evidence make the run INCOMPLETE; they
 * are never findings.
 */
export const AUTHZ_FINDING_SEVERITY = {
	unexpected_acceptance: 'HIGH',
	unexpected_rejection: 'MEDIUM',
} as const;

export function authzGateInput(report: AuthzReport): GateInput {
	const findings: GateInput['findings'] = [];
	const incomplete = new Map<string, number>();
	for (const c of report.cases) {
		const state = c.evaluation.state;
		if (state === 'unexpected_acceptance' || state === 'unexpected_rejection') {
			findings.push({
				severity: AUTHZ_FINDING_SEVERITY[state],
				status: 'supported',
			});
		} else if (
			state === 'inconclusive' ||
			state === 'not_exercised' ||
			!c.evaluation.accepted
		) {
			const label =
				state === 'inconclusive' || state === 'not_exercised'
					? state
					: 'not accepted (evidence missing)';
			incomplete.set(label, (incomplete.get(label) ?? 0) + 1);
		}
	}

	return {
		findings,
		incomplete: [...incomplete].map(([label, n]) => `${n} case(s) ${label}`),
	};
}
