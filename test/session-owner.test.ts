import { describe, it, expect, afterEach } from "vitest";
import { ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../src/index.js";
import type { McpServerMixinOptions } from "../src/index.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

// Users of the tokens: two tokens of alice (e.g. a refreshed one), bob of the same tenant
const USERS: Record<string, Record<string, unknown>> = {
	alice: { id: 1, name: "Alice", tenant: "acme" },
	"alice-refreshed": { id: 1, name: "Alice", tenant: "acme", refreshed: true },
	bob: { id: 2, name: "Bob", tenant: "acme" },
	noid: { name: "No id" }
};

const LIST_TOOLS = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

describe("Sessions bound to their owner", () => {
	let broker: ServiceBroker;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let apiService: any;
	let url: string;

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	async function start(options: McpServerMixinOptions = {}, authentication = true) {
		broker = new ServiceBroker({ logger: false });
		apiService = broker.createService({
			name: "api",
			mixins: [ApiGateway, McpServerMixin({ ...options, routeOptions: { authentication } })],
			settings: { port: 0, routes: [] },
			methods: {
				authenticate(ctx, route, req) {
					const token = (req.headers["authorization"] as string | undefined)?.replace(
						"Bearer ",
						""
					);
					return token ? USERS[token] : null;
				}
			}
		});
		await broker.start();
		const address = (apiService.server as Server).address() as AddressInfo;
		url = `http://localhost:${address.port}/mcp`;
	}

	function headers(token?: string, sessionId?: string): Record<string, string> {
		return {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"MCP-Protocol-Version": "2025-06-18",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
		};
	}

	async function openSession(token?: string): Promise<string> {
		const res = await fetch(url, {
			method: "POST",
			headers: headers(token),
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "test", version: "1.0.0" }
				}
			})
		});
		await res.text();
		expect(res.status).toBe(200);
		const sessionId = res.headers.get("mcp-session-id")!;
		await (
			await fetch(url, {
				method: "POST",
				headers: headers(token, sessionId),
				body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
			})
		).text();
		return sessionId;
	}

	async function listTools(sessionId: string, token?: string): Promise<number> {
		const res = await fetch(url, {
			method: "POST",
			headers: headers(token, sessionId),
			body: JSON.stringify(LIST_TOOLS)
		});
		await res.text();
		return res.status;
	}

	async function send(method: "GET" | "DELETE", sessionId: string, token?: string) {
		const controller = new AbortController();
		const res = await fetch(url, {
			method,
			headers: { ...headers(token, sessionId), Accept: "text/event-stream" },
			signal: controller.signal
		});
		// A valid GET opens a SSE stream that never ends
		controller.abort();
		return res.status;
	}

	it("should reject the requests of another user with 404", async () => {
		await start();
		const sessionId = await openSession("alice");

		expect(await listTools(sessionId, "bob")).toBe(404);
		expect(await send("GET", sessionId, "bob")).toBe(404);
		expect(await send("DELETE", sessionId, "bob")).toBe(404);
		// Initialization requests with the ID of a session of another user are rejected too
		const reinit = await fetch(url, {
			method: "POST",
			headers: headers("bob", sessionId),
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "test", version: "1.0.0" }
				}
			})
		});
		await reinit.text();
		expect(reinit.status).toBe(404);

		// The session of alice is still open
		expect(apiService.mcpSessions.has(sessionId)).toBe(true);
		expect(await listTools(sessionId, "alice")).toBe(200);
	});

	it("should accept another token of the same user (same id)", async () => {
		await start();
		const sessionId = await openSession("alice");
		expect(await listTools(sessionId, "alice-refreshed")).toBe(200);
		expect(await send("DELETE", sessionId, "alice-refreshed")).toBe(200);
		expect(apiService.mcpSessions.has(sessionId)).toBe(false);
	});

	it("should keep the sessions working on a route without authentication", async () => {
		await start({}, false);
		const anonymous = await openSession();
		expect(await listTools(anonymous)).toBe(200);
		// Without authentication `ctx.meta.user` is never set: the header is ignored
		expect(await listTools(anonymous, "alice")).toBe(200);
	});

	it("should bind the sessions to the whole user when it has no id", async () => {
		await start();
		const sessionId = await openSession("noid");
		expect(await listTools(sessionId, "noid")).toBe(200);
		expect(await listTools(sessionId, "alice")).toBe(404);
	});

	it("should use a custom sessionOwner", async () => {
		await start({
			sessionOwner: ctx => (ctx.meta as { user?: { tenant?: string } }).user?.tenant
		});
		const sessionId = await openSession("alice");
		// Same tenant
		expect(await listTools(sessionId, "bob")).toBe(200);
		expect(await listTools(sessionId, "noid")).toBe(404);
	});

	it("should not check the owner when sessionOwner is false", async () => {
		await start({ sessionOwner: false });
		const sessionId = await openSession("alice");
		expect(await listTools(sessionId, "bob")).toBe(200);
	});
});
