import { describe, it, expect, afterEach } from "vitest";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../src/index.js";
import type { McpServerMixinOptions } from "../src/index.js";
import { toTextResult } from "../src/utils.js";
import { createMcpClient, closeMcpClient, callTool } from "./mcp-client.js";
import type { Server } from "http";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { AddressInfo } from "net";

describe("callOptions & maxResultLength", () => {
	let broker: ServiceBroker;

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
		broker.createService({
			name: "test",
			actions: {
				slow: {
					handler: () => new Promise(resolve => setTimeout(() => resolve("done"), 500))
				},
				meta: { handler: (ctx: Context) => ctx.meta },
				big: { handler: () => Array.from({ length: 1000 }, (_, i) => ({ id: i })) }
			}
		});
		await broker.start();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const address = ((api as any).server as Server).address() as AddressInfo;
		return createMcpClient(`http://localhost:${address.port}/mcp`);
	}

	describe("callOptions", () => {
		it("should apply the timeout to auto-discovered tools and moleculer_call_action", async () => {
			const mcpClient = await start({ callOptions: { timeout: 100 } });
			try {
				const auto = await callTool(mcpClient, "test_slow", {});
				expect(auto.isError).toBe(true);
				expect(auto.content[0].text).toContain("RequestTimeoutError");

				const generic = await callTool(mcpClient, "moleculer_call_action", {
					action: "test.slow"
				});
				expect(generic.isError).toBe(true);
				expect(generic.content[0].text).toContain("RequestTimeoutError");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should not apply a timeout by default", async () => {
			const mcpClient = await start({});
			try {
				const result = await callTool(mcpClient, "test_slow", {});
				expect(result.content[0].text).toContain("done");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should merge the callOptions meta", async () => {
			const mcpClient = await start({ callOptions: { meta: { source: "mcp" } } });
			try {
				const result = await callTool(mcpClient, "test_meta", {});
				expect(JSON.parse(result.content[0].text as string)).toEqual({ source: "mcp" });
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("maxResultLength", () => {
		it("should truncate long results with a note", async () => {
			const mcpClient = await start({ maxResultLength: 500 });
			try {
				const result = await callTool(mcpClient, "test_big", {});
				const text = result.content[0].text as string;
				expect(text).toContain("[Result truncated: 500 of ");
				expect(text.length).toBeLessThan(700);
				expect(result.isError).toBeFalsy();
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should truncate the broker tools results too", async () => {
			const mcpClient = await start({ maxResultLength: 200 });
			try {
				const result = await callTool(mcpClient, "moleculer_list_services", {});
				expect(result.content[0].text).toContain("[Result truncated: 200 of ");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should not truncate by default", async () => {
			const mcpClient = await start({});
			try {
				const result = await callTool(mcpClient, "test_big", {});
				expect(JSON.parse(result.content[0].text as string)).toHaveLength(1000);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("toTextResult", () => {
		it("should keep short results unchanged", () => {
			expect(toTextResult({ a: 1 }, 100).content[0]).toEqual({
				type: "text",
				text: JSON.stringify({ a: 1 }, null, 2)
			});
		});

		it("should keep the first maxLength characters", () => {
			const text = (toTextResult("x".repeat(50), 10).content[0] as TextContent).text;
			expect(text.startsWith('"xxxxxxxxx')).toBe(true);
			expect(text).toContain("[Result truncated: 10 of 52 characters.");
		});
	});
});
