import { describe, it, expect, afterEach, vi } from "vitest";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpServerMixin } from "../src/index.js";
import { convertActionParamsToZod } from "../src/schema-converter.js";
import { createMcpClient, closeMcpClient, callTool, listTools } from "./mcp-client.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

// Count the conversions of the action schemas
vi.mock("../src/schema-converter.js", async importOriginal => {
	const actual = await importOriginal<typeof import("../src/schema-converter.js")>();
	return { ...actual, convertActionParamsToZod: vi.fn(actual.convertActionParamsToZod) };
});

describe("Stateless mode", () => {
	let broker: ServiceBroker;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let apiService: any;
	let url: string;

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	async function start() {
		broker = new ServiceBroker({ logger: false });
		apiService = broker.createService({
			name: "api",
			mixins: [
				ApiGateway,
				McpServerMixin({ stateless: true, routeOptions: { authentication: true } })
			],
			settings: { port: 0, routes: [] },
			methods: {
				authenticate(ctx, route, req) {
					const auth = req.headers["authorization"] as string | undefined;
					return auth ? { name: auth.replace("Bearer ", "") } : null;
				}
			}
		});
		broker.createService({
			name: "greeter",
			actions: {
				hello: { handler: () => "Hello" },
				whoami: { handler: (ctx: Context<unknown, { user?: unknown }>) => ctx.meta.user }
			}
		});
		await broker.start();
		const address = (apiService.server as Server).address() as AddressInfo;
		url = `http://localhost:${address.port}/mcp`;
	}

	// Raw JSON-RPC request with fetch, without any previous initialization
	async function rpc(method: string, params: unknown, init: RequestInit = {}) {
		return fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream"
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			...init
		});
	}

	it("should work with the MCP SDK client without keeping sessions", async () => {
		await start();
		const mcpClient = await createMcpClient(url);
		try {
			const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
			expect(toolNames).toContain("greeter_hello");

			const result = await callTool(mcpClient, "greeter_hello", {});
			expect(result.content[0].text).toContain("Hello");

			expect(apiService.transports.size).toBe(0);
			expect(apiService.mcpSessions.size).toBe(0);
		} finally {
			await closeMcpClient(mcpClient);
		}
	});

	it("should serve requests without a session (any gateway instance can answer)", async () => {
		await start();
		const res = await rpc("tools/call", { name: "greeter_hello", arguments: {} });
		expect(res.status).toBe(200);
		expect(res.headers.get("mcp-session-id")).toBeNull();
		expect(await res.text()).toContain("Hello");
	});

	it("should forward the authenticated user", async () => {
		await start();
		const mcpClient = await createMcpClient(url, { Authorization: "Bearer john" });
		try {
			const result = await callTool(mcpClient, "greeter_whoami", {});
			expect(JSON.parse(result.content[0].text as string)).toEqual({ name: "john" });
		} finally {
			await closeMcpClient(mcpClient);
		}
	});

	it("should reject GET and DELETE with 405", async () => {
		await start();
		for (const method of ["GET", "DELETE"]) {
			const res = await fetch(url, { method, headers: { Accept: "text/event-stream" } });
			expect(res.status, method).toBe(405);
			expect(res.headers.get("allow")).toBe("POST");
		}
	});

	describe("Cache of the action tools", () => {
		async function toolNames(): Promise<string[]> {
			const res = await rpc("tools/list", {});
			const text = await res.text();
			// SSE response: the JSON-RPC message is in the `data:` line
			const data = text.split("\n").find(line => line.startsWith("data: "));
			const message = JSON.parse(data ? data.slice(6) : text);
			return message.result.tools.map((t: Tool) => t.name);
		}

		it("should not convert the action schemas again on each request", async () => {
			await start();
			expect(await toolNames()).toContain("greeter_hello");
			const conversions = vi.mocked(convertActionParamsToZod).mock.calls.length;

			for (let i = 0; i < 3; i++) expect(await toolNames()).toContain("greeter_hello");
			const mcpClient = await createMcpClient(url);
			try {
				await callTool(mcpClient, "greeter_hello", {});
			} finally {
				await closeMcpClient(mcpClient);
			}

			expect(vi.mocked(convertActionParamsToZod).mock.calls.length).toBe(conversions);
		});

		it("should not convert the schemas on a services change without sessions", async () => {
			await start();
			const conversions = vi.mocked(convertActionParamsToZod).mock.calls.length;

			broker.createService({ name: "late", actions: { ping: { handler: () => "pong" } } });
			await broker.waitForServices("late");
			// Longer than the default refresh debounce (1000 ms)
			await new Promise(resolve => setTimeout(resolve, 1200));

			expect(vi.mocked(convertActionParamsToZod).mock.calls.length).toBe(conversions);
			expect(await toolNames()).toContain("late_ping");
		});

		it("should warn about a duplicated tool name once, not on every request", async () => {
			broker = new ServiceBroker({ logger: false });
			const warn = vi.fn();
			const getLogger = broker.getLogger.bind(broker);
			vi.spyOn(broker, "getLogger").mockImplementation((...args) => {
				const logger = getLogger(...args);
				logger.warn = warn;
				return logger;
			});
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin({ stateless: true })],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "dup",
				actions: {
					first: { mcp: { name: "same_name" }, handler: () => "first" },
					second: { mcp: { name: "same_name" }, handler: () => "second" }
				}
			});
			await broker.start();
			url = `http://localhost:${((apiService.server as Server).address() as AddressInfo).port}/mcp`;

			for (let i = 0; i < 3; i++) {
				expect((await toolNames()).filter(name => name === "same_name")).toHaveLength(1);
			}
			const skipped = warn.mock.calls.filter(([message]) =>
				String(message).includes("Skipping tool 'same_name'")
			);
			expect(skipped).toHaveLength(1);
		});

		it("should show the actions of the services started or stopped later", async () => {
			await start();
			expect(await toolNames()).not.toContain("late_ping");

			const late = broker.createService({
				name: "late",
				actions: { ping: { handler: () => "pong" } }
			});
			await broker.waitForServices("late");
			// Without waiting for the refresh debounce of the sessions
			await vi.waitFor(async () => expect(await toolNames()).toContain("late_ping"), {
				timeout: 500
			});

			await broker.destroyService(late);
			await vi.waitFor(async () => expect(await toolNames()).not.toContain("late_ping"), {
				timeout: 500
			});
		});
	});
});
