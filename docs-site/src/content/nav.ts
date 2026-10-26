export type NavItem = {
	href: string;
	label: string;
	badge?: string;
};

export type NavGroup = {
	title: string;
	items: NavItem[];
};

/** Paths are relative to Astro `base` (`/docs`). */
export const NAV: NavGroup[] = [
	{
		title: 'Start',
		items: [
			{ href: '/', label: 'Overview' },
			{ href: '/installation', label: 'Installation' },
			{ href: '/quickstart', label: 'Quickstart' },
		],
	},
	{
		title: 'Core',
		items: [
			{ href: '/pipeline', label: 'Pipeline' },
			{ href: '/osint-scanner', label: 'OSINT Scanner' },
			{ href: '/chaos-monkey', label: 'Chaos Monkey' },
			{ href: '/vectors', label: 'Attack vectors' },
			{ href: '/findings', label: 'Findings & signals' },
			{ href: '/reports', label: 'Reports' },
			{ href: '/report-schema', label: 'Report schema' },
		],
	},
	{
		title: 'Reference',
		items: [
			{ href: '/cli', label: 'CLI reference' },
			{ href: '/tui', label: 'Interactive TUI' },
			{ href: '/paid-api', label: 'Paid scan API' },
			{ href: '/architecture', label: 'Architecture' },
			{ href: '/glossary', label: 'Glossary' },
			{ href: '/troubleshooting', label: 'Troubleshooting' },
			{ href: '/changelog', label: 'Changelog' },
		],
	},
	{
		title: 'Agents & MCP',
		items: [
			{ href: '/agent-setup', label: 'Agent setup', badge: 'MD' },
			{ href: '/for-llms', label: 'For LLMs' },
			{ href: '/mcp', label: 'MCP Connect', badge: 'Soon' },
		],
	},
	{
		title: 'Policy',
		items: [
			{ href: '/responsible-use', label: 'Responsible use' },
			{ href: '/faq', label: 'FAQ' },
		],
	},
];

export const SITE = {
	name: 'Kuyfi',
	tagline: 'Before the Breach.',
	version: 'v0.1.0',
	description:
		'Black-box security terminal for Soroban smart contracts — attack-surface reconstruction and Chaos Monkey fuzzing against deployed Testnet contracts, no source code required.',
	// Follows `site` in astro.config.mjs (DOCS_SITE at build time).
	url: (import.meta.env.SITE ?? 'https://kuyfi.vercel.app').replace(/\/$/, ''),
	github: 'https://github.com/alex0tico/kuyfi',
	npm: 'https://www.npmjs.com/package/@kuyfi/kuyfi',
	install: 'npm install -g @kuyfi/kuyfi',
	rpc: 'https://soroban-testnet.stellar.org',
};
