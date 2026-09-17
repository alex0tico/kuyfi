import React, {useState, useEffect, useCallback} from 'react';
import {Text, Box, useInput} from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {rpc as SorobanRpc} from '@stellar/stellar-sdk';

import {typeName} from '../modules/chaos_monkey/type_gen.js';
import {
	scanContract,
	isValidContractId,
	ScanError,
} from '../modules/scanner.js';
import {TESTNET_RPC_URL} from '../modules/network.js';
import type {ScannedParam, ScanResult} from '../modules/scanner.js';
import {TooSmallNotice} from '../components/TooSmallNotice.js';
import {ResizingNotice} from '../components/ResizingNotice.js';
import {truncateContractId, formatBytes} from '../ui/format.js';

interface ScannerScreenProps {
	contractId: string;
	setContractId: React.Dispatch<React.SetStateAction<string>>;
	onBackToMenu: () => void;
	onQuit: () => void;
	onScanComplete: (scanResult: ScanResult) => void;
	onLaunchChaos: () => void;
	isTooSmall?: boolean;
	isResizeSettling?: boolean;
}

interface ContractFunction {
	name: string;
	inputs: string;
	outputs: string;
	params: ScannedParam[];
}

export function ScannerScreen({
	contractId,
	setContractId,
	onBackToMenu,
	onQuit,
	onScanComplete,
	onLaunchChaos,
	isTooSmall = false,
	isResizeSettling = false,
}: ScannerScreenProps) {
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
				const server = new SorobanRpc.Server(TESTNET_RPC_URL);
				const scanResult = await scanContract(contractId, server);

				const parsedFunctions: ContractFunction[] = scanResult.functions.map(
					fn => ({
						name: fn.name,
						inputs: fn.params
							.map(p => `${p.name}: ${typeName(p.type)}`)
							.join(', '),
						outputs: fn.hasReturn ? 'Has Return' : 'Void',
						params: fn.params,
					}),
				);

				if (!cancelled) {
					setBytecodeSize(scanResult.bytecodeSize);
					setFunctions(parsedFunctions);
					onScanComplete(scanResult);
				}
			} catch (error: unknown) {
				if (!cancelled) {
					if (error instanceof ScanError) {
						switch (error.code) {
							case 'RPC_UNAVAILABLE':
								setRpcError(
									'CRITICAL: No connection to Testnet or RPC unavailable.',
								);
								break;
							case 'CONTRACT_NOT_FOUND':
								setRpcError(
									'CONTRACT NOT FOUND: Check the Contract ID exists on Testnet.',
								);
								break;
							case 'XDR_ALIGN_FAILURE':
								setRpcError(
									'DECODE ERROR: WASM downloaded but contractspecv0 section is invalid or missing.',
								);
								break;
							case 'UNKNOWN':
								setRpcError(error.message || 'Soroban RPC query failed.');
								break;
						}
					} else {
						const msg = error instanceof Error ? error.message : String(error);
						setRpcError(msg || 'Soroban RPC query failed.');
					}
				}
			} finally {
				if (!cancelled) {
					setIsScanning(false);
				}
			}
		};

		// Fire-and-forget by design: every path inside fetchContractBytecode is
		// wrapped in its own try/catch/finally and gated by `cancelled`, so no
		// rejection can escape this effect. `void` marks that intentionally.
		void fetchContractBytecode();
		return () => {
			cancelled = true;
		};
	}, [contractId, onScanComplete]);

	const showInputOnly = !contractId;
	const scanFinished =
		Boolean(contractId) &&
		!isScanning &&
		(rpcError !== null || bytecodeSize !== null);
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
			[
				showPostScanActions,
				resetScanState,
				onBackToMenu,
				onQuit,
				onLaunchChaos,
			],
		),
		{isActive: showPostScanActions},
	);

	function onSubmit(newValue: string) {
		if (!isValidContractId(newValue)) {
			setInputError(
				'Contract ID must start with C and be exactly 56 characters (A-Z, 0-9).',
			);
			return;
		}

		setInputError('');
		setContractId(newValue);
	}

	// Rendered after every hook above so the in-flight scan (if any) keeps
	// running in the background — resizing back up shows wherever it got to.
	// Priority: an active shrink-settle takes precedence over tooSmall, since
	// the terminal's real size is unreliable/irrelevant until it settles.
	if (isResizeSettling) {
		return <ResizingNotice />;
	}

	if (isTooSmall) {
		return <TooSmallNotice />;
	}

	return (
		<Box flexDirection="column">
			{showInputOnly && (
				<Box flexDirection="column" padding={1}>
					<Text color="magenta">
						{'┌─ OSINT SCANNER ──────────────────────────────────────┐'}
					</Text>
					<Text dimColor>
						{'│  Enter Stellar Contract ID (56 chars, starts with C)  │'}
					</Text>
					<Text dimColor>
						{'│                                                        │'}
					</Text>
					<Box flexDirection="row">
						<Text dimColor>{'│  '}</Text>
						<Text color="cyan">{'> '}</Text>
						<TextInput
							value={inputValue}
							onChange={setInputValue}
							onSubmit={onSubmit}
						/>
					</Box>
					<Text dimColor>
						{'│                                                        │'}
					</Text>
					<Box flexDirection="row">
						<Text dimColor>{'│  '}</Text>
						<Text color="cyan">{'[Enter]'}</Text>
						<Text dimColor>{' Scan    '}</Text>
						<Text color="cyan">{'[Esc]'}</Text>
						<Text dimColor>{' Back to menu                   │'}</Text>
					</Box>
					<Text color="magenta">
						{'└────────────────────────────────────────────────────────┘'}
					</Text>
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
							<Box
								key={`${fn.name}:${fn.inputs}:${fn.outputs}`}
								flexDirection="row"
							>
								<Text color="green" bold>
									{fn.name}
								</Text>
								<Text color="cyan">{'('}</Text>
								<Text dimColor>{fn.inputs}</Text>
								<Text color="cyan">{')'}</Text>
								<Text color="magenta">{' → '}</Text>
								<Text color={fn.outputs === 'Void' ? 'gray' : 'greenBright'}>
									{fn.outputs}
								</Text>
							</Box>
						))}
					</Box>
				</Box>
			)}

			{showPostScanActions && (
				<Box flexDirection="column" marginTop={1}>
					<Text dimColor>
						{'─────────────────────────────────────────────'}
					</Text>
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
					<Text dimColor>
						{'─────────────────────────────────────────────'}
					</Text>
				</Box>
			)}
		</Box>
	);
}
