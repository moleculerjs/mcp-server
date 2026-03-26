/*
 * @moleculer/mcp-server
 * Copyright (c) 2026 MoleculerJS (https://github.com/moleculerjs/mcp-server)
 * MIT Licensed
 */

"use strict";

import pkg from "../package.json";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { ServiceBroker, ServiceSchema } from "moleculer";
import type { ApiRouteSchema, ApiSettingsSchema } from "moleculer-web";
import _ from "lodash";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServerMixinOptions } from "./types.js";
import { registerAutoDiscoveryTools } from "./tool-generator.js";

export type { McpServerMixinOptions } from "./types.js";

export function McpServerMixin(
	mixinOptions?: McpServerMixinOptions
): Partial<ServiceSchema<ApiSettingsSchema>> {
	mixinOptions = _.defaultsDeep(mixinOptions, {
		routeOptions: {
			path: "/mcp"
		},
		exposeBrokerTools: true,
		toolNamePrefix: ""
	});

	function createServer(broker: ServiceBroker) {
		const logger = broker.getLogger("MCP");

		logger.info("Creating MCP server...");

		const server = new McpServer(
			{
				name: "Moleculer MCP Server",
				version: pkg.version
			},
			{
				capabilities: {
					tools: {}
				}
			}
		);

		// Auto-discovery: register per-action tools
		registerAutoDiscoveryTools(server, broker, mixinOptions!);

		if (mixinOptions!.exposeBrokerTools !== false) {
		server.registerTool(
			"moleculer_list_nodes",
			{
				title: "List Moleculer nodes",
				description: "List all Moleculer nodes",
				inputSchema: {
					onlyAvailable: z
						.boolean()
						.optional()
						.default(false)
						.describe("List only available (online) nodes"),
					withServices: z
						.boolean()
						.optional()
						.default(false)
						.describe("Include service schemas")
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false
				}
			},
			async params => {
				logger.info("Listing Moleculer nodes...", params);
				const nodes = broker.registry.getNodeList({
					withServices: false,
					onlyAvailable: false
				});
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(nodes, null, 2)
						}
					]
				};
			}
		);

		server.registerTool(
			"moleculer_list_services",
			{
				title: "List Moleculer services",
				description: "List all Moleculer services",
				inputSchema: {
					onlyLocal: z
						.boolean()
						.optional()
						.default(false)
						.describe("List only local node services"),
					onlyAvailable: z
						.boolean()
						.optional()
						.default(false)
						.describe("List only available (online) services"),
					skipInternal: z
						.boolean()
						.optional()
						.default(false)
						.describe("Skip internal services (prefixed with '$')"),
					withActions: z
						.boolean()
						.optional()
						.default(false)
						.describe("Include service actions definitions"),
					withEvents: z
						.boolean()
						.optional()
						.default(false)
						.describe("Include service events definitions"),
					grouping: z
						.boolean()
						.optional()
						.default(true)
						.describe("Group services by name and version")
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false
				}
			},
			async params => {
				logger.info("Listing Moleculer services...", params);
				const services = broker.registry.getServiceList(params);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(services, null, 2)
						}
					]
				};
			}
		);

		server.registerTool(
			"moleculer_list_actions",
			{
				title: "List Moleculer actions",
				description: "List all Moleculer actions",
				inputSchema: {
					onlyLocal: z
						.boolean()
						.optional()
						.default(false)
						.describe("List only local node actions"),
					onlyAvailable: z
						.boolean()
						.optional()
						.default(false)
						.describe("List only available (online) actions"),
					skipInternal: z
						.boolean()
						.optional()
						.default(false)
						.describe("Skip internal actions (prefixed with '$')"),
					withEndpoints: z
						.boolean()
						.optional()
						.default(false)
						.describe("Include node endpoint information of actions")
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false
				}
			},
			async params => {
				logger.info("Listing Moleculer actions...", params);
				const actions = broker.registry.getActionList(params);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(actions, null, 2)
						}
					]
				};
			}
		);

		server.registerTool(
			"moleculer_list_events",
			{
				title: "List Moleculer events",
				description: "List all Moleculer events",
				inputSchema: {
					onlyLocal: z
						.boolean()
						.optional()
						.default(false)
						.describe("List only local node events"),
					onlyAvailable: z
						.boolean()
						.optional()
						.default(false)
						.describe("List only available (online) events"),
					skipInternal: z
						.boolean()
						.optional()
						.default(false)
						.describe("Skip internal events (prefixed with '$')"),
					withEndpoints: z
						.boolean()
						.optional()
						.default(false)
						.describe("Include node endpoint information of event listeners")
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false
				}
			},
			async params => {
				logger.info("Listing Moleculer events...", params);
				const events = broker.registry.getEventList(params);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(events, null, 2)
						}
					]
				};
			}
		);
		} // end exposeBrokerTools

		server.registerTool(
			"moleculer_call_action",
			{
				title: "Call Action",
				description: "Call a Moleculer action",
				inputSchema: {
					action: z.string().describe("Action name"),
					jsonParams: z
						.string()
						.describe(
							'Actions parameters as a JSON object string. E.g. \'{"name":"John"}\'\nIf you don\'t know the parameters of the action, call the `moleculer_list_actions` tool first.'
						)
						.optional()
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: false,
					openWorldHint: true
				}
			},
			async params => {
				logger.info("Calling Moleculer action...", params);
				if (!params.action) {
					throw new Error("action parameter is required");
				}

				let actionParams = {};
				if (params.jsonParams) {
					try {
						actionParams = JSON.parse(params.jsonParams);
					} catch (err) {
						throw new Error(
							"The 'jsonParams' must be a valid JSON object string: " + err.message
						);
					}
				}
				try {
					const result = await broker.call(params.action, actionParams);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(result, null, 2)
							}
						]
					};
				} catch (err) {
					logger.error("Error calling action:", err);
					return {
						content: [
							{
								type: "text",
								text:
									`Error ${err.name}: ${err.message}` +
									JSON.stringify(err, null, 2)
							}
						]
					};
				}
			}
		);

		server.registerTool(
			"moleculer_emit_event",

			{
				title: "Emit (or broadcast) an Event",
				description: "Emit a Moleculer event",
				inputSchema: {
					event: z.string().describe("Event name"),
					jsonParams: z
						.string()
						.describe(
							'Event parameters as a JSON object string. E.g. \'{"name":"John"}\'\nIf you don\'t know the parameters of the event, call the `moleculer_list_events` tool first.'
						)
						.optional(),
					broadcast: z
						.boolean()
						.optional()
						.default(false)
						.describe("Set to true to broadcast the event to all nodes")
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: false,
					openWorldHint: true
				}
			},
			async params => {
				logger.info("Emitting Moleculer event...", params);
				if (!params.event) {
					throw new Error("event parameter is required");
				}

				let eventParams = {};
				if (params.jsonParams) {
					try {
						eventParams = JSON.parse(params.jsonParams);
					} catch (err) {
						throw new Error(
							"The 'jsonParams' must be a valid JSON object string: " + err.message
						);
					}
				}
				try {
					if (params.broadcast) {
						await broker.broadcast(params.event, eventParams);
					} else {
						await broker.emit(params.event, eventParams);
					}
					return {
						content: [
							{
								type: "text",
								text: `Event '${params.event}' emitted successfully`
							}
						]
					};
				} catch (err) {
					logger.error("Error emitting event:", err);
					return {
						content: [
							{
								type: "text",
								text:
									`Error ${err.name}: ${err.message}` +
									JSON.stringify(err, null, 2)
							}
						]
					};
				}
			}
		);

		return server;
	}

	return {
		created() {
			this.transports = new Map<string, StreamableHTTPServerTransport>();

			const route = _.defaultsDeep(mixinOptions?.routeOptions, {
				aliases: {
					async "POST /"(req, res) {
						this.logger.info("Received MCP POST request");
						try {
							// Check for existing session ID
							const sessionId = req.headers["mcp-session-id"] as string | undefined;
							let transport: StreamableHTTPServerTransport;

							if (sessionId && this.transports.has(sessionId)) {
								// Reuse existing transport
								transport = this.transports.get(sessionId)!;
							} else if (!sessionId) {
								const { server } = createServer(this.broker);

								// New initialization request
								const eventStore = new InMemoryEventStore();
								transport = new StreamableHTTPServerTransport({
									sessionIdGenerator: () => randomUUID(),
									eventStore, // Enable resumability
									onsessioninitialized: (sessionId: string) => {
										// Store the transport by session ID when session is initialized
										// This avoids race conditions where requests might come in before the session is stored
										this.logger.info(
											`Session initialized with ID: ${sessionId}`
										);
										this.transports.set(sessionId, transport);
									}
								});

								// Set up onclose handler to clean up transport when closed
								server.onclose = async () => {
									const sid = transport.sessionId;
									if (sid && this.transports.has(sid)) {
										this.logger.info(
											`Transport closed for session ${sid}, removing from transports map`
										);
										this.transports.delete(sid);
									}
								};

								// Connect the transport to the MCP server BEFORE handling the request
								// so responses can flow back through the same transport
								await server.connect(transport);

								await transport.handleRequest(req, res);

								return; // Already handled
							} else {
								// Invalid request - no session ID or not initialization request
								this.logger.warn("Invalid MCP request:", req.headers);
								res.statusCode = 400;
								await this.sendResponse(req, res, {
									jsonrpc: "2.0",
									error: {
										code: -32000,
										message: "Bad Request: No valid session ID provided"
									},
									id: req?.body?.id
								}, {});
								return;
							}

							// Handle the request with existing transport - no need to reconnect
							// The existing transport is already connected to the server
							await transport.handleRequest(req, res);
						} catch (error) {
							this.logger.error("Error handling MCP request:", error);
							if (!res.headersSent) {
								res.statusCode = 500;
								await this.sendResponse(req, res, {
									jsonrpc: "2.0",
									error: {
										code: -32603,
										message: "Internal server error"
									},
									id: req?.body?.id
								}, {});
								return;
							}
						}
					},

					async "GET /"(req, res) {
						this.logger.info("Received MCP GET request");
						const sessionId = req.headers["mcp-session-id"] as string | undefined;
						if (!sessionId || !this.transports.has(sessionId)) {
							res.statusCode = 400;
							await this.sendResponse(req, res, {
								jsonrpc: "2.0",
								error: {
									code: -32000,
									message: "Bad Request: No valid session ID provided"
								},
								id: req?.body?.id
							}, {});
							return;
						}

						// Check for Last-Event-ID header for resumability
						const lastEventId = req.headers["last-event-id"] as string | undefined;
						if (lastEventId) {
							this.logger.info(
								`Client reconnecting with Last-Event-ID: ${lastEventId}`
							);
						} else {
							this.logger.info(
								`Establishing new MCP SSE stream for session ${sessionId}`
							);
						}

						const transport = this.transports.get(sessionId);
						await transport!.handleRequest(req, res);
					},

					async "DELETE /"(req, res) {
						const sessionId = req.headers["mcp-session-id"] as string | undefined;
						if (!sessionId || !this.transports.has(sessionId)) {
							res.statusCode = 400;
							await this.sendResponse(req, res, {
								jsonrpc: "2.0",
								error: {
									code: -32000,
									message: "Bad Request: No valid session ID provided"
								},
								id: req?.body?.id
							}, {});
							return;
						}

						this.logger.info(
							`Received session termination request for session ${sessionId}`
						);

						try {
							const transport = this.transports.get(sessionId);
							await transport!.handleRequest(req, res);
						} catch (error) {
							this.logger.error("Error handling session termination:", error);
							if (!res.headersSent) {
								res.statusCode = 500;
								await this.sendResponse(req, res, {
									jsonrpc: "2.0",
									error: {
										code: -32603,
										message: "Error handling session termination"
									},
									id: req?.body?.id
								}, {});
								return;
							}
						}
					}
				},

				mappingPolicy: "restrict",

				bodyParsers: {
					json: false // The mcp server will read the raw body itself
				}
			});

			// Add route
			this.settings.routes.unshift(route);
		},

		async stopped() {
			this.logger.info("Shutting down server...");

			// Close all active transports to properly clean up resources
			for (const [sessionId, transport] of this.transports) {
				try {
					this.logger.info(`Closing transport for session ${sessionId}`);
					await transport.close();
					this.transports.delete(sessionId);
				} catch (error) {
					this.logger.error(`Error closing transport for session ${sessionId}:`, error);
				}
			}

			this.logger.info("Server shutdown complete");
		}
	};
}
