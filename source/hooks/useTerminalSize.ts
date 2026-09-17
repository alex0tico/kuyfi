import {useState, useEffect, useRef} from 'react';
import {useStdout} from 'ink';

// ─── Shrink resize recovery (D3.4A.2) ──────────────────────────────────────────
//
// Upstream root cause (github.com/vadimdemedes/ink issue #907, closed
// NOT_PLANNED — present in Ink 6.8 and 7.x alike): Ink erases the previous
// frame by counting LOGICAL lines (`output.split('\n').length`), not the
// PHYSICAL terminal rows that already-painted content reflows into when the
// terminal narrows. On a width decrease, a real terminal (confirmed: macOS
// Terminal.app) can reflow prior output to occupy more rows than Ink's
// count — Ink then erases too few rows and stale frame content is left
// behind, compounding with every further shrink. There is no general fix
// available from Ink itself.
//
// This mitigates it without touching Ink internals: only a SHRINK
// (narrower columns) arms a short debounce; while it's pending, every
// further resize (shrink OR expand) just restarts the same timer — nothing
// is drawn to the screen during a drag. Once resize events stop for
// ~130ms, we do exactly ONE full-screen clear (bypassing Ink's own
// under-counting erase math for this single transition) and flip
// `isResizeSettling` back to false, which is a real state change that
// makes React naturally render the actual current screen fresh onto the
// now-blank terminal — no ghost tick, no forced remount.
const RESIZE_SETTLE_MS = 130;

export function didShrink(
	newColumns: number,
	previousColumns: number,
): boolean {
	return newColumns < previousColumns;
}

export function useTerminalSize() {
	const {stdout} = useStdout();
	const [size, setSize] = useState({
		columns: stdout.columns || 80,
		rows: stdout.rows || 24,
	});
	const [isResizeSettling, setIsResizeSettling] = useState(false);

	const previousColumnsRef = useRef(stdout.columns || 80);
	const isSettlingRef = useRef(false);
	const settleTimerRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		let unmounted = false;

		function clearSettleTimer() {
			if (settleTimerRef.current) {
				clearTimeout(settleTimerRef.current);
				settleTimerRef.current = null;
			}
		}

		function settle() {
			settleTimerRef.current = null;
			if (unmounted) return;

			const columns = stdout.columns || 80;
			const rows = stdout.rows || 24;

			// The one controlled clear this mitigation is built around — see
			// the module comment above for why. Only ever reached from here,
			// only once per settled resize sequence, only on a real TTY.
			if (stdout.isTTY) {
				stdout.write('[2J[H');
			}

			isSettlingRef.current = false;
			setIsResizeSettling(false);
			setSize({columns, rows});
		}

		function onResize() {
			const columns = stdout.columns || 80;
			const rows = stdout.rows || 24;
			const shrinking = didShrink(columns, previousColumnsRef.current);
			previousColumnsRef.current = columns;

			if (shrinking || isSettlingRef.current) {
				isSettlingRef.current = true;
				setIsResizeSettling(true);
				clearSettleTimer();
				settleTimerRef.current = setTimeout(settle, RESIZE_SETTLE_MS);
				return;
			}

			// Pure expand while not settling — no special handling needed.
			setSize({columns, rows});
		}

		stdout.on('resize', onResize);
		return () => {
			unmounted = true;
			stdout.off('resize', onResize);
			clearSettleTimer();
		};
	}, [stdout]);

	return {...size, isResizeSettling};
}
