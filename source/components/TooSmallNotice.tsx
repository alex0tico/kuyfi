import React from 'react';
import {Text, Box} from 'ink';

export function TooSmallNotice() {
	return (
		<Box flexDirection="column" padding={1}>
			<Text color="yellow" bold>
				{'Terminal too small'}
			</Text>
			<Text dimColor>{'Minimum recommended size: 70 × 24'}</Text>
			<Text dimColor>{'Resize the terminal to continue.'}</Text>
		</Box>
	);
}
