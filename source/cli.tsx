#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';
import {selectCliMode, runHeadlessAudit} from './modules/cli_runtime.js';
import {runAuthzCli} from './modules/authz/cli.js';

const cli = meow(
	`
	Usage
	  $ kuyfi [CONTRACT_ID] [--json] [--pdf] [--config <file>] [--seed <number>]
	                [--fail-on <level>] [--fail-on-include-hypotheses]
	                [--fail-on-incomplete] [--timeout <seconds>]
	  $ kuyfi authz <matrix.json> [--out <dir>] [--fail-on <level>] [--fail-on-incomplete]

	Options
	  --json    Also write a SecurityReport JSON file (kuyfi-report-<id>.json)
	  --pdf     Also write a SecurityReport PDF file (kuyfi-report-<id>.pdf)
	  --config  Campaign configuration (JSON): context, limits, simulate-only/broadcast.
	            Without it the audit runs exactly as before.

	  --seed    Integer 0-4294967295 that drives every generated test datum (throwaway
	            addresses, the ephemeral account). Same seed + same contract = same
	            cases. Without it a seed is generated, printed and saved in the
	            report ("seed"), so the run can be repeated. Not used by authz.

	  --fail-on <info|low|medium|high|critical>
	            Exit 2 if at least one SUPPORTED finding has that severity or
	            higher. Hypotheses and inconclusive findings do not count.
	            Prints the counts by status and severity.
	  --fail-on-include-hypotheses
	            With --fail-on, hypotheses count too (inconclusive never do).
	  --fail-on-incomplete
	            Exit 3 if the run is incomplete: operational errors, vectors not
	            evaluated, vector budget exhausted, time limit reached, functions
	            without a single invocation, or inconclusive findings.
	  --timeout <seconds>
	            Execution time limit, checked before each vector family (one
	            already running finishes). Reaching it counts as incomplete.
	  The --config file may also set seed, failOn, failOnIncludeHypotheses,
	  failOnIncomplete and timeout; a flag you pass always wins over the file.

	  --out     (authz) Directory for the JSON evidence file (default: current directory)

	Authorization-aware matrix
	  kuyfi authz runs the cases of a matrix file in EXPLICIT enforcing-mode
	  simulation (relay account as source; actors authorize only through signed
	  entries) and writes JSON evidence. simulate-only by default; sending
	  transactions needs mode "broadcast" plus an authorizationRecord.

	Exit codes (precedence 1 > 2 > 3 > 0)
	  0  OK: nothing the gates were asked to catch
	  1  tool error (bad input or configuration, scan/RPC failure, failed write)
	  2  --fail-on fired
	  3  --fail-on-incomplete fired (or the time limit was reached with it set)
	  When a gate is set, the JSON report records which one fired ("gate").
	  authz: cases that contradict their expectation are supported findings
	  (unexpected acceptance = high, unexpected rejection = medium); cases that
	  could not be judged make the run incomplete.

	Examples
	  $ kuyfi
	      Launch the interactive TUI.

	  $ kuyfi CDV...(56 chars)
	      Run a headless scan + Chaos Monkey audit against a Testnet contract
	      and print a summary. Does not open the TUI.

	  $ kuyfi CDV...(56 chars) --json
	      Same, and also write kuyfi-report-<reportId>.json in the current directory.

	  $ kuyfi CDV...(56 chars) --json --pdf
	      Same, writing both files from the SAME SecurityReport (one audit run).

	  $ kuyfi CDV...(56 chars) --seed 42
	      Repeatable run: the same seed regenerates the same test data.
`,
	{
		importMeta: import.meta,
		flags: {
			json: {type: 'boolean', default: false},
			pdf: {type: 'boolean', default: false},
			config: {type: 'string'},
			out: {type: 'string'},
			seed: {type: 'number'},
			failOn: {type: 'string'},
			failOnIncludeHypotheses: {type: 'boolean'},
			failOnIncomplete: {type: 'boolean'},
			timeout: {type: 'number'},
		},
	},
);

// meow reports an absent boolean flag as `false`, which would silently override
// the --config file; a flag only counts when it was actually typed.
const flagGiven = (name: string) =>
	process.argv.some(
		a =>
			a === `--${name}` || a === `--no-${name}` || a.startsWith(`--${name}=`),
	);
const failOnIncomplete = flagGiven('fail-on-incomplete')
	? cli.flags.failOnIncomplete
	: undefined;
const failOnIncludeHypotheses = flagGiven('fail-on-include-hypotheses')
	? cli.flags.failOnIncludeHypotheses
	: undefined;

async function main() {
	const mode = selectCliMode(cli.input);

	if (mode.kind === 'authz') {
		const notForAuthz: Array<[string, boolean]> = [
			[
				'--seed does not apply to kuyfi authz: authorization nonces are deliberately never seeded (a repeated nonce is rejected on-chain).',
				cli.flags.seed !== undefined,
			],
			[
				'--timeout does not apply to kuyfi authz.',
				cli.flags.timeout !== undefined,
			],
			[
				'--fail-on-include-hypotheses does not apply to kuyfi authz: a matrix has no hypotheses.',
				failOnIncludeHypotheses !== undefined,
			],
		];
		const refused = notForAuthz.find(([, given]) => given);
		if (refused) {
			console.error(refused[0]);
			process.exitCode = 1;
			return;
		}

		if (!mode.file) {
			console.error('Usage: kuyfi authz <matrix.json> [--out <dir>]');
			process.exitCode = 1;
			return;
		}

		const result = await runAuthzCli(mode.file, {
			outDir: cli.flags.out,
			failOn: cli.flags.failOn,
			failOnIncomplete,
			onProgress(message: string) {
				console.log(message);
			},
		});
		if (result.errorOutput) console.error(result.errorOutput);
		else if (result.output) console.log('\n' + result.output);
		process.exitCode = result.exitCode;
		return;
	}

	if (mode.kind === 'invalid') {
		console.error(
			`Invalid Contract ID: "${mode.contractId}". Expected 56 characters starting with C (A-Z, 0-9).`,
		);
		process.exitCode = 1;
		return;
	}

	if (mode.kind === 'headless') {
		const result = await runHeadlessAudit(mode.contractId, {
			onProgress(message: string) {
				console.log(message);
			},
			writeJson: cli.flags.json,
			writePdf: cli.flags.pdf,
			configPath: cli.flags.config,
			seedValue: cli.flags.seed,
			failOn: cli.flags.failOn,
			failOnIncludeHypotheses,
			failOnIncomplete,
			timeout: cli.flags.timeout,
		});

		if (result.errorOutput) {
			console.error(result.errorOutput);
		} else if (result.output) {
			console.log('\n' + result.output);
		}

		process.exitCode = result.exitCode;
		return;
	}

	// mode.kind === 'tui' — unchanged interactive path.
	//
	// Ink already listens to process.stdout's native 'resize' event itself
	// (see Ink's own `resized` handler: it clears + resets its internal
	// output-tracking buffers and recalculates layout before re-rendering).
	// A second, app-level resize listener that also calls `instance.clear()`
	// races against that internal handler and desyncs Ink's own bookkeeping
	// (its public `clear()` API is meant for pre-unmount cleanup, not
	// mid-session redraws — it *syncs* lastOutput instead of resetting it),
	// which is what caused the duplicated/disappearing content on resize.
	// App's own `useTerminalSize()` hook remains the single additional
	// listener, and it only feeds React state for conditional layout — it
	// never touches the terminal directly.
	render(<App />);
}

await main();
