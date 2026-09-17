// ─── Responsive policy ────────────────────────────────────────────────────────
//
// LARGE:   columns >= 100 — full layout, full ASCII header.
// COMPACT: 70 <= columns < 100 — compact header, same view structure.
// TOO_SMALL: columns < 70 or rows < 20 — stable placeholder screen instead of
// risking wrapped/overlapping content; the active view stays mounted and its
// state (scan/audit in progress) keeps running in the background.
export type LayoutMode = 'large' | 'compact' | 'tooSmall';

export function getLayoutMode(columns: number, rows: number): LayoutMode {
	if (columns < 70 || rows < 20) return 'tooSmall';
	if (columns < 100) return 'compact';
	return 'large';
}
