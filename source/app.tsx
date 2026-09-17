import React, {useState, useCallback} from 'react';
import {Box, useInput} from 'ink';

import type {ScanResult} from './modules/scanner.js';

import {useTerminalSize} from './hooks/useTerminalSize.js';
import {getLayoutMode} from './ui/layout.js';
import {TooSmallNotice} from './components/TooSmallNotice.js';
import {ResizingNotice} from './components/ResizingNotice.js';
import {ViewShell} from './components/ViewShell.js';
import {HomeScreen, MODULE_ROWS} from './screens/HomeScreen.js';
import type {ViewId} from './screens/HomeScreen.js';
import {ScannerScreen} from './screens/ScannerScreen.js';
import {ChaosMonkeyScreen} from './screens/ChaosMonkeyScreen.js';
import {LogsScreen} from './screens/LogsScreen.js';
import {AboutScreen} from './screens/AboutScreen.js';

const App: React.FC = () => {
	const {columns, rows, isResizeSettling} = useTerminalSize();
	const layoutMode = getLayoutMode(columns, rows);
	const [view, setView] = useState<ViewId>('menu');
	const [selectedModule, setSelectedModule] = useState(0);
	const [menuNotice, setMenuNotice] = useState<string | null>(null);
	const [contractId, setContractId] = useState('');
	const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);

	const leaveScannerToMenu = useCallback(() => {
		setContractId('');
		setView('menu');
	}, []);

	const handleQuit = useCallback(() => {
		process.exit(0);
	}, []);

	const handleScanComplete = useCallback((scanResult: ScanResult) => {
		setLastScanResult(scanResult);
	}, []);

	const handleLaunchChaos = useCallback(() => {
		setView('chaos');
	}, []);

	useInput(
		useCallback(
			(input, key) => {
				if (view !== 'menu') return;
				if (key.upArrow) {
					setMenuNotice(null);
					setSelectedModule(i => (i > 0 ? i - 1 : MODULE_ROWS.length - 1));
					return;
				}

				if (key.downArrow) {
					setMenuNotice(null);
					setSelectedModule(i => (i < MODULE_ROWS.length - 1 ? i + 1 : 0));
					return;
				}

				if (key.return) {
					const row = MODULE_ROWS[selectedModule];
					if (!row) return;
					if (row.id === 'chaos' && lastScanResult === null) {
						setMenuNotice(
							'⚠  Run OSINT Scanner first to load a target contract.',
						);
					} else {
						setMenuNotice(null);
					}

					setView(row.id);
					return;
				}

				const n =
					input === '1' || input === '2' || input === '3' || input === '4';
				if (n) {
					const idx = Number(input) - 1;
					const row = MODULE_ROWS[idx];
					if (row) {
						if (row.id === 'chaos' && lastScanResult === null) {
							setSelectedModule(idx);
							setMenuNotice(
								'⚠  Run OSINT Scanner first to load a target contract.',
							);
						} else {
							setMenuNotice(null);
							setSelectedModule(idx);
						}

						setView(row.id);
					}
				}
			},
			[view, selectedModule, lastScanResult],
		),
		{isActive: view === 'menu'},
	);

	if (view === 'menu') {
		if (isResizeSettling) {
			return <ResizingNotice />;
		}

		if (layoutMode === 'tooSmall') {
			return <TooSmallNotice />;
		}

		return (
			<HomeScreen
				columns={columns}
				selectedModule={selectedModule}
				menuNotice={menuNotice}
			/>
		);
	}

	if (view === 'scanner') {
		return (
			<Box>
				<ViewShell onBack={leaveScannerToMenu}>
					<ScannerScreen
						contractId={contractId}
						setContractId={setContractId}
						onBackToMenu={leaveScannerToMenu}
						onQuit={handleQuit}
						onScanComplete={handleScanComplete}
						onLaunchChaos={handleLaunchChaos}
						isTooSmall={layoutMode === 'tooSmall'}
						isResizeSettling={isResizeSettling}
					/>
				</ViewShell>
			</Box>
		);
	}

	if (view === 'chaos') {
		return (
			<Box>
				<ViewShell onBack={() => setView('menu')}>
					<ChaosMonkeyScreen
						scanResult={lastScanResult}
						onBackToMenu={() => setView('menu')}
						isTooSmall={layoutMode === 'tooSmall'}
						isResizeSettling={isResizeSettling}
					/>
				</ViewShell>
			</Box>
		);
	}

	if (view === 'logs') {
		if (isResizeSettling) {
			return <ResizingNotice />;
		}

		if (layoutMode === 'tooSmall') {
			return <TooSmallNotice />;
		}

		return (
			<Box>
				<ViewShell onBack={() => setView('menu')}>
					<LogsScreen />
				</ViewShell>
			</Box>
		);
	}

	if (isResizeSettling) {
		return <ResizingNotice />;
	}

	if (layoutMode === 'tooSmall') {
		return <TooSmallNotice />;
	}

	return (
		<Box>
			<ViewShell onBack={() => setView('menu')}>
				<AboutScreen />
			</ViewShell>
		</Box>
	);
};

export default App;
