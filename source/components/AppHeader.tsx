import React from 'react';
import {Text, Box} from 'ink';
import {KUYFI_LOGO_LARGE, KUYFI_LOGO_COMPACT} from '../ui/ascii/index.js';

export function AsciiHeader({columns}: {columns: number}) {
	if (columns >= 100) {
		return (
			<Box flexDirection="column" marginBottom={1}>
				{KUYFI_LOGO_LARGE.map((line, i) => (
					<Text key={i}>
						{i === KUYFI_LOGO_LARGE.length - 1 ? (
							<>
								<Text color="magenta">{'     \\_____/                  '}</Text>
								<Text color="cyan">{'[ CORE SECURITY MODULE ]'}</Text>
								<Text color="magenta">{'                   \\_____/'}</Text>
							</>
						) : (
							<Text color="magenta">{line}</Text>
						)}
					</Text>
				))}
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginBottom={1} alignItems="center">
			<Text color="magenta">{KUYFI_LOGO_COMPACT[0]}</Text>
			<Text color="magenta">{KUYFI_LOGO_COMPACT[1]}</Text>
			<Text color="magenta">{KUYFI_LOGO_COMPACT[2]}</Text>
			<Text color="cyan">{'  [ CORE SECURITY MODULE ]'}</Text>
		</Box>
	);
}

export function TopStatusBar() {
	return (
		<Box marginBottom={1}>
			<Text bold color="magenta">
				KUYFI v0.1
			</Text>
			<Text dimColor> · </Text>
			<Text dimColor>SECURITY TERMINAL</Text>
			<Text dimColor> · </Text>
			<Text dimColor>Network: </Text>
			<Text color="cyan">TESTNET</Text>
			<Text dimColor> · </Text>
			<Text color="cyan">[ESC]</Text>
			<Text dimColor> Menu</Text>
		</Box>
	);
}
