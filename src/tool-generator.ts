import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceBroker } from "moleculer";
import type { McpServerMixinOptions } from "./types.js";
import { convertActionParamsToZod } from "./schema-converter.js";

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

function matchGlob(pattern: string, value: string): boolean {
	if (pattern.endsWith(".*")) {
		return value.startsWith(pattern.slice(0, -1));
	}
	if (pattern.endsWith("*")) {
		return value.startsWith(pattern.slice(0, -1));
	}
	return pattern === value;
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
			if (!matchGlob(options.services, serviceName)) return false;
		} else if (Array.isArray(options.services)) {
			if (!options.services.some(s => matchGlob(s, serviceName))) return false;
		}
	}

	// Check excludeActions
	if (options.excludeActions) {
		for (const pattern of options.excludeActions) {
			if (matchGlob(pattern, actionName)) return false;
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

		// Annotations
		const restMethod = getRestMethod(actionDef.rest);
		const annotations = mcpMeta.annotations || detectAnnotations(restMethod);

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
								text: JSON.stringify(result, null, 2)
							}
						]
					};
				} catch (err: any) {
					logger.error(`Error calling action ${actionName}:`, err);
					return {
						content: [
							{
								type: "text" as const,
								text: `Error ${err.name}: ${err.message}\n${JSON.stringify(err, null, 2)}`
							}
						]
					};
				}
			}
		);

		logger.info(`Registered tool: ${toolName} → ${actionName}`);
	}
}
