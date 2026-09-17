// A single standalone cat, used on the About screen. Distinct from the
// header's cat-pair artwork in logo.ts — there the cat fragments are
// interleaved with the KUYFI wordmark on the same lines, a different
// drawing entirely — so it isn't reused here.
//
// Lines ending in a literal backslash can't use String.raw: a trailing
// backslash immediately before the closing backtick escapes the backtick
// itself (template-literal lexing, not a String.raw quirk), so those two
// lines stay as ordinary escaped string literals. Every other line uses
// String.raw so the backslashes read the same as they render.
export const CAT_STANDALONE = [
	'      /\\_/\\',
	String.raw`     ( o.o )`,
	String.raw`      > ^ <`,
	'     /     \\',
	String.raw`     (|     |)`,
	String.raw`     \_____/`,
];
