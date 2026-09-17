import React from 'react';
import {Text, Box} from 'ink';

const FULL_ASCII_LINES = [
	'      /\\_/\\               __ __  __  __  __  __  ____  ____               /\\_/\\',
	'     ( o.o )             / // / / / / /  \\ \\/ / / __/ /  _/              ( o.o )',
	'      > ^ <             / ,<   / /_/ /    \\  / / _/  _/ /                 > ^ <',
	'     /     \\           /_/|_|  \\____/     /_/ /_/   /___/                /     \\',
	'    (|     |)                                                           (|     |)',
	'     \\_____/                  [ CORE SECURITY MODULE ]                   \\_____/',
];

export function AsciiHeader({columns}: {columns: number}) {
	if (columns >= 100) {
		return (
			<Box flexDirection="column" marginBottom={1}>
				{FULL_ASCII_LINES.map((line, i) => (
					<Text key={i}>
						{i === FULL_ASCII_LINES.length - 1 ? (
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
			<Text color="magenta">{'  /\\_/\\                /\\_/\\'}</Text>
			<Text color="magenta">{' ( o.o )   K U Y F I   ( o.o )'}</Text>
			<Text color="magenta">{'  > ^ <                 > ^ <'}</Text>
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
