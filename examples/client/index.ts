/* eslint-disable @/no-console */
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcp = new Client({
	name: "example-client",
	version: "0.1.0"
});

const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3300/mcp"));

async function main() {
	await mcp.connect(transport);
	const { tools } = await mcp.listTools();
	console.log("Tools:", tools);

	const res = await mcp.callTool({
		name: "greeter_welcome",
		arguments: { name: "John" }
	});
	console.log("greeter_welcome result:", res.content);

	await mcp.close();
}

main().catch(err => {
	console.error("Error in MCP client:", err);
	process.exit(1);
});
