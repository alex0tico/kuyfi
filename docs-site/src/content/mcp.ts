/** Shared MCP connection copy — single source for HTML docs + Markdown twin. */

export const MCP_STATUS = 'available' as const;

/** Hosted Kuyfi MCP server (streamable HTTP). Simulation only; sign in with GitHub on first connect. */
export const MCP_URL = 'https://kuyfi-mcp.alexbnjmnch.workers.dev/mcp';

export const MCP_CLAUDE_CODE = `claude mcp add --transport http kuyfi ${MCP_URL}`;

/** Cursor mcp.json (~/.cursor/mcp.json or .cursor/mcp.json) */
export const MCP_CONFIG_CURSOR = JSON.stringify(
	{mcpServers: {kuyfi: {url: MCP_URL}}},
	null,
	2,
);

const VSCODE_SERVER = JSON.stringify({name: 'kuyfi', type: 'http', url: MCP_URL});
export const MCP_VSCODE_CLI = `code --add-mcp '${VSCODE_SERVER}'`;

/** One-click install links (Cursor deeplink, VS Code URL handler). */
export const MCP_CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=kuyfi&config=${btoa(JSON.stringify({url: MCP_URL}))}`;
export const MCP_VSCODE_LINK = `vscode:mcp/install?${encodeURIComponent(VSCODE_SERVER)}`;

export const MCP_TOOLS = [
	{
		name: 'list_functions',
		desc: 'Lista las funciones de un contrato de Testnet con sus tipos de entrada y de salida.',
	},
	{
		name: 'scan_contract',
		desc: 'Devuelve la superficie de ataque (funciones y tipos) y guarda el reporte 24 h con un report_id.',
	},
	{
		name: 'fuzz_contract',
		desc: 'Genera vectores de ataque y los ejecuta solo en simulación (hasta 50 vectores; 20 corridas por hora y usuario).',
	},
	{
		name: 'get_report',
		desc: 'Recupera un reporte que creaste antes; solo lo puede leer quien lo creó.',
	},
	{
		name: 'report_card',
		desc: 'Genera una tarjeta PNG con el resumen de un reporte tuyo, más el mismo resumen en texto; solo la ve quien creó el reporte.',
	},
] as const;

/** Honest limits of the hosted server, shared by the HTML page and the Markdown twin. */
export const MCP_LIMITS = [
	'Cuota: 20 corridas de fuzz_contract por hora y por usuario; los reportes duran 24 h.',
	'Solo Testnet; fuzz_contract solo acepta mode="simulate". No se envía ninguna transacción ni se manejan claves.',
	'Las pruebas de autorización quedan «no evaluadas»: la simulación registra la autorización pero no la aplica.',
	'La simulación no conserva estado entre llamadas: las secuencias que dependen de estado no se ejercitan.',
	'Cero hallazgos no es prueba de seguridad: el reporte dice «no findings in this run» y los inconclusos se informan como inconclusos.',
] as const;
