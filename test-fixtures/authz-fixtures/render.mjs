// Fills {{MARKER}} placeholders in the matrix templates. Fails loudly on any
// marker without a value, so a half-rendered matrix can never be run.
export const MARKERS = [
	'RUN_ID',
	'VAULT_ID',
	'POLICY_ID',
	'ROUTER_ID',
	'EXECUTOR_ID',
	'ADMIN',
	'OWNER',
	'RELAY',
	'ACTOR',
];

export function render(text, values) {
	const missing = new Set();
	const out = text.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
		if (values[name] === undefined || values[name] === '') {
			missing.add(name);
			return '';
		}

		return values[name];
	});
	if (missing.size > 0) {
		throw new Error(`No value for marker(s): ${[...missing].join(', ')}`);
	}

	return out;
}
