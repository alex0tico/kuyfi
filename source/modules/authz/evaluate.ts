import type {CaseEvaluation, ExpectSpec, ObservedResult} from './types.js';

/**
 * Pure evaluation of one case against its expectation (TA7 §1.4–1.6).
 * The expectation comes from the matrix file, never from the code that ran
 * the scenario. A case is ACCEPTED only when the observation matches the
 * expectation with the required evidence type and attribution.
 */
export function evaluateCase(
	expect: ExpectSpec | undefined,
	observed: ObservedResult | undefined,
	control: ObservedResult | undefined,
	controlRequired: boolean,
): CaseEvaluation {
	const reasons: string[] = [];
	if (!expect) {
		return {
			state: 'not_exercised',
			executed: false,
			accepted: false,
			reasons: ['no expectation defined'],
		};
	}

	if (!observed) {
		return {
			state: 'not_exercised',
			executed: false,
			accepted: false,
			reasons: ['case was not run'],
		};
	}

	if (observed.outcome === 'operational_error') {
		return {
			state: 'inconclusive',
			executed: false,
			accepted: false,
			reasons: [
				`operational error: ${observed.diagnostic?.split('\n')[0] ?? 'unknown'}`,
			],
		};
	}

	if (expect.outcome === 'success') {
		if (observed.outcome !== 'success') {
			return {
				state: 'unexpected_rejection',
				executed: true,
				accepted: false,
				reasons: [`rejected at stage ${observed.stage}`],
			};
		}

		let accepted = true;
		if (
			expect.eventTopic &&
			!observed.eventTopics.includes(expect.eventTopic)
		) {
			accepted = false;
			reasons.push(`expected event "${expect.eventTopic}" not observed`);
		}

		if (
			expect.evidence === 'on-chain' &&
			observed.onChain?.status !== 'SUCCESS'
		) {
			accepted = false;
			reasons.push(
				'on-chain evidence (included transaction) is required and missing',
			);
		}

		return {state: 'expected_success', executed: true, accepted, reasons};
	}

	// expected rejection
	if (observed.outcome === 'success') {
		return {
			state: 'unexpected_acceptance',
			executed: true,
			accepted: false,
			reasons: ['accepted although a rejection was expected'],
		};
	}

	if (controlRequired && control?.outcome !== 'success') {
		return {
			state: 'inconclusive',
			executed: false,
			accepted: false,
			reasons: [
				'paired control did not succeed: rejection cannot be attributed',
			],
		};
	}

	if (expect.stage && observed.stage !== expect.stage) {
		return {
			state: 'inconclusive',
			executed: false,
			accepted: false,
			reasons: [
				`rejected at stage ${observed.stage}, expected ${expect.stage}`,
			],
		};
	}

	if (
		expect.contractErrorCode !== undefined &&
		observed.contractErrorCode !== expect.contractErrorCode
	) {
		return {
			state: 'inconclusive',
			executed: false,
			accepted: false,
			reasons: [
				`contract error ${String(observed.contractErrorCode)}, expected ${expect.contractErrorCode}`,
			],
		};
	}

	if (!expect.stage)
		reasons.push('no stage expected: rejection is not attributed');
	return {
		state: 'expected_rejection',
		executed: true,
		accepted: Boolean(expect.stage),
		reasons,
	};
}
