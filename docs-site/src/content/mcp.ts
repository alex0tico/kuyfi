/** Shared MCP connection copy — single source for HTML docs + Markdown twin. */

export const MCP_STATUS = 'coming-soon' as const; // flip to 'available' when @kuyfi/mcp ships

export const MCP_PACKAGE = '@kuyfi/mcp';

/** Cursor / Claude Desktop style stdio config */
export const MCP_CONFIG_CURSOR = `{
  "mcpServers": {
    "kuyfi": {
      "command": "npx",
      "args": ["-y", "@kuyfi/mcp@latest"],
      "env": {
        "KUYFI_NETWORK": "stellar:testnet"
      }
    }
  }
}`;

/** Remote HTTP MCP (when the hosted server is live) */
export const MCP_CONFIG_HTTP = `{
  "mcpServers": {
    "kuyfi": {
      "url": "https://mcp.kuyfi.vercel.app/mcp",
      "headers": {}
    }
  }
}`;

export const MCP_TOOLS = [
	{
		name: 'kuyfi_scan',
		desc: 'OSINT attack-surface reconstruction for a Contract ID (read-only).',
	},
	{
		name: 'kuyfi_audit',
		desc: 'Local Chaos Monkey campaign — requires explicit user confirmation; Testnet only.',
	},
	{
		name: 'kuyfi_report_schema',
		desc: 'SecurityReport schemaVersion 1.0.0 field map.',
	},
	{
		name: 'kuyfi_signals',
		desc: 'Finding taxonomy (SECURE, POTENTIAL_VULN, …).',
	},
] as const;
