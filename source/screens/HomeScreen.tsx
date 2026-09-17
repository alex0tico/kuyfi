import React from 'react';
import {Text, Box} from 'ink';
import {TopStatusBar, AsciiHeader} from '../components/AppHeader.js';

export type ViewId = 'menu' | 'logs' | 'about' | 'scanner' | 'chaos';

export type ModuleRow = {
	id: ViewId;
	num: number;
	title: string;
	desc?: string;
};

export const MODULE_ROWS: ModuleRow[] = [
	{
		id: 'scanner',
		num: 1,
		title: 'OSINT Scanner',
		desc: 'Map contract attack surface',
	},
	{
		id: 'chaos',
		num: 2,
		title: 'Chaos Monkey',
		desc: 'Fuzz & stress test a contract',
	},
	{
		id: 'logs',
		num: 3,
		title: 'System Logs',
		desc: 'RPC connection status',
	},
	{
		id: 'about',
		num: 4,
		title: 'About',
		desc: 'Project info',
	},
];

export function HomeScreen({
	columns,
	selectedModule,
	menuNotice,
}: {
	columns: number;
	selectedModule: number;
	menuNotice: string | null;
}) {
	return (
		<Box flexDirection="column" padding={1}>
			<TopStatusBar />
			<AsciiHeader columns={columns} />
			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor="magenta"
				paddingX={2}
				paddingY={1}
			>
				<Box flexDirection="column">
					{MODULE_ROWS.map((row, index) => {
						const sel = index === selectedModule;
						return (
							<Box key={row.id} flexDirection="row" marginBottom={0}>
								<Text color={sel ? 'magenta' : 'gray'} bold={sel}>
									{`[${row.num}]  `}
								</Text>
								<Text color={sel ? 'white' : 'gray'} bold={sel}>
									{row.title.padEnd(20, ' ')}
								</Text>
								<Text dimColor>{row.desc}</Text>
							</Box>
						);
					})}
				</Box>
				<Box marginTop={1}>
					<Text dimColor>
						<Text color="cyan">{'↑↓'}</Text>
						{' navigate   '}
						<Text color="cyan">{'Enter'}</Text>
						{' select   '}
						<Text color="cyan">{'1–4'}</Text>
						{' shortcut'}
					</Text>
				</Box>
				{menuNotice ? (
					<Box marginTop={1}>
						<Text color="yellow">{menuNotice}</Text>
					</Box>
				) : null}
			</Box>
		</Box>
	);
}
