import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../src/index.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

// The mcp-remote bridge (devDependency, exact version) used in the README for Claude Desktop
const MCP_REMOTE = path.resolve("node_modules/mcp-remote/dist/proxy.js");

interface RemoteResult {
	responses: Map<number, { result?: Record<string, unknown>; error?: unknown }>;
	stderr: string;
	exitCode: number | null;
}

/**
 * Start mcp-remote as Claude Desktop does (a stdio server), send it the given JSON-RPC
 * messages and collect the responses until all the requests are answered, it exits or the
 * timeout expires. As a real client, each request is sent after the response to the previous
 * one: mcp-remote may lose the messages received while it connects to the server.
 */
function runMcpRemote(
	args: string[],
	env: Record<string, string>,
	messages: Record<string, unknown>[],
	timeout = 15000
): Promise<RemoteResult> {
	const configDir = mkdtempSync(path.join(tmpdir(), "mcp-remote-"));
	const child = spawn(process.execPath, [MCP_REMOTE, ...args], {
		// Its own config dir: no OAuth state of other runs (or of the user)
		env: { ...process.env, ...env, MCP_REMOTE_CONFIG_DIR: configDir },
		stdio: ["pipe", "pipe", "pipe"]
	});
	const responses: RemoteResult["responses"] = new Map();
	const expected = messages.filter(message => message.id != null).length;
	const queue = [...messages];
	let stderr = "";
	let buffer = "";
	let done = false;

	// Send the notifications and the next request
	const sendNext = () => {
		while (queue.length > 0) {
			const message = queue.shift()!;
			child.stdin.write(JSON.stringify(message) + "\n");
			if (message.id != null) return;
		}
	};

	return new Promise(resolve => {
		const finish = (exitCode: number | null) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			child.kill();
			rmSync(configDir, { recursive: true, force: true });
			resolve({ responses, stderr, exitCode });
		};
		const timer = setTimeout(() => finish(null), timeout);
		child.on("exit", code => finish(code));
		child.stderr.on("data", data => (stderr += data));
		child.stdout.on("data", data => {
			buffer += data;
			let index;
			while ((index = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);
				if (!line) continue;
				const message = JSON.parse(line);
				if (message.id == null) continue;
				responses.set(message.id, message);
				if (responses.size === expected) finish(null);
				else sendNext();
			}
		});
		sendNext();
	});
}

const SESSION = [
	{
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "test", version: "1.0.0" }
		}
	},
	{ jsonrpc: "2.0", method: "notifications/initialized" },
	{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
	{
		jsonrpc: "2.0",
		id: 3,
		method: "tools/call",
		params: { name: "greeter_whoami", arguments: {} }
	}
];

describe("Claude Desktop through mcp-remote (README configuration)", () => {
	let broker: ServiceBroker;
	let openUrl: string;
	let secureUrl: string;

	beforeAll(async () => {
		broker = new ServiceBroker({ logger: false });
		const open = broker.createService({
			name: "open",
			mixins: [ApiGateway, McpServerMixin()],
			settings: { port: 0, routes: [] }
		});
		const secure = broker.createService({
			name: "secure",
			mixins: [ApiGateway, McpServerMixin({ routeOptions: { authentication: true } })],
			settings: { port: 0, routes: [] },
			methods: {
				authenticate(ctx, route, req) {
					if (req.headers["authorization"] !== "Bearer secret-token") {
						throw new ApiGateway.Errors.UnAuthorizedError(
							ApiGateway.Errors.ERR_INVALID_TOKEN,
							null
						);
					}
					return { id: "alice" };
				}
			}
		});
		broker.createService({
			name: "greeter",
			actions: {
				whoami: {
					handler: (ctx: Context<unknown, { user?: unknown }>) => ({
						user: ctx.meta.user ?? null
					})
				}
			}
		});
		await broker.start();
		// mcp-remote accepts plain HTTP only for localhost and 127.0.0.1
		const url = (service: unknown) =>
			`http://localhost:${((service as { server: Server }).server.address() as AddressInfo).port}/mcp`;
		openUrl = url(open);
		secureUrl = url(secure);
	});

	afterAll(async () => {
		await broker?.stop();
	});

	function expectWorkingSession(result: RemoteResult, user: unknown) {
		expect(result.responses.get(1)?.result?.serverInfo).toMatchObject({
			name: "Moleculer MCP Server"
		});
		const tools = result.responses.get(2)?.result?.tools as { name: string }[];
		expect(tools.map(tool => tool.name)).toContain("greeter_whoami");
		const call = result.responses.get(3)?.result as {
			content: { text: string }[];
			isError?: boolean;
		};
		expect(call.isError).toBeFalsy();
		expect(JSON.parse(call.content[0].text)).toEqual({ user });
		expect(result.stderr).toContain(
			"Connected to remote server using StreamableHTTPClientTransport"
		);
	}

	it("should work without authentication", async () => {
		expectWorkingSession(await runMcpRemote([openUrl], {}, SESSION), null);
	}, 30000);

	it("should accept 127.0.0.1 over plain HTTP", async () => {
		const url = openUrl.replace("localhost", "127.0.0.1");
		expectWorkingSession(await runMcpRemote([url], {}, SESSION), null);
	}, 30000);

	it("should forward the token of the README configuration (header value in env)", async () => {
		// Literally as in claude_desktop_config.json: mcp-remote replaces `${AUTH_HEADER}`
		const result = await runMcpRemote(
			[secureUrl, "--header", "Authorization:${AUTH_HEADER}"],
			{ AUTH_HEADER: "Bearer secret-token" },
			SESSION
		);
		expectWorkingSession(result, { id: "alice" });
	}, 30000);

	it("should exit with a wrong token, without opening a browser", async () => {
		const result = await runMcpRemote(
			[secureUrl, "--header", "Authorization:${AUTH_HEADER}"],
			{ AUTH_HEADER: "Bearer wrong-token" },
			SESSION
		);
		// The 401 starts the OAuth flow, which the server doesn't support: the client
		// registration fails (404) before the authorization URL is opened
		expect(result.exitCode).toBe(1);
		expect(result.responses.size).toBe(0);
		expect(result.stderr).toContain("Dynamic Client Registration rejected (HTTP 404)");
		expect(result.stderr).not.toContain("Please authorize this client");
	}, 30000);
});
