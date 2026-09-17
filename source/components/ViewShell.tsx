import React, {useCallback} from 'react';
import {Text, Box, useInput} from 'ink';
import {TopStatusBar} from './AppHeader.js';

export function ViewShell({
	children,
	onBack,
	isActive = true,
}: {
	children: React.ReactNode;
	onBack: () => void;
	isActive?: boolean;
}) {
	useInput(
		useCallback(
			(_input, key) => {
				if (key.escape) {
					onBack();
				}
			},
			[onBack],
		),
		{isActive},
	);

	return (
		<Box flexDirection="column" padding={1}>
			<TopStatusBar />
			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor="magenta"
				padding={1}
			>
				<Text dimColor>
					<Text color="cyan">[ESC]</Text> Back
				</Text>
				{children}
			</Box>
		</Box>
	);
}
