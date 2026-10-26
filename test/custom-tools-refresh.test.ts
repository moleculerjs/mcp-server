import { describe, it, expect, afterEach, vi } from "vitest";
import { ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { z } from "zod";
import { McpServerMixin } from "../src/index.js";
import type { McpServerMixinOptions } from "../src/index.js";
import { createMcpClient, closeMcpClient, listTools, callTool } from "./mcp-client.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

describe("Custom tools & dynamic refresh", () => {
	let broker: ServiceBroker;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let apiService: any;

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	async function start(options: McpServerMixinOptions) {
		broker = new ServiceBroker({ logger: false });
		apiService = broker.createService({
			name: "api",
			mixins: [ApiGateway, McpServerMixin(options)],
			settings: { port: 0, routes: [] }
		});
		broker.createService({
			name: "math",
			actions: {
				add: {
					params: { a: "number", b: "number" },
					handler: ctx => ctx.params.a + ctx.params.b
				}
			}
		});
		await broker.start();
		const address = (apiService.server as Server).address() as AddressInfo;
		return createMcpClient(`http://localhost:${address.port}/mcp`);
	}

	describe("Custom tools", () => {
		const tools: McpServerMixinOptions["tools"] = [
			{
				name: "sum",
				title: "Sum",
				description: "Sum two numbers",
				input: { a: z.number(), b: z.number() },
				output: { total: z.number() },
				handler: params => ({ total: (params.a as number) + (params.b as number) })
			},
			{
				name: "add_via_action",
				description: "Sum two numbers with the math.add action",
				input: { a: z.number(), b: z.number() },
				handler: "math.add"
			},
			{
				name: "failing",
				description: "Always fails",
				output: { total: z.number() },
				handler: () => {
					throw new Error("Boom");
				}
			}
		];

		it("should register the custom tools", async () => {
			const mcpClient = await start({ tools });
			try {
				const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
				expect(toolNames).toEqual(
					expect.arrayContaining(["sum", "add_via_action", "failing", "math_add"])
				);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should return structuredContent when an output schema is set", async () => {
			const mcpClient = await start({ tools });
			try {
				const result = await callTool(mcpClient, "sum", { a: 2, b: 3 });
				expect(result.isError).toBeFalsy();
				expect(result.structuredContent).toEqual({ total: 5 });
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should call the action when the handler is a string", async () => {
			const mcpClient = await start({ tools });
			try {
				const result = await callTool(mcpClient, "add_via_action", { a: 2, b: 3 });
				expect(result.content[0].text).toBe("5");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should return isError when the handler throws", async () => {
			const mcpClient = await start({ tools });
			try {
				const result = await callTool(mcpClient, "failing", {});
				expect(result.isError).toBe(true);
				expect(result.content[0].text).toContain("Boom");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Dynamic refresh", () => {
		function startWeatherService() {
			broker.createService({
				name: "weather",
				actions: { forecast: { handler: () => "sunny" } }
			});
		}

		it("should expose services started after the session was opened", async () => {
			const mcpClient = await start({ refreshDebounceTime: 50 });
			const notified = vi.fn();
			mcpClient.client.setNotificationHandler(ToolListChangedNotificationSchema, notified);
			try {
				expect((await listTools(mcpClient)).map((t: Tool) => t.name)).not.toContain(
					"weather_forecast"
				);

				startWeatherService();

				await vi.waitFor(
					async () => {
						const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
						expect(toolNames).toContain("weather_forecast");
						expect(toolNames).toContain("math_add");
					},
					{ timeout: 3000, interval: 100 }
				);
				expect(notified).toHaveBeenCalled();

				const result = await callTool(mcpClient, "weather_forecast", {});
				expect(result.content[0].text).toContain("sunny");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should not refresh when refreshDebounceTime is false", async () => {
			const mcpClient = await start({ refreshDebounceTime: false });
			try {
				startWeatherService();
				await new Promise(resolve => setTimeout(resolve, 500));
				const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
				expect(toolNames).not.toContain("weather_forecast");

				// The new sessions see the current actions anyway
				const address = (apiService.server as Server).address() as AddressInfo;
				const newClient = await createMcpClient(`http://localhost:${address.port}/mcp`);
				try {
					const newToolNames = (await listTools(newClient)).map((t: Tool) => t.name);
					expect(newToolNames).toContain("weather_forecast");
				} finally {
					await closeMcpClient(newClient);
				}
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should remove the tools of the stopped services", async () => {
			const mcpClient = await start({ refreshDebounceTime: 50 });
			try {
				expect((await listTools(mcpClient)).map((t: Tool) => t.name)).toContain("math_add");

				await broker.destroyService(broker.getLocalService("math")!);

				await vi.waitFor(
					async () => {
						const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
						expect(toolNames).not.toContain("math_add");
					},
					{ timeout: 3000, interval: 100 }
				);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});
});
