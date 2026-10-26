import { describe, it, expect, afterEach } from "vitest";
import { ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import http from "node:http";
import type { AddressInfo } from "net";
import { McpServerMixin } from "../src/index.js";
import type { McpServerMixinOptions } from "../src/index.js";

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

interface RawResponse {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
}

describe("DNS rebinding protection (allowedOrigins / allowedHosts)", () => {
	let broker: ServiceBroker;
	let port: number;

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	async function start(options: McpServerMixinOptions) {
		broker = new ServiceBroker({ logger: false });
		const api = broker.createService({
			name: "api",
			mixins: [ApiGateway, McpServerMixin(options)],
			settings: { port: 0, routes: [] }
		});
		await broker.start();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		port = ((api as any).server.address() as AddressInfo).port;
	}

	// Raw request, to control the Host and Origin headers
	function request(
		method: string,
		headers: Record<string, string>,
		body?: string
	): Promise<RawResponse> {
		return new Promise((resolve, reject) => {
			const req = http.request(
				{
					host: "127.0.0.1",
					port,
					path: "/mcp",
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
			if (body) req.write(body);
			req.end();
		});
	}

	const initialize = (headers: Record<string, string>) => request("POST", headers, INITIALIZE);

	describe("allowedOrigins", () => {
		const options = { allowedOrigins: ["https://app.example.com"] };

		it("should reject requests from other origins", async () => {
			await start(options);
			const res = await initialize({ Origin: "https://evil.example.com" });
			// Rejected by the moleculer-web CORS check, which uses `allowedOrigins`
			expect(res.status).toBe(403);
			expect(res.body).toContain("ORIGIN_NOT_ALLOWED");
		});

		it("should reject other origins even if the route CORS is overridden", async () => {
			await start({ ...options, routeOptions: { cors: { origin: "*" } } });
			const res = await initialize({ Origin: "https://evil.example.com" });
			expect(res.status).toBe(403);
			expect(JSON.parse(res.body).error.message).toContain("Invalid Origin header");
		});

		it("should accept requests from an allowed origin", async () => {
			await start(options);
			const res = await initialize({ Origin: "https://app.example.com" });
			expect(res.status).toBe(200);
			expect(res.headers["mcp-session-id"]).toBeDefined();
		});

		it("should accept requests without Origin (non-browser clients)", async () => {
			await start(options);
			expect((await initialize({})).status).toBe(200);
		});

		it("should reject GET and DELETE requests from other origins too", async () => {
			await start(options);
			const headers = { Origin: "https://evil.example.com", "mcp-session-id": "x" };
			expect((await request("GET", headers)).status).toBe(403);
			expect((await request("DELETE", headers)).status).toBe(403);
		});

		it("should allow only the allowed origins in CORS", async () => {
			await start(options);
			const res = await request("OPTIONS", {
				Origin: "https://app.example.com",
				"Access-Control-Request-Method": "POST"
			});
			expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");

			const evil = await request("OPTIONS", {
				Origin: "https://evil.example.com",
				"Access-Control-Request-Method": "POST"
			});
			expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
		});
	});

	describe("allowedHosts", () => {
		it("should reject requests to other hosts", async () => {
			await start({ allowedHosts: ["localhost"] });
			const res = await initialize({ Host: "evil.example.com" });
			expect(res.status).toBe(403);
			expect(JSON.parse(res.body).error.message).toContain("Invalid Host header");
		});

		it("should accept allowed hosts, with or without port", async () => {
			await start({ allowedHosts: ["localhost"] });
			expect((await initialize({ Host: `localhost:${port}` })).status).toBe(200);

			await broker.stop();
			await start({ allowedHosts: ["127.0.0.1:1"] });
			// The port must match when the entry has one
			expect((await initialize({ Host: `127.0.0.1:${port}` })).status).toBe(403);
		});
	});

	it("should accept any origin and host by default", async () => {
		await start({});
		const res = await initialize({
			Origin: "https://any.example.com",
			Host: "any.example.com"
		});
		expect(res.status).toBe(200);
	});
});
