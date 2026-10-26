import { describe, it, expect, afterEach } from "vitest";
import { ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpServerMixin } from "../src/index.js";
import { detectActionAnnotations } from "../src/tool-generator.js";
import { createMcpClient, closeMcpClient, listTools } from "./mcp-client.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
};
const DESTRUCTIVE = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: false
};
const IDEMPOTENT = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
};
const DEFAULT = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false
};

describe("detectActionAnnotations", () => {
	it.each([
		["products.find", READ_ONLY],
		["products.list", READ_ONLY],
		["products.get", READ_ONLY],
		["products.count", READ_ONLY],
		["users.getById", READ_ONLY],
		["users.findByEmail", READ_ONLY],
		["users.isActive", READ_ONLY],
		["products.remove", DESTRUCTIVE],
		["products.delete", DESTRUCTIVE],
		["cache.clearAll", DESTRUCTIVE],
		["products.replace", IDEMPOTENT],
		["config.set", IDEMPOTENT],
		["products.create", DEFAULT],
		["products.update", DEFAULT],
		["mail.send", DEFAULT]
	])("%s (no rest)", (name, expected) => {
		expect(detectActionAnnotations(name, {})).toEqual(expected);
	});

	it("should match whole words only", () => {
		// "getaway" and "listener" don't start with the "get"/"list" verbs
		expect(detectActionAnnotations("travel.getaway", {})).toEqual(DEFAULT);
		expect(detectActionAnnotations("bus.listener", {})).toEqual(DEFAULT);
		expect(detectActionAnnotations("users.settle", {})).toEqual(DEFAULT);
	});

	it("should read the method of object and array rest definitions", () => {
		expect(detectActionAnnotations("a.b", { rest: { method: "GET", path: "/" } })).toEqual(
			READ_ONLY
		);
		expect(
			detectActionAnnotations("a.b", {
				rest: [
					{ method: "DELETE", path: "/" },
					{ method: "GET", path: "/x" }
				]
			})
		).toEqual(DESTRUCTIVE);
		expect(detectActionAnnotations("a.b", { rest: ["PUT /x", "GET /y"] })).toEqual(IDEMPOTENT);
	});

	it("should fall back to the name when rest has no method", () => {
		// Only a path (all methods) or an empty definition
		expect(detectActionAnnotations("products.find", { rest: "/search" })).toEqual(READ_ONLY);
		expect(detectActionAnnotations("products.find", { rest: { path: "/" } })).toEqual(
			READ_ONLY
		);
		expect(detectActionAnnotations("products.remove", { rest: [] })).toEqual(DESTRUCTIVE);
	});

	it("should prefer the REST method over the name", () => {
		expect(detectActionAnnotations("products.find", { rest: "POST /search" })).toEqual(DEFAULT);
		expect(detectActionAnnotations("products.create", { rest: "GET /new" })).toEqual(READ_ONLY);
	});
});

describe("Annotations from action names (integration)", () => {
	let broker: ServiceBroker;

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	it("should expose the detected annotations, with mcp.annotations on top", async () => {
		broker = new ServiceBroker({ logger: false });
		const api = broker.createService({
			name: "api",
			mixins: [ApiGateway, McpServerMixin()],
			settings: { port: 0, routes: [] }
		});
		broker.createService({
			name: "products",
			actions: {
				find: { handler: () => [] },
				remove: { handler: () => null },
				purgeAll: { mcp: { annotations: { idempotentHint: false } }, handler: () => null }
			}
		});
		await broker.start();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const address = ((api as any).server as Server).address() as AddressInfo;
		const mcpClient = await createMcpClient(`http://localhost:${address.port}/mcp`);
		try {
			const tools = await listTools(mcpClient);
			const annotations = (name: string) =>
				tools.find((t: Tool) => t.name === name)?.annotations;

			expect(annotations("products_find")).toEqual(READ_ONLY);
			expect(annotations("products_remove")).toEqual(DESTRUCTIVE);
			expect(annotations("products_purgeAll")).toEqual({
				...DESTRUCTIVE,
				idempotentHint: false
			});
		} finally {
			await closeMcpClient(mcpClient);
		}
	});
});
