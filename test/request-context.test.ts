import { describe, it, expect, afterEach } from "vitest";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../src/index.js";
import { createMcpClient, closeMcpClient, callTool } from "./mcp-client.js";
import type { AddressInfo } from "net";

interface CallInfo {
	requestID: string | null;
	parentID: string | null;
	caller: string | null;
	tracing: boolean | null;
	meta: Record<string, unknown>;
}

function callInfo(ctx: Context): CallInfo {
	return {
		requestID: ctx.requestID,
		parentID: ctx.parentID,
		caller: ctx.caller,
		tracing: ctx.tracing,
		meta: ctx.meta as Record<string, unknown>
	};
}

describe("Context of the HTTP request", () => {
	let broker: ServiceBroker;
	let events: CallInfo[];
	// Span (or context) IDs of the HTTP requests of the MCP route
	let requestContextIDs: string[];

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	async function start(tracing = false) {
		events = [];
		requestContextIDs = [];
		broker = new ServiceBroker({ logger: false, tracing: { enabled: tracing, exporter: [] } });
		const api = broker.createService({
			name: "api",
			mixins: [
				ApiGateway,
				McpServerMixin({
					tools: [
						{ name: "via_action", description: "Info", handler: "info.get" },
						{
							name: "via_function",
							description: "Info",
							handler: (params, broker, meta, callOptions) =>
								broker.call("info.get", {}, callOptions)
						}
					],
					routeOptions: {
						authentication: true,
						onBeforeCall(ctx: Context) {
							requestContextIDs.push(ctx.span?.id ?? ctx.id);
						}
					}
				})
			],
			settings: { port: 0, routes: [] },
			methods: {
				authenticate(ctx: Context<unknown, Record<string, unknown>>) {
					// Not in `forwardMeta`: must not reach the actions
					ctx.meta.secret = "request only";
					return { name: "john" };
				}
			}
		});
		broker.createService({
			name: "info",
			actions: { get: { handler: (ctx: Context) => callInfo(ctx) } },
			events: {
				"info.seen"(ctx: Context) {
					events.push(callInfo(ctx));
				}
			}
		});
		await broker.start();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { port } = (api as any).server.address() as AddressInfo;
		return createMcpClient(`http://localhost:${port}/mcp`, { "X-Request-ID": "req-123" });
	}

	function expectLinked(info: CallInfo) {
		expect(info.requestID).toBe("req-123");
		expect(info.caller).toBe("api");
		expect(requestContextIDs).toContain(info.parentID);
		expect(info.meta).toEqual({ user: { name: "john" } });
	}

	it("should link the calls of every kind of tool to the HTTP request", async () => {
		const mcpClient = await start();
		try {
			for (const [tool, args] of [
				["info_get", {}],
				["moleculer_call_action", { action: "info.get" }],
				["via_action", {}],
				["via_function", {}]
			] as const) {
				const result = await callTool(mcpClient, tool, args);
				expect(result.isError, tool).toBeFalsy();
				expectLinked(JSON.parse(result.content[0].text));
			}

			await callTool(mcpClient, "moleculer_emit_event", { event: "info.seen" });
			expect(events).toHaveLength(1);
			expectLinked(events[0]);
		} finally {
			await closeMcpClient(mcpClient);
		}
	});

	it("should make the calls child spans of the HTTP request when tracing is enabled", async () => {
		const mcpClient = await start(true);
		try {
			const info: CallInfo = JSON.parse(
				(await callTool(mcpClient, "info_get", {})).content[0].text
			);
			expect(info.tracing).toBe(true);
			expectLinked(info);
		} finally {
			await closeMcpClient(mcpClient);
		}
	});
});
