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
	  $ kuyfi [CONTRACT_ID] [--json] [--pdf] [--config <file>]
	  $ kuyfi authz <matrix.json> [--out <dir>]

	Options
	  --json    Also write a SecurityReport JSON file (kuyfi-report-<id>.json)
	  --pdf     Also write a SecurityReport PDF file (kuyfi-report-<id>.pdf)
	  --config  Campaign configuration (JSON): context, limits, simulate-only/broadcast.
	            Without it the audit runs exactly as before.

	  --out     (authz) Directory for the JSON evidence file (default: current directory)

	Authorization-aware matrix
	  kuyfi authz runs the cases of a matrix file in EXPLICIT enforcing-mode
	  simulation (relay account as source; actors authorize only through signed
	  entries) and writes JSON evidence. simulate-only by default; sending
	  transactions needs mode "broadcast" plus an authorizationRecord.

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
`,
	{
		importMeta: import.meta,
		flags: {
			json: {type: 'boolean', default: false},
			pdf: {type: 'boolean', default: false},
			config: {type: 'string'},
			out: {type: 'string'},
		},
	},
);

async function main() {
	const mode = selectCliMode(cli.input);

	if (mode.kind === 'authz') {
		if (!mode.file) {
			console.error('Usage: kuyfi authz <matrix.json> [--out <dir>]');
			process.exitCode = 1;
			return;
		}

		const result = await runAuthzCli(mode.file, {
			outDir: cli.flags.out,
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
