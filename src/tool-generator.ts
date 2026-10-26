import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import Moleculer from "moleculer";
import type { ActionSchema, ServiceBroker } from "moleculer";
import type { McpServerMixinOptions } from "./types.js";
import { convertActionParamsToZod } from "./schema-converter.js";
import type { ToolConfig } from "./utils.js";
import { getCallOptions, registerTool, toErrorResult, toTextResult } from "./utils.js";
import "./moleculer-types.js";

const { match } = Moleculer.Utils;

interface ActionEntry {
	name: string;
	action?: ActionSchema;
	/** Number of endpoints (nodes) of the action */
	count?: number;
}

function getRestMethod(rest: unknown): string | null {
	if (!rest) return null;
	if (typeof rest === "string") {
		const parts = rest.trim().split(/\s+/);
		if (parts.length >= 2) return parts[0].toUpperCase();
		return null;
	}
	if (
		typeof rest === "object" &&
		!Array.isArray(rest) &&
		(rest as Record<string, unknown>).method
	) {
		return ((rest as Record<string, unknown>).method as string).toUpperCase();
	}
	if (Array.isArray(rest) && rest.length > 0) {
		return getRestMethod(rest[0]);
	}
	return null;
}

// Fallback for actions without `rest`: the HTTP method implied by the action name
// (last segment, e.g. `find` in `products.find`), as in the @moleculer/database conventions
const NAME_METHODS: Array<[RegExp, string]> = [
	[
		/^(get|find|list|count|search|query|fetch|read|resolve|show|describe|exists|has|is)([A-Z_]|$)/,
		"GET"
	],
	[/^(remove|delete|destroy|purge|drop|clear)([A-Z_]|$)/, "DELETE"],
	[/^(replace|set|put|upsert)([A-Z_]|$)/, "PUT"]
];

function getMethodFromName(actionName: string): string | null {
	const name = actionName.split(".").pop() ?? "";
	for (const [pattern, method] of NAME_METHODS) {
		if (pattern.test(name)) return method;
	}
	return null;
}

/**
 * Tool annotations detected from the action REST method or, without `rest`, from its name.
 */
export function detectActionAnnotations(
	actionName: string,
	actionDef: ActionSchema
): Record<string, boolean> {
	return detectAnnotations(getRestMethod(actionDef.rest) ?? getMethodFromName(actionName));
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

/**
 * Check whether an action can be called through MCP, applying the same rules to the
 * auto-discovered tools and to the generic `moleculer_call_action` tool.
 */
export function isActionExposed(actionEntry: ActionEntry, options: McpServerMixinOptions): boolean {
	const actionName = actionEntry.name;

	// Internal actions (e.g. `$node.*`)
	if (actionName.startsWith("$")) return false;
	const serviceName = actionName.split(".").slice(0, -1).join(".");
	const actionDef = actionEntry.action;

	// Like the API gateway, only "published" actions (the default visibility) are exposed
	if (actionDef?.visibility && actionDef.visibility !== "published") return false;

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

interface ServiceEntry {
	fullName: string;
	metadata?: { $package?: { name?: string } };
}

/**
 * The options with the actions of every moleculer-web gateway of the cluster (also of the
 * other nodes) excluded: they are infrastructure, never tools (e.g. `listAliases` lists all
 * the routes). The gateways are recognized by the package name in their service metadata.
 */
export function withGatewayExclusions(
	broker: ServiceBroker,
	options: McpServerMixinOptions
): McpServerMixinOptions {
	const services = broker.registry.getServiceList({}) as unknown as ServiceEntry[];
	const patterns = services
		.filter(service => service.metadata?.$package?.name === "moleculer-web")
		.map(service => `${service.fullName}.*`);
	if (patterns.length === 0) return options;
	return { ...options, excludeActions: [...(options.excludeActions ?? []), ...patterns] };
}

/** Names of the broker tools (`exposeBrokerTools`) */
export const BROKER_TOOL_NAMES = [
	"moleculer_list_nodes",
	"moleculer_list_services",
	"moleculer_list_actions",
	"moleculer_list_events"
];

/** Names of the generic tools (`exposeGenericTools`) */
export const GENERIC_TOOL_NAMES = ["moleculer_call_action", "moleculer_emit_event"];

/** Names of the tools registered before the auto-discovered ones (see `createServer`) */
export function reservedToolNames(options: McpServerMixinOptions): string[] {
	return [
		...(options.exposeBrokerTools !== false ? BROKER_TOOL_NAMES : []),
		...(options.exposeGenericTools !== false ? GENERIC_TOOL_NAMES : []),
		...(options.tools ?? []).map(tool => tool.name)
	];
}

/** A tool generated from an action: everything but the handler, which needs the server options */
export interface ActionToolDefinition {
	toolName: string;
	actionName: string;
	config: ToolConfig;
	/** `$$root` params are wrapped in an object by the converter: unwrap them before the call */
	isRootParams: boolean;
}

/**
 * Generate the tool definitions of the discovered actions: names, descriptions, converted
 * input schemas and annotations. They depend only on the registry, so they can be computed
 * once and registered on many servers (the Zod schemas are immutable).
 */
export function discoverActionTools(
	broker: ServiceBroker,
	options: McpServerMixinOptions,
	reservedNames: string[] = []
): ActionToolDefinition[] {
	const logger = broker.getLogger("MCP-AutoDiscovery");
	const definitions: ActionToolDefinition[] = [];
	// Checked here, once for each registry change, instead of on every registration
	const names = new Set(reservedNames);
	const actions: ActionEntry[] = broker.registry.getActionList({
		skipInternal: true,
		withEndpoints: false
	});

	const prefix = options.toolNamePrefix || "";
	const exposure = withGatewayExclusions(broker, options);

	for (const actionEntry of actions) {
		// The registry keeps the actions of the stopped services, without endpoints
		if (actionEntry.count === 0) continue;
		if (!isActionExposed(actionEntry, exposure)) continue;

		const actionName = actionEntry.name;
		const actionDef = actionEntry.action || {};
		const mcpMeta = typeof actionDef.mcp === "object" ? actionDef.mcp : {};

		// Tool name
		// Only letters, digits, "_" and "-" are valid in tool names (e.g. `v2.users.get` → `v2_users_get`)
		const toolName = mcpMeta.name || prefix + actionName.replace(/[^a-zA-Z0-9_-]/g, "_");
		if (names.has(toolName)) {
			// e.g. two actions with the same `mcp.name`, or a name clashing with a broker tool
			logger.warn(`Skipping tool '${toolName}' for action ${actionName}: name already used`);
			continue;
		}
		names.add(toolName);

		// Description
		const description =
			mcpMeta.description ||
			actionDef.description ||
			`Call the ${actionName} Moleculer action`;

		// Input schema
		const inputSchema = convertActionParamsToZod(actionDef.params);

		// Annotations: merge auto-detected with explicit overrides
		const detectedAnnotations = detectActionAnnotations(actionName, actionDef);
		const annotations = {
			...detectedAnnotations,
			...(mcpMeta.annotations || {})
		};

		definitions.push({
			toolName,
			actionName,
			config: {
				title: mcpMeta.title || actionDef.title || `Call ${actionName}`,
				description,
				inputSchema,
				annotations
			},
			isRootParams: inputSchema.$$root !== undefined
		});
	}

	return definitions;
}

/**
 * Register a MCP tool for each action tool definition.
 * Tools whose name is already registered on the server are skipped with a warning.
 * @returns The registered tools, so they can be removed when the registry changes.
 */
export function registerActionTools(
	server: McpServer,
	broker: ServiceBroker,
	options: McpServerMixinOptions,
	definitions: ActionToolDefinition[]
): RegisteredTool[] {
	const logger = broker.getLogger("MCP-AutoDiscovery");
	const registered: RegisteredTool[] = [];

	for (const { toolName, actionName, config, isRootParams } of definitions) {
		try {
			const tool = registerTool(server, toolName, { ...config }, async (params, extra) => {
				try {
					const result = await broker.call(
						actionName,
						isRootParams ? params.$$root : params,
						getCallOptions(options, extra)
					);
					return toTextResult(result, options.maxResultLength);
				} catch (err: unknown) {
					logger.error(`Error calling action ${actionName}:`, err);
					return toErrorResult(err);
				}
			});
			registered.push(tool);
		} catch (err) {
			// The duplicated names are skipped by `discoverActionTools`: not expected
			logger.warn(`Skipping tool '${toolName}' for action ${actionName}:`, err);
			continue;
		}

		logger.debug(`Registered tool: ${toolName} → ${actionName}`);
	}

	return registered;
}

/**
 * Register a MCP tool for each discovered action.
 * Tools whose name is already registered on the server are skipped with a warning.
 * @returns The registered tools, so they can be removed when the registry changes.
 */
export function registerAutoDiscoveryTools(
	server: McpServer,
	broker: ServiceBroker,
	options: McpServerMixinOptions
): RegisteredTool[] {
	return registerActionTools(
		server,
		broker,
		options,
		discoverActionTools(broker, options, reservedToolNames(options))
	);
}
