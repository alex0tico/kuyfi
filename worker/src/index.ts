import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { GitHubHandler } from "./github-handler";
import type { Props } from "./utils";

function createServer(): McpServer {
	const server = new McpServer({ name: "Kuyfi MCP", version: "0.0.1" });
	const props = getMcpAuthContext()?.props as Props | undefined;

	// Test tool to validate the end-to-end flow. Real tools replace it later.
	server.registerTool(
		"ping",
		{ description: "Check that the Kuyfi MCP server is reachable and who you are signed in as." },
		async () => ({
			content: [{ type: "text", text: `pong${props ? ` (signed in as ${props.login})` : ""}` }],
		}),
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
