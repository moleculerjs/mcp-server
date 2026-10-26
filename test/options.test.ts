import { describe, it, expect, afterEach } from "vitest";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import http from "node:http";
import type { AddressInfo } from "net";
import { McpServerMixin } from "../src/index.js";
import type { McpServerMixinOptions } from "../src/index.js";
import { toErrorResult } from "../src/utils.js";
import { createMcpClient, closeMcpClient, callTool, listTools } from "./mcp-client.js";

const INITIALIZE = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "test", version: "1.0.0" }
	}
});

const LIST_TOOLS = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });

interface RawResponse {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
}

describe("Options and route", () => {
	let broker: ServiceBroker;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let apiService: any;
	let port: number;

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	async function start(options: McpServerMixinOptions = {}) {
		broker = new ServiceBroker({ logger: false });
		apiService = broker.createService({
			name: "api",
			mixins: [ApiGateway, McpServerMixin(options)],
			settings: { port: 0, routes: [] }
		});
		broker.createService({
			name: "items",
			version: 2,
			actions: {
				"list-all": { handler: () => [] },
				search: {
					params: { filter: { type: "object" } },
					handler: (ctx: Context<{ filter: unknown }>) => ctx.params.filter
				}
			}
		});
		await broker.start();
		port = (apiService.server.address() as AddressInfo).port;
	}

	function request(
		method: string,
		headers: Record<string, string>,
		body?: string,
		path = "/mcp",
		// Send the headers immediately and the body after this delay (ms), as a slow client
		bodyDelay = 0
	): Promise<RawResponse> {
		return new Promise((resolve, reject) => {
			const req = http.request(
				{
					host: "127.0.0.1",
					port,
					path,
					method,
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json, text/event-stream",
						...headers
					}
				},
				res => {
					let data = "";
					res.on("data", chunk => (data += chunk));
					res.on("end", () =>
						resolve({ status: res.statusCode!, headers: res.headers, body: data })
					);
				}
			);
			req.on("error", reject);
			if (body && bodyDelay) {
				req.setHeader("Content-Length", Buffer.byteLength(body));
				req.flushHeaders();
				setTimeout(() => req.end(body), bodyDelay);
				return;
			}
			if (body) req.write(body);
			req.end();
		});
	}

	const connect = (path = "/mcp") => createMcpClient(`http://localhost:${port}${path}`);

	describe("Mixin options", () => {
		it("should not modify the user options object", async () => {
			const options: McpServerMixinOptions = {
				forwardMeta: ["tenant"],
				routeOptions: { cors: { allowedHeaders: ["Authorization"] } }
			};
			const snapshot = JSON.stringify(options);
			await start(options);
			expect(JSON.stringify(options)).toBe(snapshot);
			expect(options.excludeActions).toBeUndefined();
		});

		it("should support the same mixin in several services", async () => {
			const mixin = McpServerMixin();
			broker = new ServiceBroker({ logger: false });
			const services = ["api1", "api2"].map(name =>
				broker.createService({
					name,
					mixins: [ApiGateway, mixin],
					settings: { port: 0, routes: [] }
				})
			);
			await broker.start();

			for (const service of services) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				port = ((service as any).server.address() as AddressInfo).port;
				const mcpClient = await connect();
				try {
					const names = (await listTools(mcpClient)).map(t => t.name);
					// Each gateway excludes its own actions
					expect(names.some(n => n.startsWith(`${service.name}_`))).toBe(false);
				} finally {
					await closeMcpClient(mcpClient);
				}
			}
		});
	});

	describe("routeOptions", () => {
		it("should disable CORS with cors: false", async () => {
			await start({ routeOptions: { cors: false } });
			const res = await request("OPTIONS", {
				Origin: "https://app.example.com",
				"Access-Control-Request-Method": "POST"
			});
			expect(res.headers["access-control-allow-origin"]).toBeUndefined();
			// Non-browser clients are not affected
			expect((await request("POST", {}, INITIALIZE)).status).toBe(200);
		});

		it("should use a custom path", async () => {
			await start({ routeOptions: { path: "/ai/mcp" } });
			const mcpClient = await connect("/ai/mcp");
			try {
				expect((await listTools(mcpClient)).length).toBeGreaterThan(0);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should keep the CORS headers needed by MCP when the user adds headers", async () => {
			await start({ routeOptions: { cors: { allowedHeaders: ["Authorization"] } } });
			const res = await request("OPTIONS", {
				Origin: "https://app.example.com",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "content-type,authorization"
			});
			const allowed = String(res.headers["access-control-allow-headers"]);
			expect(allowed).toContain("Content-Type");
			expect(allowed).toContain("mcp-session-id");
			expect(allowed).toContain("Authorization");
		});

		it("should not let the user aliases replace the MCP ones", async () => {
			await start({
				routeOptions: {
					aliases: {
						"POST /": (req: unknown, res: http.ServerResponse) => res.end("user"),
						"GET /health": (req: unknown, res: http.ServerResponse) => res.end("ok")
					}
				}
			});
			const mcpClient = await connect();
			try {
				expect((await listTools(mcpClient)).length).toBeGreaterThan(0);
			} finally {
				await closeMcpClient(mcpClient);
			}
			const health = await request("GET", {}, undefined, "/mcp/health");
			expect(health.body).toBe("ok");
		});

		it("should always disable the JSON body parser of the route", async () => {
			await start({ routeOptions: { bodyParsers: { json: true } } });
			const res = await request("POST", {}, INITIALIZE);
			expect(res.status).toBe(200);
			expect(res.headers["mcp-session-id"]).toBeDefined();
		});
	});

	describe("Protocol errors", () => {
		it("should reject a request without session, without keeping a session", async () => {
			await start();
			const res = await request("POST", {}, LIST_TOOLS);
			expect(res.status).toBe(400);
			expect(apiService.transports.size).toBe(0);
			expect(apiService.mcpSessions.size).toBe(0);
		});

		const SESSION_NOT_FOUND = {
			jsonrpc: "2.0",
			error: { code: -32001, message: "Session not found" },
			id: null
		};
		const unknown = { "mcp-session-id": "unknown" };

		it("should reply 404 to the requests of unknown sessions, as the MCP spec requires", async () => {
			await start();
			for (const res of [
				await request("POST", unknown, LIST_TOOLS),
				await request("GET", unknown),
				await request("DELETE", unknown)
			]) {
				expect(res.status).toBe(404);
				expect(JSON.parse(res.body)).toEqual(SESSION_NOT_FOUND);
			}
			expect(apiService.mcpSessions.size).toBe(0);
		});

		it("should reply 400 to GET and DELETE requests without session ID", async () => {
			await start();
			for (const method of ["GET", "DELETE"]) {
				const res = await request(method, {});
				expect(res.status).toBe(400);
				expect(JSON.parse(res.body).id).toBeNull();
			}
		});

		it("should start a new session for an initialization request with an unknown ID", async () => {
			await start();
			const res = await request("POST", unknown, INITIALIZE);
			expect(res.status).toBe(200);
			const sessionId = res.headers["mcp-session-id"] as string;
			expect(sessionId).toBeDefined();
			expect(sessionId).not.toBe("unknown");
			expect(apiService.mcpSessions.has(sessionId)).toBe(true);
		});

		it("should resume with a new session after the old one has been closed", async () => {
			await start();
			const mcpClient = await connect();
			try {
				await apiService.closeMcpSessions();
				// The SDK client gets the 404, as a spec compliant client starts a new session
				await expect(listTools(mcpClient)).rejects.toThrow(/404|Session not found/);
			} finally {
				await closeMcpClient(mcpClient, { terminate: false });
			}
			const fresh = await connect();
			try {
				expect((await listTools(fresh)).length).toBeGreaterThan(0);
			} finally {
				await closeMcpClient(fresh);
			}
		});

		it("should reject invalid or too large bodies of unknown sessions", async () => {
			await start();
			const invalid = await request("POST", unknown, "{not json");
			expect(invalid.status).toBe(400);
			expect(JSON.parse(invalid.body).error.code).toBe(-32700);

			const large = await request("POST", unknown, JSON.stringify({ x: "a".repeat(5e6) }));
			expect(large.status).toBe(413);
		});
	});

	describe("maxSessions", () => {
		const initialize = () => request("POST", {}, INITIALIZE);

		it("should limit the open sessions to 100 by default", async () => {
			await start();
			expect(apiService.mcpOptions.maxSessions).toBe(100);
		});

		it("should reject new sessions over the limit until a session is closed", async () => {
			await start({ maxSessions: 2 });
			const first = await initialize();
			expect(first.status).toBe(200);
			expect((await initialize()).status).toBe(200);

			const rejected = await initialize();
			expect(rejected.status).toBe(503);
			expect(JSON.parse(rejected.body).error.message).toBe(
				"Too many MCP sessions, retry later"
			);
			expect(apiService.mcpSessions.size).toBe(2);

			// The existing sessions still work, and closing one frees a slot
			const sessionId = first.headers["mcp-session-id"] as string;
			expect((await request("DELETE", { "mcp-session-id": sessionId })).status).toBe(200);
			expect((await initialize()).status).toBe(200);
		});

		it("should count the sessions being initialized concurrently", async () => {
			await start({ maxSessions: 2 });
			// Slow bodies: all the requests are being handled before any session is initialized
			const results = await Promise.all(
				Array.from({ length: 6 }, () => request("POST", {}, INITIALIZE, "/mcp", 100))
			);
			const statuses = results.map(r => r.status).sort();
			expect(statuses).toEqual([200, 200, 503, 503, 503, 503]);
			expect(apiService.mcpSessions.size).toBe(2);
		});

		it("should not limit the sessions with null", async () => {
			await start({ maxSessions: null });
			for (let i = 0; i < 5; i++) expect((await initialize()).status).toBe(200);
			expect(apiService.mcpSessions.size).toBe(5);
		});
	});

	describe("Other gateways", () => {
		async function expectGatewayHidden(gatewayName: string) {
			const mcpClient = await connect();
			try {
				const names = (await listTools(mcpClient)).map(t => t.name);
				expect(names.some(n => n.startsWith(`${gatewayName}_`))).toBe(false);
				expect(names).toContain("v2_items_search");

				const call = await callTool(mcpClient, "moleculer_call_action", {
					action: `${gatewayName}.listAliases`
				});
				expect(call.isError).toBe(true);
				expect(call.content[0].text).toContain("is not exposed via MCP");

				const list = await callTool(mcpClient, "moleculer_list_actions", {});
				const actions = JSON.parse(list.content[0].text).map(
					(a: { name: string }) => a.name
				);
				expect(actions).not.toContain(`${gatewayName}.listAliases`);
			} finally {
				await closeMcpClient(mcpClient);
			}
		}

		it("should never expose the actions of the other gateways of the node", async () => {
			broker = new ServiceBroker({ logger: false });
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({ name: "www", mixins: [ApiGateway], settings: { port: 0 } });
			broker.createService({
				name: "items",
				version: 2,
				actions: { search: { params: { filter: "object" }, handler: () => [] } }
			});
			await broker.start();
			port = (apiService.server.address() as AddressInfo).port;
			await expectGatewayHidden("www");
		});

		it("should never expose the actions of the gateways of the other nodes", async () => {
			const transporter = "Fake";
			const remote = new ServiceBroker({ nodeID: "remote", transporter, logger: false });
			remote.createService({ name: "www", mixins: [ApiGateway], settings: { port: 0 } });
			remote.createService({
				name: "items",
				version: 2,
				actions: { search: { params: { filter: "object" }, handler: () => [] } }
			});
			broker = new ServiceBroker({ nodeID: "local", transporter, logger: false });
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			try {
				await remote.start();
				await broker.start();
				await broker.waitForServices(["www", "v2.items"]);
				port = (apiService.server.address() as AddressInfo).port;
				await expectGatewayHidden("www");
			} finally {
				await remote.stop();
			}
		});
	});

	describe("Broker tools", () => {
		it("should work with every combination of their flags", async () => {
			await start();
			const flags: Record<string, string[]> = {
				moleculer_list_nodes: ["onlyAvailable", "withServices"],
				moleculer_list_services: [
					"onlyLocal",
					"onlyAvailable",
					"skipInternal",
					"withActions",
					"withEvents",
					"grouping"
				],
				moleculer_list_actions: [
					"onlyLocal",
					"onlyAvailable",
					"skipInternal",
					"withEndpoints"
				],
				moleculer_list_events: [
					"onlyLocal",
					"onlyAvailable",
					"skipInternal",
					"withEndpoints"
				]
			};
			const mcpClient = await connect();
			const failures: string[] = [];
			try {
				for (const [tool, names] of Object.entries(flags)) {
					for (let mask = 0; mask < 1 << names.length; mask++) {
						const args = Object.fromEntries(
							names.map((name, i) => [name, Boolean(mask & (1 << i))])
						);
						const result = await callTool(mcpClient, tool, args);
						if (result.isError) failures.push(`${tool} ${JSON.stringify(args)}`);
					}
				}
			} finally {
				await closeMcpClient(mcpClient);
			}
			// e.g. `withServices` returned the circular registry items
			expect(failures).toEqual([]);
		});

		it("should never send the service settings and the node config to the LLM", async () => {
			broker = new ServiceBroker({ logger: false });
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "db",
				settings: { mongoUri: "mongodb://admin:S3cret@db:27017" },
				actions: { find: () => [] }
			});
			await broker.start();
			port = (apiService.server.address() as AddressInfo).port;

			const mcpClient = await connect();
			try {
				const services = await callTool(mcpClient, "moleculer_list_services", {});
				const nodes = await callTool(mcpClient, "moleculer_list_nodes", {
					withServices: true
				});
				for (const result of [services, nodes]) {
					expect(result.isError, result.content[0].text).toBeFalsy();
					expect(result.content[0].text).not.toContain("S3cret");
					expect(result.content[0].text).not.toContain('"settings"');
				}
				expect(nodes.content[0].text).not.toContain('"config"');
				// The rest of the information is still there
				const db = JSON.parse(services.content[0].text).find(
					(s: { name: string }) => s.name === "db"
				);
				expect(db).toMatchObject({ name: "db", available: true });
				expect(JSON.parse(nodes.content[0].text)[0].services.length).toBeGreaterThan(0);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Auto-discovered tools", () => {
		it("should use valid tool names for versioned services and special characters", async () => {
			await start();
			const mcpClient = await connect();
			try {
				const names = (await listTools(mcpClient)).map(t => t.name);
				expect(names).toContain("v2_items_list-all");
				for (const name of names) expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should pass free-form object params to the action unchanged", async () => {
			await start();
			const mcpClient = await connect();
			try {
				const tool = (await listTools(mcpClient)).find(t => t.name === "v2_items_search");
				const filter = (tool!.inputSchema.properties as Record<string, object>).filter;
				expect(filter).toMatchObject({ type: "object", additionalProperties: true });

				const result = await callTool(mcpClient, "v2_items_search", {
					filter: { status: "active", price: { $lt: 10 } }
				});
				expect(JSON.parse(result.content[0].text)).toEqual({
					status: "active",
					price: { $lt: 10 }
				});
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	it("should return an error result for errors with circular data", () => {
		const err = Object.assign(new Error("Boom"), { data: {} as Record<string, unknown> });
		err.data.self = err.data;
		const result = toErrorResult(err);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(JSON.stringify(result.content)).toContain("Boom");
	});
});
