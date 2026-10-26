import { describe, it, expect, afterEach } from "vitest";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../src/index.js";
import { reservedToolNames } from "../src/tool-generator.js";
import "../src/moleculer-types.js";
import { createMcpClient, closeMcpClient, listTools, callTool } from "./mcp-client.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "http";
import type { AddressInfo } from "net";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getServerUrl(apiService: any): string {
	const address = (apiService.server as Server).address() as AddressInfo;
	return `http://localhost:${address.port}/mcp`;
}

describe("Auto-discovery Integration Tests", () => {
	let broker: ServiceBroker;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let apiService: any;

	afterEach(async () => {
		if (broker?.started) {
			await broker.stop();
		}
	});

	function createBroker() {
		return new ServiceBroker({
			logger: false,
			circuitBreaker: { enabled: false },
			retryPolicy: { enabled: false, retries: 0 }
		});
	}

	describe("Tool name format", () => {
		it("should generate tool names as service_action (dot → underscore)", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).toContain("weather_forecast");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should apply toolNamePrefix", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin({ toolNamePrefix: "mol_" })],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).toContain("mol_weather_forecast");
				expect(toolNames).not.toContain("weather_forecast");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Description", () => {
		it("should use action.description as tool description", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						description: "Get weather forecast for a city",
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const tool = tools.find((t: Tool) => t.name === "weather_forecast");
				expect(tool).toBeDefined();
				expect(tool!.description).toBe("Get weather forecast for a city");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should generate default description when none provided", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const tool = tools.find((t: Tool) => t.name === "weather_forecast");
				expect(tool).toBeDefined();
				expect(tool!.description).toBe("Call the weather.forecast Moleculer action");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Input schema conversion", () => {
		it("should convert action params to Zod input schema", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						params: {
							city: "string",
							days: { type: "number", default: 3 }
						},
						handler(ctx) {
							return { city: ctx.params.city, days: ctx.params.days };
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const tool = tools.find((t: Tool) => t.name === "weather_forecast");
				expect(tool).toBeDefined();
				expect(tool!.inputSchema).toBeDefined();
				expect(tool!.inputSchema.properties).toHaveProperty("city");
				expect(tool!.inputSchema.properties).toHaveProperty("days");
				const properties = tool!.inputSchema.properties as Record<string, { type: string }>;
				expect(properties.city.type).toBe("string");
				expect(properties.days.type).toBe("number");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Service filtering", () => {
		it("should filter by services array", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin({ services: ["weather"] })],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			broker.createService({
				name: "math",
				actions: {
					add: {
						handler() {
							return 0;
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).toContain("weather_forecast");
				expect(toolNames).not.toContain("math_add");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should filter by services glob pattern", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin({ services: "tools.*" })],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "tools.weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			broker.createService({
				name: "other",
				actions: {
					doStuff: {
						handler() {
							return 0;
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).toContain("tools_weather_forecast");
				expect(toolNames).not.toContain("other_doStuff");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("$node.* internal actions filtering", () => {
		it("should not include $node.* internal actions in auto-discovered tools", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				// $node.* internal actions should be filtered out
				const nodeTools = toolNames.filter(
					(name: string) => name.startsWith("$node") || name.startsWith("_node")
				);
				expect(nodeTools).toHaveLength(0);
				// Regular actions should still be present
				expect(toolNames).toContain("weather_forecast");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("excludeActions", () => {
		it("should exclude actions matching glob patterns", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin({ excludeActions: ["api.*"] })],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).toContain("weather_forecast");
				// api.rest should be excluded
				expect(toolNames).not.toContain("api_rest");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("MCP metadata", () => {
		it("should exclude actions with mcp: false", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					},
					internal: {
						mcp: false,
						handler() {
							return "hidden";
						}
					},
					disabled: {
						mcp: { enabled: false, name: "disabled_tool" },
						handler() {
							return "hidden";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).toContain("weather_forecast");
				expect(toolNames).not.toContain("weather_internal");
				// `mcp: { enabled: false }` excludes the action as `mcp: false` does
				expect(toolNames).not.toContain("disabled_tool");
				expect(toolNames).not.toContain("weather_disabled");

				const call = await callTool(mcpClient, "moleculer_call_action", {
					action: "weather.disabled"
				});
				expect(call.isError).toBe(true);
				expect(call.content[0].text).toContain("is not exposed via MCP");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should use mcp.name as custom tool name", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						mcp: { name: "get_forecast" },
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).toContain("get_forecast");
				expect(toolNames).not.toContain("weather_forecast");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should use mcp.description over action.description", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						description: "Basic description",
						mcp: { description: "MCP specific description" },
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const tool = tools.find((t: Tool) => t.name === "weather_forecast");
				expect(tool!.description).toBe("MCP specific description");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should use mcp.annotations as explicit annotations", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						mcp: { annotations: { readOnlyHint: true } },
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const tool = tools.find((t: Tool) => t.name === "weather_forecast");
				expect(tool!.annotations).toBeDefined();
				expect(tool!.annotations!.readOnlyHint).toBe(true);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("REST annotations auto-detect", () => {
		it("should detect GET → readOnly, idempotent", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						rest: "GET /forecast",
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const tool = tools.find((t: Tool) => t.name === "weather_forecast");
				expect(tool!.annotations!.readOnlyHint).toBe(true);
				expect(tool!.annotations!.destructiveHint).toBe(false);
				expect(tool!.annotations!.idempotentHint).toBe(true);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should detect DELETE → destructive, idempotent", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "products",
				actions: {
					remove: {
						rest: "DELETE /products/:id",
						handler() {
							return "deleted";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const tool = tools.find((t: Tool) => t.name === "products_remove");
				expect(tool!.annotations!.readOnlyHint).toBe(false);
				expect(tool!.annotations!.destructiveHint).toBe(true);
				expect(tool!.annotations!.idempotentHint).toBe(true);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("exposeBrokerTools", () => {
		it("should keep broker tools by default", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).toContain("moleculer_list_nodes");
				expect(toolNames).toContain("moleculer_list_services");
				expect(toolNames).toContain("moleculer_list_actions");
				expect(toolNames).toContain("moleculer_list_events");
				expect(toolNames).toContain("moleculer_call_action");
				expect(toolNames).toContain("moleculer_emit_event");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should hide broker tools when exposeBrokerTools: false", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin({ exposeBrokerTools: false })],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				expect(toolNames).not.toContain("moleculer_list_nodes");
				expect(toolNames).not.toContain("moleculer_list_services");
				expect(toolNames).not.toContain("moleculer_list_actions");
				expect(toolNames).not.toContain("moleculer_list_events");
				// call_action and emit_event are always registered (fallback tools)
				expect(toolNames).toContain("moleculer_call_action");
				expect(toolNames).toContain("moleculer_emit_event");
				// Auto-discovered tools should still be there
				expect(toolNames).toContain("weather_forecast");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Tool execution", () => {
		it("should call the Moleculer action and return JSON result", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "math",
				actions: {
					add: {
						params: { a: "number", b: "number" },
						handler(ctx) {
							return ctx.params.a + ctx.params.b;
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const result = await callTool(mcpClient, "math_add", { a: 5, b: 3 });
				expect(result.content).toBeDefined();
				expect(result.content[0].type).toBe("text");
				expect(JSON.parse(result.content[0].text)).toBe(8);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should return error in content on action failure (not throw)", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						params: { city: "string" },
						handler() {
							throw new Error("Service unavailable");
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const result = await callTool(mcpClient, "weather_forecast", { city: "London" });
				expect(result.content).toBeDefined();
				expect(result.content[0].type).toBe("text");
				expect(result.content[0].text).toContain("Error");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Generic tools coexistence", () => {
		it("should keep moleculer_call_action alongside auto-discovered tools", async () => {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({
				name: "weather",
				actions: {
					forecast: {
						handler() {
							return "sunny";
						}
					}
				}
			});
			await broker.start();

			const mcpClient = await createMcpClient(getServerUrl(apiService));
			try {
				const tools = await listTools(mcpClient);
				const toolNames = tools.map((t: Tool) => t.name);
				// Both auto-discovered and generic tools should exist
				expect(toolNames).toContain("weather_forecast");
				expect(toolNames).toContain("moleculer_call_action");
				expect(toolNames).toContain("moleculer_emit_event");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Fork fixes", () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async function startWith(actions: Record<string, any>) {
			broker = createBroker();
			apiService = broker.createService({
				name: "api",
				mixins: [ApiGateway, McpServerMixin()],
				settings: { port: 0, routes: [] }
			});
			broker.createService({ name: "weather", actions });
			await broker.start();
			return createMcpClient(getServerUrl(apiService));
		}

		it("should expose only published actions", async () => {
			const mcpClient = await startWith({
				pub: { handler: () => "ok" },
				explicit: { visibility: "published", handler: () => "ok" },
				pub2: { visibility: "public", handler: () => "ok" },
				prot: { visibility: "protected", handler: () => "ok" },
				priv: { visibility: "private", handler: () => "ok" }
			});
			try {
				const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
				expect(toolNames).toContain("weather_pub");
				expect(toolNames).toContain("weather_explicit");
				expect(toolNames).not.toContain("weather_pub2");
				expect(toolNames).not.toContain("weather_prot");
				expect(toolNames).not.toContain("weather_priv");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should unwrap $$root params before calling the action", async () => {
			const mcpClient = await startWith({
				echo: {
					params: { $$root: true, type: "array", items: "string" },
					handler: (ctx: Context) => ctx.params
				}
			});
			try {
				const result = await callTool(mcpClient, "weather_echo", { $$root: ["a", "b"] });
				expect(result.isError).toBeFalsy();
				expect(JSON.parse(result.content[0].text as string)).toEqual(["a", "b"]);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should flag action errors with isError and hide the stack trace", async () => {
			const mcpClient = await startWith({
				fail: {
					handler() {
						throw new Error("Service unavailable");
					}
				}
			});
			try {
				const result = await callTool(mcpClient, "weather_fail", {});
				expect(result.isError).toBe(true);
				expect(result.content[0].text).toContain("Service unavailable");
				expect(result.content[0].text).not.toContain("stack");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should skip duplicated tool names instead of breaking the session", async () => {
			const mcpClient = await startWith({
				first: { mcp: { name: "same_name" }, handler: () => "first" },
				second: { mcp: { name: "same_name" }, handler: () => "second" },
				clash: { mcp: { name: "moleculer_call_action" }, handler: () => "clash" },
				other: { handler: () => "other" }
			});
			try {
				const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
				expect(toolNames.filter(n => n === "same_name")).toHaveLength(1);
				expect(toolNames).toContain("weather_other");

				const result = await callTool(mcpClient, "moleculer_call_action", {
					action: "weather.other"
				});
				expect(result.content[0].text).toContain("other");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should reserve exactly the names of the tools registered before the actions", async () => {
			const mcpClient = await startWith({});
			try {
				const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
				expect(toolNames.sort()).toEqual(reservedToolNames({}).sort());
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should use mcp.title as tool title", async () => {
			const mcpClient = await startWith({
				forecast: { mcp: { title: "Weather forecast" }, handler: () => "sunny" }
			});
			try {
				const tool = (await listTools(mcpClient)).find(
					(t: Tool) => t.name === "weather_forecast"
				);
				expect(tool?.title).toBe("Weather forecast");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should use action.title as tool title", async () => {
			const mcpClient = await startWith({
				forecast: { title: "Weather forecast", handler: () => "sunny" }
			});
			try {
				const tool = (await listTools(mcpClient)).find(
					(t: Tool) => t.name === "weather_forecast"
				);
				expect(tool?.title).toBe("Weather forecast");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should use mcp.title over action.title", async () => {
			const mcpClient = await startWith({
				forecast: {
					title: "Basic title",
					mcp: { title: "MCP specific title" },
					handler: () => "sunny"
				}
			});
			try {
				const tool = (await listTools(mcpClient)).find(
					(t: Tool) => t.name === "weather_forecast"
				);
				expect(tool?.title).toBe("MCP specific title");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});
});
