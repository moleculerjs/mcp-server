import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { CallingOptions } from "moleculer";
import type { ZodRawShape } from "zod";
import type { McpServerMixinOptions } from "./types.js";

/** Configuration of a MCP tool */
export interface ToolConfig {
	title?: string;
	description?: string;
	inputSchema?: ZodRawShape;
	outputSchema?: ZodRawShape;
	annotations?: ToolAnnotations;
}

/** Handler of a MCP tool: validated params and the SDK request `extra` */
export type ToolHandler = (
	params: Record<string, unknown>,
	extra: { authInfo?: AuthInfo }
) => CallToolResult | Promise<CallToolResult>;

/**
 * Register a tool on the MCP server.
 * Wraps `McpServer.registerTool`, whose typings hit the Zod 3.25 deep type inference
 * limit ("Type instantiation is excessively deep") with dynamic schemas.
 */
export function registerTool(
	server: McpServer,
	name: string,
	config: ToolConfig,
	handler: ToolHandler
): RegisteredTool {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return server.registerTool(name, config as any, handler as any);
}

/** Key of `AuthInfo.extra` where the mixin stores the meta forwarded from the HTTP request */
export const MCP_META_KEY = "moleculerMeta";

/**
 * Get the meta forwarded from the HTTP request (e.g. the authenticated `user`) from the
 * `extra` argument of a MCP tool handler.
 */
export function getForwardedMeta(extra?: { authInfo?: AuthInfo }): Record<string, unknown> {
	return (extra?.authInfo?.extra?.[MCP_META_KEY] as Record<string, unknown>) ?? {};
}

/** Key of `AuthInfo.extra` where the mixin stores the context of the HTTP request */
export const MCP_CONTEXT_KEY = "moleculerContext";

/**
 * Calling options that link the actions and events of a tool to the HTTP request: the same
 * `requestID` (logs), the request context as parent (tracing) and the gateway as `caller`.
 * The request `ctx.meta` is not inherited: only the `forwardMeta` fields are forwarded.
 */
export type RequestContextOptions = Pick<CallingOptions, "requestID" | "parentSpan" | "caller">;

/** Get the context of the HTTP request from the `extra` argument of a MCP tool handler */
export function getRequestContext(extra?: { authInfo?: AuthInfo }): RequestContextOptions {
	return (extra?.authInfo?.extra?.[MCP_CONTEXT_KEY] as RequestContextOptions) ?? {};
}

/**
 * Calling options for the actions called by a tool: the context of the HTTP request, the
 * configured `callOptions` (e.g. `timeout`) and the meta forwarded from the HTTP request.
 */
export function getCallOptions(
	options: McpServerMixinOptions,
	extra?: { authInfo?: AuthInfo }
): CallingOptions {
	const callOptions = options.callOptions ?? {};
	return {
		...getRequestContext(extra),
		...callOptions,
		meta: { ...callOptions.meta, ...getForwardedMeta(extra) }
	};
}

/**
 * Wrap a value into a successful MCP tool result (JSON text content).
 * Texts longer than `maxLength` characters are truncated, with a note for the LLM.
 */
export function toTextResult(result: unknown, maxLength?: number): CallToolResult {
	let text = result === undefined ? "null" : JSON.stringify(result, null, 2);
	if (maxLength && text.length > maxLength) {
		const total = text.length;
		text =
			text.slice(0, maxLength) +
			`\n\n[Result truncated: ${maxLength} of ${total} characters. Use more specific ` +
			`parameters (e.g. filters or pagination) to get a smaller result.]`;
	}
	return { content: [{ type: "text", text }] };
}

/**
 * Wrap an error into an MCP tool error result (`isError: true`), so the LLM can see
 * what went wrong. Stack traces are not included to avoid leaking server internals.
 */
export function toErrorResult(err: unknown): CallToolResult {
	let errorInfo: Record<string, unknown>;
	if (err instanceof Error) {
		const { code, type, data } = err as Error & {
			code?: unknown;
			type?: unknown;
			data?: unknown;
		};
		errorInfo = { name: err.name, message: err.message, code, type, data };
	} else {
		errorInfo = { name: "UnknownError", message: String(err) };
	}

	let details: string;
	try {
		details = JSON.stringify(errorInfo, null, 2);
	} catch {
		// e.g. a circular `data`
		details = JSON.stringify({ ...errorInfo, data: undefined }, null, 2);
	}

	return {
		isError: true,
		content: [
			{
				type: "text",
				text: `Error ${errorInfo.name}: ${errorInfo.message}\n${details}`
			}
		]
	};
}
