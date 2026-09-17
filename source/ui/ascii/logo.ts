// The two header lockups — one per responsive tier (large / compact). These
// aren't standalone cats: the cat-face fragments are interleaved with the
// KUYFI wordmark (large) or the spaced-out "K U Y F I" text (compact) on the
// same lines, so each tier is kept as one cohesive block rather than split
// into separate cat/logo pieces that would need to be reassembled at
// render time. There is no third "tiny" variant — the tooSmall layout mode
// shows a text-only notice, not a smaller version of this art.
//
// Lines ending in a literal backslash can't use String.raw: a trailing
// backslash immediately before the closing backtick escapes the backtick
// itself (template-literal lexing, not a String.raw quirk), so those lines
// stay as ordinary escaped string literals. Every other line uses
// String.raw so the backslashes read the same as they render.
export const KUYFI_LOGO_LARGE = [
	'      /\\_/\\               __ __  __  __  __  __  ____  ____               /\\_/\\',
	String.raw`     ( o.o )             / // / / / / /  \ \/ / / __/ /  _/              ( o.o )`,
	String.raw`      > ^ <             / ,<   / /_/ /    \  / / _/  _/ /                 > ^ <`,
	'     /     \\           /_/|_|  \\____/     /_/ /_/   /___/                /     \\',
	String.raw`    (|     |)                                                           (|     |)`,
	String.raw`     \_____/                  [ CORE SECURITY MODULE ]                   \_____/`,
];

export const KUYFI_LOGO_COMPACT = [
	'  /\\_/\\                /\\_/\\',
	String.raw` ( o.o )   K U Y F I   ( o.o )`,
	String.raw`  > ^ <                 > ^ <`,
];
