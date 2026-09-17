import React from 'react';
import {Text, Box} from 'ink';

export function LogsScreen() {
	return (
		<>
			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="cyan">
					{'[ SYSTEM LOGS ]'}
				</Text>
			</Box>
			<Text color="green">{'✔ RPC: https://soroban-testnet.stellar.org'}</Text>
			<Text color="green">{'✔ Status: endpoint reachable (session)'}</Text>
			<Text color="magenta">{'✔ Core engine loaded'}</Text>
			<Text color="magenta">{'✔ Soroban bridge ready'}</Text>
			<Box marginTop={1}>
				<Text dimColor>
					{'Use '}
					<Text color="cyan">{'OSINT Scanner'}</Text>
					{' for per-contract RPC and WASM pulls.'}
				</Text>
			</Box>
		</>
	);
}
