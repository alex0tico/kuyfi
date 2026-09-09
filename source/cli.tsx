#!/usr/bin/env node
import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import meow from 'meow';
import App from './app.js';
import { selectCliMode, runHeadlessAudit } from './modules/cli_runtime.js';

const cli = meow(
	`
	Usage
	  $ kuyfi [CONTRACT_ID] [--json]

	Options
	  --json    Also write a SecurityReport JSON file (kuyfi-report-<id>.json)

	Examples
	  $ kuyfi
	      Launch the interactive TUI.

	  $ kuyfi CDV...(56 chars)
	      Run a headless scan + Chaos Monkey audit against a Testnet contract
	      and print a summary. Does not open the TUI.

	  $ kuyfi CDV...(56 chars) --json
	      Same, and also write kuyfi-report-<reportId>.json in the current directory.
`,
	{
		importMeta: import.meta,
		flags: {
			json: {type: 'boolean', default: false},
		},
	},
);

async function main() {
	const mode = selectCliMode(cli.input);

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
	let instance: any;

	// Componente guardián que reacciona a los cambios físicos de la terminal
	const TerminalManager = () => {
		// Estado "fantasma" que solo sirve para forzar a React a redibujar
		const [, setTick] = useState(0);

		useEffect(() => {
			const handleResize = () => {
				// 1. Limpiamos el remanente visual (el bug de la cascada)
				if (instance) {
					instance.clear();
				}

				// 2. Forzamos el re-render de React al instante.
				// Como solo actualizamos el envoltorio, <App /> mantiene intacto su estado interno.
				setTick(prev => prev + 1);
			};

			// Escuchamos el cambio de tamaño nativo de Node
			process.stdout.on('resize', handleResize);

			// Limpieza del listener por buenas prácticas
			return () => {
				process.stdout.off('resize', handleResize);
			};
		}, []);

		// Renderizamos tu TUI de forma segura
		return <App />;
	};

	// Arrancamos el motor y capturamos la instancia
	instance = render(<TerminalManager />);
}

await main();
