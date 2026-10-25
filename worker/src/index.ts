import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import { fuzzContract, getReport, listFunctions, scanContractTool, type ToolContext } from "./tools";
import type { Props } from "./utils";

const contractId = z.string().describe("Soroban contract address on Testnet (56 characters, starts with C).");
const network = z.string().optional().describe('Only "testnet" is supported; any other value is rejected.');

function createServer(): McpServer {
	const server = new McpServer({ name: "Kuyfi MCP", version: "0.0.1" });
	const props = getMcpAuthContext()?.props as Props | undefined;
	const budget = Number((env as { SUBREQUEST_BUDGET?: string }).SUBREQUEST_BUDGET);
	const ctx: ToolContext = {
		kv: env.OAUTH_KV,
		login: props?.login,
		...(Number.isInteger(budget) && budget > 0 ? { subrequestBudget: budget } : {}),
	};

	server.registerTool(
		"list_functions",
		{
			description: "List the functions of a deployed Soroban contract on Testnet with their input and output types. Read-only.",
			inputSchema: z.object({ contract_id: contractId, network }),
		},
		(args) => listFunctions(ctx, args),
	);

	server.registerTool(
		"scan_contract",
		{
			description:
				"Scan a deployed Soroban contract on Testnet and return its attack surface (functions, types, user-defined types). Saves the report for 24 hours and returns a report_id.",
			inputSchema: z.object({ contract_id: contractId, network }),
		},
		(args) => scanContractTool(ctx, args),
	);

	server.registerTool(
		"get_report",
		{
			description: "Retrieve a report created earlier by you with scan_contract or fuzz_contract. Reports expire after 24 hours and are private to the user who created them.",
			inputSchema: z.object({ report_id: z.string().describe("The report_id returned by scan_contract or fuzz_contract.") }),
		},
		(args) => getReport(ctx, args),
	);

	server.registerTool(
		"fuzz_contract",
		{
			description:
				'Run generated attack vectors against a Soroban contract on Testnet in SIMULATION only (nothing is signed or sent). Results are findings, inconclusive results and "not evaluated" vectors; zero findings is not a security guarantee. Limited to 20 runs per hour per user.',
			inputSchema: z.object({
				contract_id: contractId,
				mode: z.string().optional().describe('Only "simulate" (default).'),
				max_vectors: z.number().int().optional().describe("Vectors to simulate, 1-50 (default 20)."),
				network,
			}),
		},
		(args) => fuzzContract(ctx, args),
	);

	return server;
}

const mcpHandler = createMcpHandler(createServer);
const apiHandler = {
	fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		return mcpHandler(request, bindings, ctx);
	},
} satisfies ExportedHandler<Env>;

export default new OAuthProvider({
	allowPlainPKCE: false,
	apiHandler,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as unknown as ExportedHandler,
	tokenEndpoint: "/token",
});
