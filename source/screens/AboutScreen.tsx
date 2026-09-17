import React from 'react';
import {Text, Box} from 'ink';

export function AboutScreen() {
	return (
		<>
			<Box flexDirection="column" alignItems="center" marginBottom={1}>
				<Text color="magenta">{'      /\\_/\\'}</Text>
				<Text color="magenta">{'     ( o.o )'}</Text>
				<Text color="magenta">{'      > ^ <'}</Text>
				<Text color="magenta">{'     /     \\'}</Text>
				<Text color="magenta">{'     (|     |)'}</Text>
				<Text color="magenta">{'     \\_____/'}</Text>
			</Box>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					{'[ ABOUT KUYFI ]'}
				</Text>
			</Box>
			<Text color="white">
				{'Kuyfi — Offensive Security Terminal for Soroban'}
			</Text>
			<Text dimColor>{'Version: 0.1  |  Network: Stellar Testnet'}</Text>
			<Text dimColor>
				{'Stack: Node.js · React · Ink · TypeScript · stellar-sdk'}
			</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color="cyan">{'The first black-box smart contract scanner'}</Text>
				<Text color="cyan">
					{'native to Soroban. No source code required.'}
				</Text>
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text dimColor>{'Phase 1 — OSINT Scanner       ✔ Complete'}</Text>
				<Text dimColor>{'Phase 2 — Chaos Monkey        ✔ Complete'}</Text>
				<Text dimColor>{'Phase 3 — Audit Reports       ○ Planned'}</Text>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>{'github.com/alex0tico/kuyfi_tui'}</Text>
			</Box>
		</>
	);
}
