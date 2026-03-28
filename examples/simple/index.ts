"use strict";

/**
 * It's a simple example which demonstrates how to
 * use the MCP server
 */

import { ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../../src/index.js";

import process from "node:process";

// Create broker
const broker = new ServiceBroker();

broker.createService({
	name: "api",
	mixins: [ApiGateway, McpServerMixin()],
	settings: {
		port: 3300
	}
});

broker.createService({
	name: "greeter",
	actions: {
		hello: {
			description: "Say hello from Moleculer",
			rest: {
				method: "GET",
				path: "/hello"
			},
			mcp: {
				annotations: { readOnlyHint: true }
			},
			async handler() {
				return "Hello Moleculer";
			}
		},

		welcome: {
			description: "Welcome a user by name",
			rest: "POST /welcome",
			params: {
				name: "string"
			},
			async handler(ctx) {
				return `Welcome, ${ctx.params.name}`;
			}
		}
	}
});

broker.loadService(import.meta.dirname + "/products.service.ts");

// Start server
broker
	.start()
	.then(async () => {
		// broker.wf.run("test.wf1", { name: "John Doe" }, { jobId: "1111" });
	})
	.then(() => broker.repl())
	.catch(err => {
		broker.logger.error(err);
		process.exit(1);
	});
