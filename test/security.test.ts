import { describe, it, expect, afterEach } from "vitest";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../src/index.js";
import type { McpServerMixinOptions } from "../src/index.js";
import { createMcpClient, closeMcpClient, callTool, listTools } from "./mcp-client.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

describe("Security", () => {
	let broker: ServiceBroker;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let apiService: any;
	let receivedEvents: unknown[];

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	// API gateway whose MCP route authenticates the `Authorization: Bearer <name>` header
	async function start(options: McpServerMixinOptions = {}) {
		receivedEvents = [];
		broker = new ServiceBroker({ logger: false });
		apiService = broker.createService({
			name: "api",
			mixins: [
				ApiGateway,
				McpServerMixin({ ...options, routeOptions: { authentication: true } })
			],
			settings: { port: 0, routes: [] },
			methods: {
				authenticate(ctx: Context<unknown, Record<string, unknown>>, route, req) {
					const auth = req.headers["authorization"] as string | undefined;
					ctx.meta.tenant = "acme";
					return auth ? { name: auth.replace("Bearer ", "") } : null;
				}
			}
		});
		broker.createService({
			name: "whoami",
			actions: {
				get: {
					handler: (ctx: Context<unknown, Record<string, unknown>>) => ({
						user: ctx.meta.user ?? null,
						tenant: ctx.meta.tenant ?? null
					})
				}
			},
			events: {
				"user.seen"(ctx: Context<unknown, Record<string, unknown>>) {
					receivedEvents.push(ctx.meta.user);
				}
			}
		});
		broker.createService({
			name: "admin",
			actions: {
				reset: { mcp: false, handler: () => "reset done" },
				internal: { visibility: "public", handler: () => "internal" },
				status: { handler: () => "ok" }
			}
		});
		await broker.start();
	}

	function connect(headers?: Record<string, string>) {
		const address = (apiService.server as Server).address() as AddressInfo;
		return createMcpClient(`http://localhost:${address.port}/mcp`, headers);
	}

	function parse(result: Awaited<ReturnType<typeof callTool>>) {
		return JSON.parse(result.content[0].text as string);
	}

	describe("ctx.meta forwarding", () => {
		it("should forward the authenticated user to auto-discovered tools", async () => {
			await start();
			const mcpClient = await connect({ Authorization: "Bearer john" });
			try {
				const result = parse(await callTool(mcpClient, "whoami_get", {}));
				expect(result.user).toEqual({ name: "john" });
				// Only the `forwardMeta` keys are forwarded
				expect(result.tenant).toBeNull();
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should use the user of each request, not of the session", async () => {
			await start();
			const john = await connect({ Authorization: "Bearer john" });
			const anonymous = await connect();
			try {
				expect(parse(await callTool(john, "whoami_get", {})).user).toEqual({
					name: "john"
				});
				expect(parse(await callTool(anonymous, "whoami_get", {})).user).toBeNull();
			} finally {
				await closeMcpClient(john);
				await closeMcpClient(anonymous);
			}
		});

		it("should forward the configured meta keys", async () => {
			await start({ forwardMeta: ["user", "tenant"] });
			const mcpClient = await connect({ Authorization: "Bearer john" });
			try {
				const result = parse(await callTool(mcpClient, "whoami_get", {}));
				expect(result).toEqual({ user: { name: "john" }, tenant: "acme" });
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should not forward anything with an empty forwardMeta", async () => {
			await start({ forwardMeta: [] });
			const mcpClient = await connect({ Authorization: "Bearer john" });
			try {
				const result = parse(await callTool(mcpClient, "whoami_get", {}));
				expect(result).toEqual({ user: null, tenant: null });
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should forward the user to the generic tools and custom tools", async () => {
			await start({
				tools: [
					{ name: "via_action", description: "whoami", handler: "whoami.get" },
					{
						name: "via_function",
						description: "whoami",
						handler: (params, broker, meta) => ({ user: meta.user })
					}
				]
			});
			const mcpClient = await connect({ Authorization: "Bearer john" });
			try {
				const call = await callTool(mcpClient, "moleculer_call_action", {
					action: "whoami.get"
				});
				expect(parse(call).user).toEqual({ name: "john" });
				expect(parse(await callTool(mcpClient, "via_action", {})).user).toEqual({
					name: "john"
				});
				expect(parse(await callTool(mcpClient, "via_function", {})).user).toEqual({
					name: "john"
				});

				await callTool(mcpClient, "moleculer_emit_event", { event: "user.seen" });
				expect(receivedEvents).toEqual([{ name: "john" }]);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("moleculer_call_action filters", () => {
		async function callAction(options: McpServerMixinOptions, action: string) {
			await start(options);
			const mcpClient = await connect();
			try {
				return await callTool(mcpClient, "moleculer_call_action", { action });
			} finally {
				await closeMcpClient(mcpClient);
			}
		}

		function expectBlocked(result: Awaited<ReturnType<typeof callTool>>, action: string) {
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(`Action '${action}' is not exposed via MCP`);
		}

		it("should call exposed actions", async () => {
			const result = await callAction({}, "admin.status");
			expect(result.isError).toBeFalsy();
			expect(result.content[0].text).toContain("ok");
		});

		it("should block actions with mcp: false", async () => {
			expectBlocked(await callAction({}, "admin.reset"), "admin.reset");
		});

		it("should block not published actions", async () => {
			expectBlocked(await callAction({}, "admin.internal"), "admin.internal");
		});

		it("should block internal $node actions", async () => {
			expectBlocked(await callAction({}, "$node.list"), "$node.list");
		});

		it("should block actions excluded by excludeActions", async () => {
			const result = await callAction({ excludeActions: ["admin.*"] }, "admin.status");
			expectBlocked(result, "admin.status");
		});

		it("should block services outside the services whitelist", async () => {
			const result = await callAction({ services: ["whoami"] }, "admin.status");
			expectBlocked(result, "admin.status");
		});

		it("should still report unknown actions as ServiceNotFoundError", async () => {
			const result = await callAction({}, "unknown.action");
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("ServiceNotFoundError");
		});
	});

	describe("exposeGenericTools", () => {
		it("should hide moleculer_call_action and moleculer_emit_event when false", async () => {
			await start({ exposeGenericTools: false });
			const mcpClient = await connect();
			try {
				const toolNames = (await listTools(mcpClient)).map(t => t.name);
				expect(toolNames).not.toContain("moleculer_call_action");
				expect(toolNames).not.toContain("moleculer_emit_event");
				// The other tools are not affected
				expect(toolNames).toContain("moleculer_list_actions");
				expect(toolNames).toContain("admin_status");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("allowedEvents", () => {
		it("should emit only the allowed events", async () => {
			await start({ allowedEvents: ["user.*"] });
			const mcpClient = await connect({ Authorization: "Bearer john" });
			try {
				const allowed = await callTool(mcpClient, "moleculer_emit_event", {
					event: "user.seen"
				});
				expect(allowed.isError).toBeFalsy();
				expect(receivedEvents).toHaveLength(1);

				const blocked = await callTool(mcpClient, "moleculer_emit_event", {
					event: "orders.deleted",
					broadcast: true
				});
				expect(blocked.isError).toBe(true);
				expect(blocked.content[0].text).toContain(
					"Event 'orders.deleted' is not allowed via MCP"
				);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Internal events", () => {
		async function emit(options: McpServerMixinOptions, event: string) {
			await start(options);
			const mcpClient = await connect();
			try {
				return await callTool(mcpClient, "moleculer_emit_event", { event });
			} finally {
				await closeMcpClient(mcpClient);
			}
		}

		it("should not emit internal ($) events by default", async () => {
			const result = await emit({}, "$services.changed");
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				"Event '$services.changed' is not allowed via MCP"
			);
		});

		it("should emit internal events matched by allowedEvents", async () => {
			const result = await emit(
				{ allowedEvents: ["$services.changed"] },
				"$services.changed"
			);
			expect(result.isError).toBeFalsy();
		});
	});

	describe("moleculer_list_actions", () => {
		it("should list only the actions callable through MCP", async () => {
			await start({ excludeActions: ["whoami.*"] });
			const mcpClient = await connect();
			try {
				const result = await callTool(mcpClient, "moleculer_list_actions", {});
				const names = JSON.parse(result.content[0].text as string).map(
					(a: { name: string }) => a.name
				);
				expect(names).toContain("admin.status");
				// mcp: false, not published, excluded, internal
				expect(names).not.toContain("admin.reset");
				expect(names).not.toContain("admin.internal");
				expect(names).not.toContain("whoami.get");
				expect(names.some((n: string) => n.startsWith("$"))).toBe(false);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});

	describe("Gateway actions", () => {
		it("should never expose the actions of the gateway service itself", async () => {
			await start();
			const mcpClient = await connect();
			try {
				const toolNames = (await listTools(mcpClient)).map(t => t.name);
				expect(toolNames).not.toContain("api_listAliases");
				expect(toolNames).toContain("admin_status");

				const result = await callTool(mcpClient, "moleculer_call_action", {
					action: "api.listAliases"
				});
				expect(result.isError).toBe(true);
				expect(result.content[0].text).toContain("is not exposed via MCP");
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});
});
