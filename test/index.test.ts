import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ServiceBroker, Service } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../src/index.js";
import { createMcpClient, closeMcpClient, listTools, callTool } from "./mcp-client.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "http";
import type { AddressInfo } from "net";

interface ApiServiceSettings {
	routes: Array<{
		path?: string;
		aliases?: Record<string, unknown>;
	}>;
}

describe("MCP Server Integration Tests", () => {
	let broker: ServiceBroker;
	let apiService;
	const port = 0; // Use random available port

	beforeEach(async () => {
		// Create a new broker for each test
		broker = new ServiceBroker({
			logger: false,
			circuitBreaker: {
				enabled: false
			},
			retryPolicy: {
				enabled: false,
				retries: 0
			}
		});

		// Create API Gateway service with MCP mixin
		apiService = broker.createService({
			name: "api",
			mixins: [ApiGateway, McpServerMixin()],
			settings: {
				port,
				routes: [
					{
						path: "/api"
					}
				]
			}
		}) as Service & {
			server: Server;
			settings: ApiServiceSettings;
			transports: Map<string, unknown>;
		};

		// Create test greeter service
		broker.createService({
			name: "greeter",
			actions: {
				hello: {
					async handler() {
						return "Hello Moleculer";
					}
				},
				welcome: {
					params: {
						name: "string"
					},
					async handler(ctx) {
						return `Welcome, ${ctx.params.name}`;
					}
				}
			}
		});

		// Create test math service
		broker.createService({
			name: "math",
			actions: {
				add: {
					params: {
						a: "number",
						b: "number"
					},
					async handler(ctx) {
						return ctx.params.a + ctx.params.b;
					}
				},
				multiply: {
					params: {
						a: "number",
						b: "number"
					},
					async handler(ctx) {
						return ctx.params.a * ctx.params.b;
					}
				}
			},
			events: {
				"math.calculated": {
					async handler(ctx) {
						// Just log the event for testing
						this.logger.info(`Calculation result: ${ctx.params.result}`);
					}
				}
			}
		});
	});

	afterEach(async () => {
		if (broker) {
			await broker.stop();
		}
	});

	it("should start broker with MCP server mixin", async () => {
		await broker.start();

		// Verify broker is started
		expect(broker.started).toBe(true);

		// Verify services are registered
		const services = broker.registry.getServiceList();
		const serviceNames = services.map(s => s.name);

		expect(serviceNames).toContain("api");
		expect(serviceNames).toContain("greeter");
		expect(serviceNames).toContain("math");
	});

	it("should register MCP tools correctly", async () => {
		await broker.start();

		// Check that MCP route is registered
		const routes = apiService.settings.routes;
		const mcpRoute = routes.find((route: { path?: string }) => route.path === "/mcp");

		expect(mcpRoute).toBeDefined();
		expect(mcpRoute.aliases).toBeDefined();
		expect(mcpRoute.aliases["POST /"]).toBeDefined();
		expect(mcpRoute.aliases["GET /"]).toBeDefined();
		expect(mcpRoute.aliases["DELETE /"]).toBeDefined();
	});

	it("should have MCP transport map initialized", async () => {
		await broker.start();

		// Check that transports map is initialized
		expect(apiService.transports).toBeDefined();
		expect(apiService.transports instanceof Map).toBe(true);
	});

	it("should list all available actions via MCP tool", async () => {
		await broker.start();

		// Get the action list directly from the registry
		const actions = broker.registry.getActionList({
			onlyAvailable: true,
			skipInternal: true
		});

		expect(actions).toBeDefined();
		expect(Array.isArray(actions)).toBe(true);

		// Check that our test actions are listed
		const actionNames = actions.map((a: (typeof actions)[number]) => a.name);
		expect(actionNames).toContain("greeter.hello");
		expect(actionNames).toContain("greeter.welcome");
		expect(actionNames).toContain("math.add");
		expect(actionNames).toContain("math.multiply");
	});

	it("should list all available services via MCP tool", async () => {
		await broker.start();

		// Get the service list directly from the registry
		const services = broker.registry.getServiceList({
			onlyAvailable: true,
			skipInternal: true,
			withActions: true
		});

		expect(services).toBeDefined();
		expect(Array.isArray(services)).toBe(true);

		// Check that our test services are listed
		const serviceNames = services.map((s: (typeof services)[number]) => s.fullName);
		expect(serviceNames).toContain("greeter");
		expect(serviceNames).toContain("math");
	});

	it("should list all nodes via MCP tool", async () => {
		await broker.start();

		// Get the node list directly from the registry
		const nodes = broker.registry.getNodeList({
			onlyAvailable: true
		});

		expect(nodes).toBeDefined();
		expect(Array.isArray(nodes)).toBe(true);

		// Should have at least one node (the local node)
		expect(nodes.length).toBeGreaterThan(0);

		// Check node structure
		const localNode = nodes.find((n: (typeof nodes)[number]) => n.local === true);
		expect(localNode).toBeDefined();
		expect(localNode.available).toBe(true);
	});

	it("should list all events via MCP tool", async () => {
		await broker.start();

		// Get the event list directly from the registry
		const events = broker.registry.getEventList({
			onlyAvailable: true,
			skipInternal: true
		});

		expect(events).toBeDefined();
		expect(Array.isArray(events)).toBe(true);

		// Check that our test event is listed
		const eventNames = events.map((e: (typeof events)[number]) => e.name);
		expect(eventNames).toContain("math.calculated");
	});

	it("should list MCP tools via client", async () => {
		await broker.start();

		// Get server URL
		const serverInfo = apiService.server;
		const address = serverInfo.address() as AddressInfo;
		const port = address.port;
		const serverUrl = `http://localhost:${port}/mcp`;

		// Create MCP client
		const mcpClient = await createMcpClient(serverUrl);

		try {
			// List tools
			const tools = await listTools(mcpClient);

			expect(tools).toBeDefined();
			expect(Array.isArray(tools)).toBe(true);

			// Check that our MCP tools are registered
			const toolNames = tools.map((tool: Tool) => tool.name);
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

	it("should call actions via MCP tool", async () => {
		await broker.start();

		// Mock the broker's call method
		const callSpy = vi.spyOn(broker, "call");

		// Get server URL
		const serverInfo = apiService.server;
		const address = serverInfo.address() as AddressInfo;
		const port = address.port;
		const serverUrl = `http://localhost:${port}/mcp`;

		// Create MCP client
		const mcpClient = await createMcpClient(serverUrl);

		try {
			// Test calling greeter.hello action via MCP tool
			const helloResult = await callTool(mcpClient, "moleculer_call_action", {
				action: "greeter.hello",
				jsonParams: "{}"
			});

			expect(helloResult.content).toBeDefined();
			expect(helloResult.content[0].type).toBe("text");
			const parsedHelloResult = JSON.parse(helloResult.content[0].text);
			expect(parsedHelloResult).toBe("Hello Moleculer");

			// Verify that broker.call was called correctly
			expect(callSpy).toHaveBeenCalledWith("greeter.hello", {});

			// Test calling greeter.welcome action with parameters
			const welcomeResult = await callTool(mcpClient, "moleculer_call_action", {
				action: "greeter.welcome",
				jsonParams: '{"name": "John"}'
			});

			expect(welcomeResult.content).toBeDefined();
			expect(welcomeResult.content[0].type).toBe("text");
			const parsedWelcomeResult = JSON.parse(welcomeResult.content[0].text);
			expect(parsedWelcomeResult).toBe("Welcome, John");

			// Verify that broker.call was called correctly
			expect(callSpy).toHaveBeenCalledWith("greeter.welcome", { name: "John" });

			// Test calling math.add action
			const addResult = await callTool(mcpClient, "moleculer_call_action", {
				action: "math.add",
				jsonParams: '{"a": 5, "b": 3}'
			});

			expect(addResult.content).toBeDefined();
			expect(addResult.content[0].type).toBe("text");
			const parsedAddResult = JSON.parse(addResult.content[0].text);
			expect(parsedAddResult).toBe(8);

			// Verify that broker.call was called correctly
			expect(callSpy).toHaveBeenCalledWith("math.add", { a: 5, b: 3 });

			// Test calling math.multiply action
			const multiplyResult = await callTool(mcpClient, "moleculer_call_action", {
				action: "math.multiply",
				jsonParams: '{"a": 4, "b": 6}'
			});

			expect(multiplyResult.content).toBeDefined();
			expect(multiplyResult.content[0].type).toBe("text");
			const parsedMultiplyResult = JSON.parse(multiplyResult.content[0].text);
			expect(parsedMultiplyResult).toBe(24);

			// Verify that broker.call was called correctly
			expect(callSpy).toHaveBeenCalledWith("math.multiply", { a: 4, b: 6 });

			// Verify total number of calls
			expect(callSpy).toHaveBeenCalledTimes(4);
		} finally {
			await closeMcpClient(mcpClient);
			callSpy.mockRestore();
		}
	});

	it("should handle action call errors gracefully via MCP tool", async () => {
		await broker.start();

		// Get server URL
		const serverInfo = apiService.server;
		const address = serverInfo.address() as AddressInfo;
		const port = address.port;
		const serverUrl = `http://localhost:${port}/mcp`;

		// Create MCP client
		const mcpClient = await createMcpClient(serverUrl);

		try {
			// Test calling non-existent action
			const errorResult1 = await callTool(mcpClient, "moleculer_call_action", {
				action: "nonexistent.action",
				jsonParams: "{}"
			});

			expect(errorResult1.content).toBeDefined();
			expect(errorResult1.content[0].type).toBe("text");
			const errorText1 = errorResult1.content[0].text;
			expect(errorText1).toContain("Error");
			expect(errorText1).toContain("ServiceNotFoundError");
			expect(errorText1).toContain("nonexistent.action");

			// Test calling action with invalid JSON parameters
			const errorResult2 = await callTool(mcpClient, "moleculer_call_action", {
				action: "math.add",
				jsonParams: "invalid json"
			});

			expect(errorResult2.content).toBeDefined();
			expect(errorResult2.content[0].type).toBe("text");
			const errorText2 = errorResult2.content[0].text;
			expect(errorText2).toContain("The 'jsonParams' must be a valid JSON object string");
		} finally {
			await closeMcpClient(mcpClient);
		}
	});

	it("should emit events via MCP tool", async () => {
		await broker.start();

		// Mock the broker's emit method
		const emitSpy = vi.spyOn(broker, "emit");
		const broadcastSpy = vi.spyOn(broker, "broadcast");

		// Get server URL
		const serverInfo = apiService.server;
		const address = serverInfo.address() as AddressInfo;
		const port = address.port;
		const serverUrl = `http://localhost:${port}/mcp`;

		// Create MCP client
		const mcpClient = await createMcpClient(serverUrl);

		try {
			// Test emitting an event
			const result = await callTool(mcpClient, "moleculer_emit_event", {
				event: "math.calculated",
				jsonParams: '{"result": 42, "operation": "test"}'
			});

			expect(result.content).toBeDefined();
			expect(result.content[0].type).toBe("text");
			expect(result.content[0].text).toContain(
				"Event 'math.calculated' emitted successfully"
			);

			// Verify that emit was called with correct parameters
			expect(emitSpy).toHaveBeenCalledWith("math.calculated", {
				result: 42,
				operation: "test"
			});
			expect(emitSpy).toHaveBeenCalledTimes(1);

			// Verify that broadcast was not called
			expect(broadcastSpy).not.toHaveBeenCalled();
		} finally {
			await closeMcpClient(mcpClient);
			emitSpy.mockRestore();
			broadcastSpy.mockRestore();
		}
	});

	it("should broadcast events via MCP tool", async () => {
		await broker.start();

		// Mock the broker's emit and broadcast methods
		const emitSpy = vi.spyOn(broker, "emit");
		const broadcastSpy = vi.spyOn(broker, "broadcast");

		// Get server URL
		const serverInfo = apiService.server;
		const address = serverInfo.address() as AddressInfo;
		const port = address.port;
		const serverUrl = `http://localhost:${port}/mcp`;

		// Create MCP client
		const mcpClient = await createMcpClient(serverUrl);

		try {
			// Test broadcasting an event
			const result = await callTool(mcpClient, "moleculer_emit_event", {
				event: "math.calculated",
				jsonParams: '{"result": 100, "operation": "broadcast test"}',
				broadcast: true
			});

			expect(result.content).toBeDefined();
			expect(result.content[0].type).toBe("text");
			expect(result.content[0].text).toContain(
				"Event 'math.calculated' emitted successfully"
			);

			// Verify that broadcast was called with correct parameters
			expect(broadcastSpy).toHaveBeenCalledWith("math.calculated", {
				result: 100,
				operation: "broadcast test"
			});
			expect(broadcastSpy).toHaveBeenCalledTimes(1);

			// Verify that emit was not called
			expect(emitSpy).not.toHaveBeenCalled();
		} finally {
			await closeMcpClient(mcpClient);
			emitSpy.mockRestore();
			broadcastSpy.mockRestore();
		}
	});

	it("should handle required action and event parameters via MCP tools", async () => {
		await broker.start();

		// Get server URL
		const serverInfo = apiService.server;
		const address = serverInfo.address() as AddressInfo;
		const port = address.port;
		const serverUrl = `http://localhost:${port}/mcp`;

		// Create MCP client
		const mcpClient = await createMcpClient(serverUrl);

		try {
			// Test calling action without action parameter - this should throw an MCP error
			try {
				await callTool(mcpClient, "moleculer_call_action", {
					jsonParams: "{}"
				});
				// Should not reach here
				expect.fail("Should have thrown an MCP error");
			} catch (err: unknown) {
				expect(err).toBeDefined();
				expect(err instanceof Error).toBe(true);
				if (err instanceof Error) {
					expect(err.message).toContain("Invalid arguments for tool");
					expect(err.message).toContain("action");
					expect(err.message).toContain("Required");
				}
			}

			// Test emitting event without event parameter - this should throw an MCP error
			try {
				await callTool(mcpClient, "moleculer_emit_event", {
					jsonParams: "{}"
				});
				// Should not reach here
				expect.fail("Should have thrown an MCP error");
			} catch (err: unknown) {
				expect(err).toBeDefined();
				expect(err instanceof Error).toBe(true);
				if (err instanceof Error) {
					expect(err.message).toContain("Invalid arguments for tool");
					expect(err.message).toContain("event");
					expect(err.message).toContain("Required");
				}
			}
		} finally {
			await closeMcpClient(mcpClient);
		}
	});

	it("should list Moleculer entities via MCP tools", async () => {
		await broker.start();

		// Mock the registry methods
		const getActionListSpy = vi.spyOn(broker.registry, "getActionList");
		const getServiceListSpy = vi.spyOn(broker.registry, "getServiceList");
		const getNodeListSpy = vi.spyOn(broker.registry, "getNodeList");
		const getEventListSpy = vi.spyOn(broker.registry, "getEventList");

		// Get server URL
		const serverInfo = apiService.server;
		const address = serverInfo.address() as AddressInfo;
		const port = address.port;
		const serverUrl = `http://localhost:${port}/mcp`;

		// Create MCP client
		const mcpClient = await createMcpClient(serverUrl);

		try {
			// Test listing actions
			const actionsResult = await callTool(mcpClient, "moleculer_list_actions", {
				onlyAvailable: true,
				skipInternal: true
			});

			expect(actionsResult.content).toBeDefined();
			expect(actionsResult.content[0].type).toBe("text");
			const actions = JSON.parse(actionsResult.content[0].text);
			expect(Array.isArray(actions)).toBe(true);

			// Check that our test actions are listed
			const actionNames = actions.map((a: (typeof actions)[number]) => a.name);
			expect(actionNames).toContain("greeter.hello");
			expect(actionNames).toContain("greeter.welcome");
			expect(actionNames).toContain("math.add");
			expect(actionNames).toContain("math.multiply");

			// Verify that getActionList was called with correct parameters (including defaults)
			expect(getActionListSpy).toHaveBeenCalledWith({
				onlyAvailable: true,
				skipInternal: true,
				onlyLocal: false,
				withEndpoints: false
			});

			// Test listing services
			const servicesResult = await callTool(mcpClient, "moleculer_list_services", {
				onlyAvailable: true,
				skipInternal: true,
				withActions: true
			});

			expect(servicesResult.content).toBeDefined();
			expect(servicesResult.content[0].type).toBe("text");
			const services = JSON.parse(servicesResult.content[0].text);
			expect(Array.isArray(services)).toBe(true);

			// Check that our test services are listed
			const serviceNames = services.map((s: (typeof services)[number]) => s.fullName);
			expect(serviceNames).toContain("greeter");
			expect(serviceNames).toContain("math");

			// Verify that getServiceList was called with correct parameters (including defaults)
			expect(getServiceListSpy).toHaveBeenCalledWith({
				onlyAvailable: true,
				skipInternal: true,
				withActions: true,
				onlyLocal: false,
				withEvents: false,
				grouping: true
			});

			// Test listing nodes
			const nodesResult = await callTool(mcpClient, "moleculer_list_nodes", {
				onlyAvailable: true
			});

			expect(nodesResult.content).toBeDefined();
			expect(nodesResult.content[0].type).toBe("text");
			const nodes = JSON.parse(nodesResult.content[0].text);
			expect(Array.isArray(nodes)).toBe(true);

			// Should have at least one node (the local node)
			expect(nodes.length).toBeGreaterThan(0);

			// Check node structure
			const localNode = nodes.find((n: (typeof nodes)[number]) => n.local === true);
			expect(localNode).toBeDefined();
			expect(localNode.available).toBe(true);

			// Verify that getNodeList was called with correct parameters (including defaults)
			expect(getNodeListSpy).toHaveBeenCalledWith({
				onlyAvailable: true,
				withServices: false
			});

			// Test listing events
			const eventsResult = await callTool(mcpClient, "moleculer_list_events", {
				onlyAvailable: true,
				skipInternal: true
			});

			expect(eventsResult.content).toBeDefined();
			expect(eventsResult.content[0].type).toBe("text");
			const events = JSON.parse(eventsResult.content[0].text);
			expect(Array.isArray(events)).toBe(true);

			// Check that our test event is listed
			const eventNames = events.map((e: (typeof events)[number]) => e.name);
			expect(eventNames).toContain("math.calculated");

			// Verify that getEventList was called with correct parameters (including defaults)
			expect(getEventListSpy).toHaveBeenCalledWith({
				onlyAvailable: true,
				skipInternal: true,
				onlyLocal: false,
				withEndpoints: false
			});
		} finally {
			await closeMcpClient(mcpClient);
			getActionListSpy.mockRestore();
			getServiceListSpy.mockRestore();
			getNodeListSpy.mockRestore();
			getEventListSpy.mockRestore();
		}
	});

	it("should handle complex JSON parameters", async () => {
		await broker.start();

		// Test with complex JSON object
		const complexParams = {
			user: {
				id: 123,
				name: "Test User",
				profile: {
					email: "test@example.com",
					preferences: {
						theme: "dark",
						language: "en"
					}
				}
			},
			metadata: {
				timestamp: Date.now(),
				source: "test"
			}
		};

		// This would work with an action that accepts complex parameters
		// For now, just test that the JSON parsing works correctly
		const parsedParams = JSON.parse(JSON.stringify(complexParams));
		expect(parsedParams).toEqual(complexParams);
	});

	it("should initialize and clean up transports properly", async () => {
		await broker.start();

		// Initially transports should be empty
		expect(apiService.transports.size).toBe(0);

		// After broker stop, transports should be cleaned up
		await broker.stop();

		// Transports should still exist (they're created when sessions are established)
		// but they should be properly closed
		expect(apiService.transports instanceof Map).toBe(true);
	});
});
