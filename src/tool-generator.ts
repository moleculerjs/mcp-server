import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Moleculer from "moleculer";
import type { ServiceBroker } from "moleculer";
import type { McpServerMixinOptions } from "./types.js";
import { convertActionParamsToZod } from "./schema-converter.js";

const { match } = Moleculer.Utils;

interface ActionEntry {
	name: string;
	action?: {
		description?: string;
		params?: any;
		rest?: any;
		mcp?: boolean | {
			enabled?: boolean;
			name?: string;
			description?: string;
			annotations?: Record<string, boolean>;
		};
		[key: string]: any;
	};
}

function getRestMethod(rest: any): string | null {
	if (!rest) return null;
	if (typeof rest === "string") {
		const parts = rest.trim().split(/\s+/);
		if (parts.length >= 2) return parts[0].toUpperCase();
		return null;
	}
	if (typeof rest === "object" && !Array.isArray(rest) && rest.method) {
		return rest.method.toUpperCase();
	}
	if (Array.isArray(rest) && rest.length > 0) {
		return getRestMethod(rest[0]);
	}
	return null;
}

function detectAnnotations(restMethod: string | null): Record<string, boolean> {
	const annotations: Record<string, boolean> = { openWorldHint: false };

	if (restMethod === "GET") {
		annotations.readOnlyHint = true;
		annotations.destructiveHint = false;
		annotations.idempotentHint = true;
	} else if (restMethod === "DELETE") {
		annotations.readOnlyHint = false;
		annotations.destructiveHint = true;
		annotations.idempotentHint = true;
	} else if (restMethod === "PUT") {
		annotations.readOnlyHint = false;
		annotations.destructiveHint = false;
		annotations.idempotentHint = true;
	} else {
		annotations.readOnlyHint = false;
		annotations.destructiveHint = false;
		annotations.idempotentHint = false;
	}

	return annotations;
}

function shouldIncludeAction(
	actionEntry: ActionEntry,
	options: McpServerMixinOptions
): boolean {
	const actionName = actionEntry.name;
	const serviceName = actionName.split(".").slice(0, -1).join(".");
	const actionDef = actionEntry.action;

	// Check mcp: false
	if (actionDef?.mcp === false) return false;
	if (typeof actionDef?.mcp === "object" && actionDef.mcp.enabled === false) return false;

	// Check services filter
	if (options.services) {
		if (typeof options.services === "string") {
			if (!match(serviceName, options.services)) return false;
		} else if (Array.isArray(options.services)) {
			if (!options.services.some(s => match(serviceName, s))) return false;
		}
	}

	// Check excludeActions
	if (options.excludeActions) {
		for (const pattern of options.excludeActions) {
			if (match(actionName, pattern)) return false;
		}
	}

	return true;
}

export function registerAutoDiscoveryTools(
	server: McpServer,
	broker: ServiceBroker,
	options: McpServerMixinOptions
): void {
	const logger = broker.getLogger("MCP-AutoDiscovery");
	const actions: ActionEntry[] = broker.registry.getActionList({
		skipInternal: true,
		withEndpoints: false
	});

	const prefix = options.toolNamePrefix || "";

	for (const actionEntry of actions) {
		if (!shouldIncludeAction(actionEntry, options)) continue;

		const actionName = actionEntry.name;
		const actionDef = actionEntry.action || {};
		const mcpMeta = typeof actionDef.mcp === "object" ? actionDef.mcp : {};

		// Tool name
		const toolName = mcpMeta.name || (prefix + actionName.replace(/\./g, "_"));

		// Description
		const description =
			mcpMeta.description ||
			actionDef.description ||
			`Call the ${actionName} Moleculer action`;

		// Input schema
		const inputSchema = convertActionParamsToZod(actionDef.params);

		// Annotations: merge auto-detected with explicit overrides
		const detectedAnnotations = detectAnnotations(getRestMethod(actionDef.rest));
		const annotations = {
			...detectedAnnotations,
			...(mcpMeta.annotations || {})
		};

		server.registerTool(
			toolName,
			{
				title: `Call ${actionName}`,
				description,
				inputSchema,
				annotations
			},
			async (params: Record<string, any>) => {
				try {
					const result = await broker.call(actionName, params);
					return {
						content: [
							{
								type: "text" as const,
								text: result === undefined ? "null" : JSON.stringify(result, null, 2)
							}
						]
					};
				} catch (err: any) {
					logger.error(`Error calling action ${actionName}:`, err);
					const errorInfo = err instanceof Error
						? { name: err.name, message: err.message, stack: err.stack }
						: { message: String(err) };
					return {
						content: [
							{
								type: "text" as const,
								text: `Error ${errorInfo.name || "UnknownError"}: ${errorInfo.message}\n${JSON.stringify(errorInfo, null, 2)}`
							}
						]
					};
				}
			}
		);

		logger.info(`Registered tool: ${toolName} → ${actionName}`);
	}
}
