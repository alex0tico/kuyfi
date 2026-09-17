import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Text, Box, useInput} from 'ink';
import Spinner from 'ink-spinner';

import {
	runChaosMonkey,
	formatReportForTerminal,
} from '../modules/chaos_monkey/index.js';
import {buildSecurityReport} from '../modules/security_report.js';
import {exportSecurityReport} from '../modules/report_export.js';
import type {ExportOutcome, ExportFormat} from '../modules/report_export.js';
import type {ChaosReport} from '../modules/chaos_monkey/index.js';
import type {ScanResult} from '../modules/scanner.js';
import type {AuditRun} from '../modules/audit.js';
import type {SecurityReport} from '../modules/security_report.js';
import {TooSmallNotice} from '../components/TooSmallNotice.js';
import {ResizingNotice} from '../components/ResizingNotice.js';
import {truncateContractId} from '../ui/format.js';

type ChaosPhase = 'idle' | 'running' | 'done' | 'error';

function logLineColor(line: string): string {
	if (line.includes('CRITICAL') || line.includes('POTENTIAL_VULN'))
		return 'red';
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

interface LogEntry {
	id: number;
	text: string;
}

export function ChaosMonkeyScreen({
	scanResult,
	onBackToMenu,
	isTooSmall = false,
	isResizeSettling = false,
}: {
	scanResult: ScanResult | null;
	onBackToMenu: () => void;
	isTooSmall?: boolean;
	isResizeSettling?: boolean;
}) {
	const contractId = scanResult?.contractId ?? '';
	const functions = scanResult?.functions ?? [];
	const udtRegistry = scanResult?.udtRegistry ?? new Map();

	const [phase, setPhase] = useState<ChaosPhase>('idle');
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [report, setReport] = useState<ChaosReport | null>(null);
	const [errorMsg, setErrorMsg] = useState('');
	const hasStarted = useRef(false);
	// Stable per-line identity for React keys — assigned once when a log
	// line is born, never derived from its position in the (sliding) list.
	const nextLogId = useRef(0);

	// Built exactly once per completed run, in the runChaosMonkey().then()
	// callback below — never in a useEffect (which React 19 can invoke twice
	// under StrictMode) and never rebuilt per export keypress. J/P/B all
	// read this same cached object, so they always share reportId/
	// generatedAt/findings/evidence.
	const [securityReport, setSecurityReport] = useState<SecurityReport | null>(
		null,
	);
	const [isExporting, setIsExporting] = useState(false);
	const [exportResults, setExportResults] = useState<ExportOutcome[]>([]);
	const isExportingRef = useRef(false);

	// Thin glue over exportSecurityReport() — the actual "what does J/P/B do"
	// logic lives there (pure, fully unit-tested, no React/Ink involved).
	const handleExport = useCallback(
		async (format: ExportFormat) => {
			if (isExportingRef.current || securityReport === null) return;
			isExportingRef.current = true;
			setIsExporting(true);
			setExportResults([]);

			const results = await exportSecurityReport(securityReport, format);

			setExportResults(results);
			setIsExporting(false);
			isExportingRef.current = false;
		},
		[securityReport],
	);

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
						return;
					}

					if (phase === 'done' && ch === 'j') {
						void handleExport('json');
						return;
					}

					if (phase === 'done' && ch === 'p') {
						void handleExport('pdf');
						return;
					}

					if (phase === 'done' && ch === 'b') {
						void handleExport('both');
					}
				}
			},
			[phase, contractId, onBackToMenu, handleExport],
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
				setLogs(prev => [...prev, {id: nextLogId.current++, text: msg}]);
			},
		})
			.then(r => {
				if (scanResult) {
					const auditRun: AuditRun = {scan: scanResult, chaos: r};
					setSecurityReport(buildSecurityReport(auditRun));
				}

				setReport(r);
				setPhase('done');
			})
			.catch((err: unknown) => {
				setErrorMsg(err instanceof Error ? err.message : String(err));
				setPhase('error');
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [phase, contractId, functions]);

	// Rendered after every hook above so a running/finished campaign keeps
	// its state and effects alive — resizing back up shows the same run.
	// Same priority as ScannerScreen: settling beats tooSmall.
	if (isResizeSettling) {
		return <ResizingNotice />;
	}

	if (isTooSmall) {
		return <TooSmallNotice />;
	}

	// ── idle: no target loaded ────────────────────────────────────────────────
	if (phase === 'idle' && contractId === '') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="magenta">
					{'┌─ CHAOS MONKEY ──────────────────────────────────────┐'}
				</Text>
				<Text dimColor>
					{'│  No target loaded.                                   │'}
				</Text>
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
				<Text dimColor>
					{'│                                                              │'}
				</Text>
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
					{visibleLogs.map(entry => {
						const col = logLineColor(entry.text);
						if (col) {
							return (
								<Text key={entry.id} color={col}>
									{entry.text}
								</Text>
							);
						}

						return (
							<Text key={entry.id} dimColor>
								{entry.text}
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
				<Box marginTop={1}>
					<Text color="cyan">{'[J]'}</Text>
					<Text dimColor>{'  Export JSON    '}</Text>
					<Text color="cyan">{'[P]'}</Text>
					<Text dimColor>{'  Export PDF    '}</Text>
					<Text color="cyan">{'[B]'}</Text>
					<Text dimColor>{'  Export Both'}</Text>
				</Box>
				{isExporting && (
					<Box marginTop={1}>
						<Text color="yellow">
							<Spinner type="dots" /> Exporting…
						</Text>
					</Box>
				)}
				{!isExporting && exportResults.length > 0 && (
					<Box marginTop={1} flexDirection="column">
						{exportResults.map((r, i) => (
							<Box
								key={`${r.label}-${i}`}
								flexDirection="column"
								marginBottom={1}
							>
								<Text color={r.success ? 'green' : 'red'} bold>
									{r.success
										? `${r.label} exported:`
										: `${r.label} export failed:`}
								</Text>
								<Text color={r.success ? 'green' : 'red'} wrap="wrap">
									{r.success ? `./${r.message}` : r.message}
								</Text>
							</Box>
						))}
					</Box>
				)}
			</Box>
		);
	}

	return null;
}
