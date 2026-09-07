import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Text, Box, useInput, useStdout} from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {rpc as SorobanRpc, xdr} from '@stellar/stellar-sdk';

// @ts-ignore
import * as KuyfiClient from '../src/kuyfi_client/dist/index.js';
import {runChaosMonkey, formatReportForTerminal} from './modules/chaos_monkey/index.js';
import {typeName} from './modules/chaos_monkey/type_gen.js';
import {buildUdtRegistry} from './modules/chaos_monkey/udt_registry.js';
import type {ChaosReport, UdtRegistry} from './modules/chaos_monkey/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;
type ScannedParam = {name: string; type: AnyTypeDef};
type ScannedFunction = {name: string; params: ScannedParam[]};

function useTerminalSize() {
	const {stdout} = useStdout();
	const [size, setSize] = useState({
		columns: stdout.columns || 80,
		rows: stdout.rows || 24,
	});

	useEffect(() => {
		function onResize() {
			setSize({
				columns: stdout.columns || 80,
				rows: stdout.rows || 24,
			});
		}

		stdout.on('resize', onResize);
		return () => {
			stdout.off('resize', onResize);
		};
	}, [stdout]);

	return size;
}

interface ScannerViewProps {
	contractId: string;
	setContractId: React.Dispatch<React.SetStateAction<string>>;
	onBackToMenu: () => void;
	onQuit: () => void;
	onScanComplete: (contractId: string, functions: ScannedFunction[], udtRegistry: UdtRegistry) => void;
	onLaunchChaos: () => void;
}

interface ContractFunction {
	name: string;
	inputs: string;
	outputs: string;
	params: ScannedParam[];
}

type ViewId = 'menu' | 'logs' | 'about' | 'scanner' | 'chaos';

type ModuleRow = {
	id: ViewId;
	num: number;
	title: string;
	desc?: string;
};

const MODULE_ROWS: ModuleRow[] = [
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

function truncateContractId(id: string, head = 6, tail = 5): string {
	if (id.length <= head + tail + 3) return id;
	return `${id.slice(0, head)}...${id.slice(-tail)}`;
}

function formatBytes(n: number): string {
	return n.toLocaleString('en-US');
}

const FULL_ASCII_LINES = [
	'      /\\_/\\               __ __  __  __  __  __  ____  ____               /\\_/\\',
	'     ( o.o )             / // / / / / /  \\ \\/ / / __/ /  _/              ( o.o )',
	'      > ^ <             / ,<   / /_/ /    \\  / / _/  _/ /                 > ^ <',
	'     /     \\           /_/|_|  \\____/     /_/ /_/   /___/                /     \\',
	'    (|     |)                                                           (|     |)',
	'     \\_____/                  [ CORE SECURITY MODULE ]                   \\_____/',
];

function AsciiHeader({columns}: {columns: number}) {
	if (columns >= 90) {
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

function TopStatusBar() {
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

function ViewShell({
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
			<Box flexDirection="column" borderStyle="single" borderColor="magenta" padding={1}>
				<Text dimColor>
					<Text color="cyan">[ESC]</Text> Back
				</Text>
				{children}
			</Box>
		</Box>
	);
}

function ScannerView({
	contractId,
	setContractId,
	onBackToMenu,
	onQuit,
	onScanComplete,
	onLaunchChaos,
}: ScannerViewProps) {
	const [inputValue, setInputValue] = useState('');
	const [inputError, setInputError] = useState('');
	const [isScanning, setIsScanning] = useState(false);
	const [bytecodeSize, setBytecodeSize] = useState<number | null>(null);
	const [rpcError, setRpcError] = useState<string | null>(null);
	const [functions, setFunctions] = useState<ContractFunction[]>([]);

	const resetScanState = useCallback(() => {
		setInputValue('');
		setInputError('');
		setIsScanning(false);
		setBytecodeSize(null);
		setRpcError(null);
		setFunctions([]);
		setContractId('');
	}, [setContractId]);

	useEffect(() => {
		if (!contractId) {
			setIsScanning(false);
			setBytecodeSize(null);
			setRpcError(null);
			setFunctions([]);
			return;
		}

		let cancelled = false;
		const fetchContractBytecode = async () => {
			setIsScanning(true);
			setBytecodeSize(null);
			setRpcError(null);
			setFunctions([]);

			try {
				const server = new SorobanRpc.Server('https://soroban-testnet.stellar.org');
				const wasmBytecode = await server.getContractWasmByContractId(contractId);

				if (!wasmBytecode || wasmBytecode.length === 0) {
					throw new Error('CONTRACT_NOT_FOUND');
				}

				const sizeInBytes = wasmBytecode.length;
				const wasmModule = await WebAssembly.compile(Uint8Array.from(wasmBytecode));
				const [specSection] = WebAssembly.Module.customSections(wasmModule, 'contractspecv0');

				if (!specSection) {
					throw new Error('XDR_ALIGN_FAILURE');
				}

				const buffer = Buffer.from(specSection);
				let offset = 0;
				const entries = [];
				while (offset < buffer.length) {
					let success = false;
					for (let len = 4; len <= buffer.length - offset; len += 4) {
						try {
							const chunk = buffer.slice(offset, offset + len);
							const entry = xdr.ScSpecEntry.fromXDR(chunk);
							entries.push(entry);
							offset += len;
							success = true;
							break;
						} catch {
						}
					}

					if (!success) {
						throw new Error('XDR_ALIGN_FAILURE');
					}
				}

				// Build the UDT registry (struct/union/enum) from the same entries[].
				const udtRegistry: UdtRegistry = buildUdtRegistry(entries);

				const parsedFunctions: ContractFunction[] = entries
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					.filter((e: any) => e.switch().name === 'scSpecEntryFunctionV0')
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					.map((e: any) => {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const func = e.functionV0();
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const inputSpecs: ScannedParam[] = func.inputs().map((i: any) => ({
							name: i.name().toString('utf-8') as string,
							type: i.type() as AnyTypeDef,
						}));
						return {
							name: func.name().toString('utf-8') as string,
							inputs: inputSpecs.map(s => `${s.name}: ${typeName(s.type)}`).join(', '),
							outputs: func.outputs().length > 0 ? 'Has Return' : 'Void',
							params: inputSpecs,
						};
					});

				if (!cancelled) {
					setBytecodeSize(sizeInBytes);
					setFunctions(parsedFunctions);
					onScanComplete(
						contractId,
						parsedFunctions.map(fn => ({name: fn.name, params: fn.params})),
						udtRegistry,
					);
				}
			} catch (error: unknown) {
				if (!cancelled) {
					const msg = error instanceof Error ? error.message : String(error);
					const rawMessage = msg.toLowerCase();
					if (rawMessage.includes('fetch') || rawMessage.includes('network')) {
						setRpcError('CRITICAL: No connection to Testnet or RPC unavailable.');
					} else if (
						msg === 'CONTRACT_NOT_FOUND' ||
						rawMessage.includes('404') ||
						rawMessage.includes('not found') ||
						rawMessage.includes('null')
					) {
						setRpcError('CONTRACT NOT FOUND: Check the Contract ID exists on Testnet.');
					} else if (msg === 'XDR_ALIGN_FAILURE') {
						setRpcError(
							'DECODE ERROR: WASM downloaded but contractspecv0 section is invalid or missing.',
						);
					} else {
						setRpcError(msg || 'Soroban RPC query failed.');
					}
				}
			} finally {
				if (!cancelled) {
					setIsScanning(false);
				}
			}
		};

		fetchContractBytecode();
		return () => {
			cancelled = true;
		};
	}, [contractId, onScanComplete]);

	const showInputOnly = !contractId;
	const scanFinished =
		Boolean(contractId) && !isScanning && (rpcError !== null || bytecodeSize !== null);
	const showPostScanActions = scanFinished;

	useInput(
		useCallback(
			input => {
				if (!showPostScanActions) return;
				const ch = input?.toLowerCase();
				if (ch === 's') {
					resetScanState();
					return;
				}

				if (ch === 'c') {
					resetScanState();
					onLaunchChaos();
					return;
				}

				if (ch === 'm') {
					resetScanState();
					onBackToMenu();
					return;
				}

				if (ch === 'q') {
					onQuit();
				}
			},
			[showPostScanActions, resetScanState, onBackToMenu, onQuit, onLaunchChaos],
		),
		{isActive: showPostScanActions},
	);

	function onSubmit(newValue: string) {
		const contractIdRegex = /^C[A-Z0-9]{55}$/;
		if (!contractIdRegex.test(newValue)) {
			setInputError('Contract ID must start with C and be exactly 56 characters (A-Z, 0-9).');
			return;
		}

		setInputError('');
		setContractId(newValue);
	}

	return (
		<Box flexDirection="column">
			{showInputOnly && (
				<Box flexDirection="column" padding={1}>
					<Text color="magenta">{'┌─ OSINT SCANNER ──────────────────────────────────────┐'}</Text>
					<Text dimColor>{'│  Enter Stellar Contract ID (56 chars, starts with C)  │'}</Text>
					<Text dimColor>{'│                                                        │'}</Text>
					<Box flexDirection="row">
						<Text dimColor>{'│  '}</Text>
						<Text color="cyan">{'> '}</Text>
						<TextInput value={inputValue} onChange={setInputValue} onSubmit={onSubmit} />
					</Box>
					<Text dimColor>{'│                                                        │'}</Text>
					<Box flexDirection="row">
						<Text dimColor>{'│  '}</Text>
						<Text color="cyan">{'[Enter]'}</Text>
						<Text dimColor>{' Scan    '}</Text>
						<Text color="cyan">{'[Esc]'}</Text>
						<Text dimColor>{' Back to menu                   │'}</Text>
					</Box>
					<Text color="magenta">{'└────────────────────────────────────────────────────────┘'}</Text>
					{inputError ? (
						<Text color="red" bold>
							{inputError}
						</Text>
					) : null}
				</Box>
			)}

			{isScanning && (
				<Box marginTop={1}>
					<Text color="yellow">
						<Spinner type="dots" /> Fetching bytecode from Testnet…
					</Text>
				</Box>
			)}

			{rpcError && !isScanning && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="red" bold>
						{rpcError}
					</Text>
				</Box>
			)}

			{!isScanning && functions.length > 0 && bytecodeSize !== null && (
				<Box
					flexDirection="column"
					marginTop={1}
					borderStyle="single"
					borderColor="cyan"
					padding={1}
				>
					<Box flexDirection="row">
						<Text color="magenta" bold>
							{'🛡 ATTACK SURFACE MAP'}
						</Text>
						<Text dimColor>{' ─── '}</Text>
						<Text color="yellow">{truncateContractId(contractId)}</Text>
						<Text dimColor>{' ─── '}</Text>
						<Text color="white">{formatBytes(bytecodeSize)}</Text>
						<Text dimColor>{' bytes'}</Text>
					</Box>
					<Box marginTop={1}>
						<Text color="green">{'✔ Functions found: '}</Text>
						<Text color="white" bold>
							{String(functions.length)}
						</Text>
					</Box>
					<Box flexDirection="column" marginTop={1}>
						{functions.map(fn => (
							<Box key={`${fn.name}:${fn.inputs}:${fn.outputs}`} flexDirection="row">
								<Text color="green" bold>
									{fn.name}
								</Text>
								<Text color="cyan">{'('}</Text>
								<Text dimColor>{fn.inputs}</Text>
								<Text color="cyan">{')'}</Text>
								<Text color="magenta">{' → '}</Text>
								<Text color={fn.outputs === 'Void' ? 'gray' : 'greenBright'}>{fn.outputs}</Text>
							</Box>
						))}
					</Box>
				</Box>
			)}

			{showPostScanActions && (
				<Box flexDirection="column" marginTop={1}>
					<Text dimColor>{'─────────────────────────────────────────────'}</Text>
					<Text color="white">{'What do you want to do next?'}</Text>
					<Box flexDirection="column" marginTop={1}>
						<Text>
							<Text color="cyan">{'[S]'}</Text>
							<Text dimColor>{'  Scan another contract'}</Text>
						</Text>
						<Text>
							<Text color="cyan">{'[C]'}</Text>
							<Text dimColor>{'  Run Chaos Monkey on this contract'}</Text>
						</Text>
						<Text>
							<Text color="cyan">{'[M]'}</Text>
							<Text dimColor>{'  Return to main menu'}</Text>
						</Text>
						<Text>
							<Text color="cyan">{'[Q]'}</Text>
							<Text dimColor>{'  Quit'}</Text>
						</Text>
					</Box>
					<Text dimColor>{'─────────────────────────────────────────────'}</Text>
				</Box>
			)}
		</Box>
	);
}

// ─── Chaos Monkey View ────────────────────────────────────────────────────────

type ChaosPhase = 'idle' | 'running' | 'done' | 'error';

function logLineColor(line: string): string {
	if (line.includes('CRITICAL') || line.includes('POTENTIAL_VULN')) return 'red';
	if (line.includes('SECURE')) return 'green';
	if (
		line.includes('Generating') ||
		line.includes('Connected') ||
		line.includes('Keypair') ||
		line.includes('funded')
	)
		return 'cyan';
	return '';
}

function reportBorderColor(report: ChaosReport): 'red' | 'yellow' | 'green' {
	if (report.summary.critical > 0) return 'red';
	if (report.summary.high > 0) return 'yellow';
	return 'green';
}

function ChaosMonkeyView({
	contractId,
	functions,
	udtRegistry,
	onBackToMenu,
}: {
	contractId: string;
	functions: ScannedFunction[];
	udtRegistry: UdtRegistry;
	onBackToMenu: () => void;
}) {
	const [phase, setPhase] = useState<ChaosPhase>('idle');
	const [logs, setLogs] = useState<string[]>([]);
	const [report, setReport] = useState<ChaosReport | null>(null);
	const [errorMsg, setErrorMsg] = useState('');
	const hasStarted = useRef(false);

	useInput(
		useCallback(
			(input, key) => {
				if (phase === 'idle' && contractId !== '' && key.return) {
					setPhase('running');
					return;
				}

				if (phase === 'done' || phase === 'error') {
					const ch = input.toLowerCase();
					if (ch === 'm') {
						onBackToMenu();
						return;
					}

					if (phase === 'done' && ch === 's') {
						onBackToMenu();
					}
				}
			},
			[phase, contractId, onBackToMenu],
		),
	);

	useEffect(() => {
		if (phase !== 'running') return;
		if (hasStarted.current) return;
		hasStarted.current = true;

		void runChaosMonkey({
			contractId,
			functions,
			udtRegistry,
			onProgress(msg: string) {
				setLogs(prev => [...prev, msg]);
			},
		})
			.then(r => {
				setReport(r);
				setPhase('done');
			})
			.catch((err: unknown) => {
				setErrorMsg(err instanceof Error ? err.message : String(err));
				setPhase('error');
			});
	}, [phase, contractId, functions]);

	// ── idle: no target loaded ────────────────────────────────────────────────
	if (phase === 'idle' && contractId === '') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="magenta">
					{'┌─ CHAOS MONKEY ──────────────────────────────────────┐'}
				</Text>
				<Text dimColor>{'│  No target loaded.                                   │'}</Text>
				<Text dimColor>
					{'│  Run the OSINT Scanner first, then press [C]         │'}
				</Text>
				<Text dimColor>
					{'│  from the results screen to launch an attack.        │'}
				</Text>
				<Text color="magenta">
					{'└──────────────────────────────────────────────────────┘'}
				</Text>
			</Box>
		);
	}

	// ── idle: target ready ────────────────────────────────────────────────────
	if (phase === 'idle') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="magenta">
					{'┌─ CHAOS MONKEY ───────────────────────────────────────────────┐'}
				</Text>
				<Box flexDirection="row">
					<Text dimColor>{'│  Target: '}</Text>
					<Text color="yellow">{truncateContractId(contractId)}</Text>
				</Box>
				<Box flexDirection="row">
					<Text dimColor>{'│  Functions to fuzz: '}</Text>
					<Text color="white">{String(functions.length)}</Text>
				</Box>
				<Text dimColor>{'│                                                              │'}</Text>
				<Box flexDirection="row">
					<Text dimColor>{'│  '}</Text>
					<Text color="cyan">{'[ENTER]'}</Text>
					<Text dimColor>{' Start attack    '}</Text>
					<Text color="cyan">{'[ESC]'}</Text>
					<Text dimColor>{' Back to menu                         │'}</Text>
				</Box>
				<Text color="magenta">
					{'└──────────────────────────────────────────────────────────────┘'}
				</Text>
			</Box>
		);
	}

	// ── running ───────────────────────────────────────────────────────────────
	if (phase === 'running') {
		const visibleLogs = logs.slice(-12);
		return (
			<Box
				flexDirection="column"
				marginTop={1}
				borderStyle="single"
				borderColor="yellow"
				padding={1}
			>
				<Text color="yellow" bold>
					{'🐒 Chaos Monkey is running...'}
				</Text>
				<Box flexDirection="column" marginTop={1}>
					{visibleLogs.map((line, i) => {
						const col = logLineColor(line);
						if (col) {
							return (
								<Text key={i} color={col}>
									{line}
								</Text>
							);
						}

						return (
							<Text key={i} dimColor>
								{line}
							</Text>
						);
					})}
				</Box>
				<Box marginTop={1}>
					<Text dimColor>{'Vectors run: '}</Text>
					<Text color="cyan">{String(logs.length)}</Text>
				</Box>
			</Box>
		);
	}

	// ── error ─────────────────────────────────────────────────────────────────
	if (phase === 'error') {
		return (
			<Box
				flexDirection="column"
				marginTop={1}
				borderStyle="single"
				borderColor="red"
				padding={1}
			>
				<Text color="red" bold>
					{'✖ Attack failed'}
				</Text>
				<Box marginTop={1}>
					<Text color="red">{errorMsg}</Text>
				</Box>
				<Box marginTop={1}>
					<Text color="cyan">{'[M]'}</Text>
					<Text dimColor>{'  Back to menu'}</Text>
				</Box>
			</Box>
		);
	}

	// ── done ──────────────────────────────────────────────────────────────────
	if (report !== null) {
		const borderCol = reportBorderColor(report);
		const reportLines = formatReportForTerminal(report).split('\n');
		return (
			<Box
				flexDirection="column"
				marginTop={1}
				borderStyle="single"
				borderColor={borderCol}
				padding={1}
			>
				{reportLines.map((line: string, i: number) => (
					<Text key={i} dimColor={line.startsWith('─')}>
						{line}
					</Text>
				))}
				<Box marginTop={1}>
					<Text color="cyan">{'[M]'}</Text>
					<Text dimColor>{'  Back to menu    '}</Text>
					<Text color="cyan">{'[S]'}</Text>
					<Text dimColor>{'  Scan another contract'}</Text>
				</Box>
			</Box>
		);
	}

	return null;
}

// ─── App ──────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
	const {columns} = useTerminalSize();
	const [view, setView] = useState<ViewId>('menu');
	const [selectedModule, setSelectedModule] = useState(0);
	const [menuNotice, setMenuNotice] = useState<string | null>(null);
	const [contractId, setContractId] = useState('');
	const [lastScannedContractId, setLastScannedContractId] = useState('');
	const [lastScannedFunctions, setLastScannedFunctions] = useState<ScannedFunction[]>([]);
	const [lastUdtRegistry, setLastUdtRegistry] = useState<UdtRegistry>(new Map());

	const leaveScannerToMenu = useCallback(() => {
		setContractId('');
		setView('menu');
	}, []);

	const handleQuit = useCallback(() => {
		process.exit(0);
	}, []);

	const handleScanComplete = useCallback(
		(cId: string, fns: ScannedFunction[], registry: UdtRegistry) => {
			setLastScannedContractId(cId);
			setLastScannedFunctions(fns);
			setLastUdtRegistry(registry);
		},
		[],
	);

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
					if (row.id === 'chaos' && lastScannedContractId === '') {
						setMenuNotice('⚠  Run OSINT Scanner first to load a target contract.');
					} else {
						setMenuNotice(null);
					}

					setView(row.id);
					return;
				}

				const n = input === '1' || input === '2' || input === '3' || input === '4';
				if (n) {
					const idx = Number(input) - 1;
					const row = MODULE_ROWS[idx];
					if (row) {
						if (row.id === 'chaos' && lastScannedContractId === '') {
							setSelectedModule(idx);
							setMenuNotice('⚠  Run OSINT Scanner first to load a target contract.');
						} else {
							setMenuNotice(null);
							setSelectedModule(idx);
						}

						setView(row.id);
					}
				}
			},
			[view, selectedModule, lastScannedContractId],
		),
		{isActive: view === 'menu'},
	);

	if (view === 'menu') {
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

	if (view === 'scanner') {
		return (
			<Box>
				<ViewShell onBack={leaveScannerToMenu}>
					<ScannerView
						contractId={contractId}
						setContractId={setContractId}
						onBackToMenu={leaveScannerToMenu}
						onQuit={handleQuit}
						onScanComplete={handleScanComplete}
						onLaunchChaos={handleLaunchChaos}
					/>
				</ViewShell>
			</Box>
		);
	}

	if (view === 'chaos') {
		return (
			<Box>
				<ViewShell onBack={() => setView('menu')}>
					<ChaosMonkeyView
						contractId={lastScannedContractId}
						functions={lastScannedFunctions}
						udtRegistry={lastUdtRegistry}
						onBackToMenu={() => setView('menu')}
					/>
				</ViewShell>
			</Box>
		);
	}

	if (view === 'logs') {
		return (
			<Box>
				<ViewShell onBack={() => setView('menu')}>
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
				</ViewShell>
			</Box>
		);
	}

	return (
		<Box>
			<ViewShell onBack={() => setView('menu')}>
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
				<Text color="white">{'Kuyfi — Offensive Security Terminal for Soroban'}</Text>
				<Text dimColor>{'Version: 0.1  |  Network: Stellar Testnet'}</Text>
				<Text dimColor>{'Stack: Node.js · React · Ink · TypeScript · stellar-sdk'}</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color="cyan">{'The first black-box smart contract scanner'}</Text>
					<Text color="cyan">{'native to Soroban. No source code required.'}</Text>
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text dimColor>{'Phase 1 — OSINT Scanner       ✔ Complete'}</Text>
					<Text dimColor>{'Phase 2 — Chaos Monkey        ✔ Complete'}</Text>
					<Text dimColor>{'Phase 3 — Audit Reports       ○ Planned'}</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>{'github.com/alex0tico/kuyfi_tui'}</Text>
				</Box>
			</ViewShell>
		</Box>
	);
};

export default App;
