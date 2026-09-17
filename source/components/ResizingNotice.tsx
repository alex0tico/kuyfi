import React from 'react';
import {Text, Box} from 'ink';

export function ResizingNotice() {
	return (
		<Box flexDirection="column" padding={1}>
			<Text color="cyan" bold>
				{'KUYFI'}
			</Text>
			<Text dimColor>{'Resizing terminal…'}</Text>
		</Box>
	);
}
