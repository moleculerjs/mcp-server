import { describe, it, expect, afterEach, vi } from "vitest";
import { ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { McpServerMixin } from "../src/index.js";
import type { McpServerMixinOptions } from "../src/index.js";
import { BoundedEventStore } from "../src/event-store.js";
import { createMcpClient, closeMcpClient, callTool } from "./mcp-client.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

function message(id: number): JSONRPCMessage {
	return { jsonrpc: "2.0", method: "test", params: { id } };
}

async function replay(store: BoundedEventStore, lastEventId: string) {
	const sent: Array<[string, JSONRPCMessage]> = [];
	const streamId = await store.replayEventsAfter(lastEventId, {
		send: async (eventId, msg) => {
			sent.push([eventId, msg]);
		}
	});
	return { streamId, sent };
}

describe("BoundedEventStore", () => {
	it("should replay the events after the given one, of the same stream only", async () => {
		const store = new BoundedEventStore(100);
		const first = await store.storeEvent("stream-a", message(1));
		await store.storeEvent("stream-b", message(2));
		const third = await store.storeEvent("stream-a", message(3));

		const { streamId, sent } = await replay(store, first);
		expect(streamId).toBe("stream-a");
		expect(sent).toEqual([[third, message(3)]]);
	});

	it("should support stream IDs containing '_' (the SDK standalone `_GET_stream`)", async () => {
		const store = new BoundedEventStore(100);
		const first = await store.storeEvent("_GET_stream", message(1));
		const second = await store.storeEvent("_GET_stream", message(2));

		expect(await store.getStreamIdForEventId(first)).toBe("_GET_stream");
		const { streamId, sent } = await replay(store, first);
		expect(streamId).toBe("_GET_stream");
		expect(sent).toEqual([[second, message(2)]]);
	});

	it("should keep only the last `maxEvents` events", async () => {
		const store = new BoundedEventStore(3);
		const ids: string[] = [];
		for (let i = 1; i <= 5; i++) ids.push(await store.storeEvent("s", message(i)));

		expect(store.size).toBe(3);
		// Evicted events can't be replayed
		expect(await store.getStreamIdForEventId(ids[0])).toBeUndefined();
		expect((await replay(store, ids[0])).streamId).toBe("");
		// The kept ones still can
		expect((await replay(store, ids[2])).sent.map(([id]) => id)).toEqual([ids[3], ids[4]]);
	});

	it("should generate unique event IDs across stores", async () => {
		const a = await new BoundedEventStore(10).storeEvent("s", message(1));
		const b = await new BoundedEventStore(10).storeEvent("s", message(1));
		expect(a).not.toBe(b);
	});
});

describe("Session timeout", () => {
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
			name: "greeter",
			actions: { hello: { handler: () => "Hello" } }
		});
		await broker.start();
		const address = (apiService.server as Server).address() as AddressInfo;
		return createMcpClient(`http://localhost:${address.port}/mcp`);
	}

	const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

	it("should close sessions of clients gone away without a DELETE request", async () => {
		const mcpClient = await start({ sessionTimeout: 200 });
		expect(apiService.transports.size).toBe(1);

		// Closing the client aborts its SSE stream, but doesn't terminate the session
		await closeMcpClient(mcpClient, { terminate: false });
		expect(apiService.transports.size).toBe(1);

		await vi.waitFor(() => expect(apiService.transports.size).toBe(0), {
			timeout: 3000,
			interval: 50
		});
		expect(apiService.mcpSessions.size).toBe(0);
	});

	it("should keep alive the sessions of connected clients", async () => {
		const mcpClient = await start({ sessionTimeout: 200 });
		try {
			// The client keeps its SSE (GET) stream open
			await sleep(800);
			expect(apiService.transports.size).toBe(1);

			const result = await callTool(mcpClient, "greeter_hello", {});
			expect(result.content[0].text).toContain("Hello");
		} finally {
			await closeMcpClient(mcpClient);
		}
	});

	it("should stop the gateway quickly while clients are connected", async () => {
		// An open SSE stream used to keep the moleculer-web server.close() waiting forever
		const mcpClient = await start({});
		try {
			const t = Date.now();
			await broker.stop();
			expect(Date.now() - t).toBeLessThan(2000);
			expect(apiService.transports.size).toBe(0);
		} finally {
			await closeMcpClient(mcpClient, { terminate: false });
		}
	});

	it("should not close sessions when sessionTimeout is false", async () => {
		const mcpClient = await start({ sessionTimeout: false });
		await closeMcpClient(mcpClient, { terminate: false });
		await sleep(500);
		expect(apiService.transports.size).toBe(1);
	});

	it("should not close sessions (nor run the idle check) when sessionTimeout is 0", async () => {
		const mcpClient = await start({ sessionTimeout: 0 });
		expect(apiService.mcpIdleTimer).toBeUndefined();
		await closeMcpClient(mcpClient, { terminate: false });
		await sleep(100);
		expect(apiService.transports.size).toBe(1);
	});
});
