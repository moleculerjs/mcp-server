import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceBroker } from "moleculer";
import type { McpServerMixinOptions } from "./types.js";
import type { ToolHandler } from "./utils.js";
import {
	getCallOptions,
	getForwardedMeta,
	registerTool,
	toErrorResult,
	toTextResult
} from "./utils.js";

/**
 * Register the manually declared tools.
 * Tools whose name is already registered on the server are skipped with a warning.
 */
export function registerCustomTools(
	server: McpServer,
	broker: ServiceBroker,
	options: McpServerMixinOptions
): void {
	const logger = broker.getLogger("MCP-CustomTools");

	for (const def of options.tools ?? []) {
		const handler: ToolHandler = async (params, extra) => {
			const meta = getForwardedMeta(extra);
			const callOptions = getCallOptions(options, extra);
			try {
				let result: unknown;
				if (typeof def.handler === "function") {
					result = await def.handler(params, broker, meta, callOptions);
				} else if (typeof def.handler === "string") {
					result = await broker.call(def.handler, params, callOptions);
				} else {
					throw new Error(`Invalid handler for tool '${def.name}'`);
				}

				const response = toTextResult(result, options.maxResultLength);
				// With an output schema the SDK requires (and validates) the structured content
				if (def.output) {
					response.structuredContent = result as Record<string, unknown>;
				}
				return response;
			} catch (err: unknown) {
				logger.error(`Error calling custom tool ${def.name}:`, err);
				return toErrorResult(err);
			}
		};

		try {
			registerTool(
				server,
				def.name,
				{
					title: def.title,
					description: def.description,
					// Without an input schema the SDK would call the handler without params
					inputSchema: def.input ?? {},
					outputSchema: def.output,
					annotations: def.annotations
				},
				handler
			);
		} catch (err) {
			logger.warn(`Skipping custom tool '${def.name}':`, err);
			continue;
		}

		logger.debug(
			`Registered custom tool: ${def.name} → ${typeof def.handler === "string" ? def.handler : "<function>"}`
		);
	}
}
