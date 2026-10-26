import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { CallingOptions, Context, ServiceBroker } from "moleculer";
import type { ApiRouteSchema } from "moleculer-web";
import type { ZodRawShape } from "zod";

/** A tool declared manually instead of being generated from an action */
export interface McpCustomTool {
	/** Tool name (snake_case recommended) */
	name: string;

	/** Brief human readable title */
	title?: string;

	/** Detailed description, used by the LLM to decide when to call the tool */
	description: string;

	/** Input parameters as a Zod raw shape, e.g. `{ a: z.number() }` */
	input?: ZodRawShape;

	/** Output structure as a Zod raw shape. When set, the result is also sent as `structuredContent` */
	output?: ZodRawShape;

	/** Hints for the client about the tool behavior */
	annotations?: ToolAnnotations;

	/**
	 * Action name to call with the tool params, or a function returning the result.
	 * `meta` contains the fields forwarded from the HTTP request (see `forwardMeta`).
	 * `callOptions` are the options to pass to `broker.call`: the forwarded meta, the
	 * configured `callOptions` and the context of the HTTP request (request ID, tracing).
	 */
	handler:
		| string
		| ((
				params: Record<string, unknown>,
				broker: ServiceBroker,
				meta: Record<string, unknown>,
				callOptions: CallingOptions
		  ) => unknown);
}

export interface McpServerMixinOptions {
	/**
	 * moleculer-web route options of the MCP route. The MCP aliases, the methods and headers
	 * needed in `cors` and `bodyParsers.json: false` are always added. Default path: "/mcp"
	 */
	routeOptions?: Partial<ApiRouteSchema>;

	/** Whitelist of service names (array) or glob pattern (string) */
	services?: string | string[];

	/** Action name patterns to exclude from auto-discovery */
	excludeActions?: string[];

	/** Whether to expose broker tools (list_nodes, list_services, etc.). Default: true */
	exposeBrokerTools?: boolean;

	/**
	 * Whether to expose the generic `moleculer_call_action` and `moleculer_emit_event` tools.
	 * `moleculer_call_action` applies the same filters of the auto-discovered tools, while
	 * `moleculer_emit_event` can emit any event. Default: true
	 */
	exposeGenericTools?: boolean;

	/**
	 * Event name patterns (e.g. ["orders.*"]) that `moleculer_emit_event` can emit or broadcast.
	 * Default: any event
	 */
	allowedEvents?: string[];

	/** Prefix for auto-generated tool names. Default: "" */
	toolNamePrefix?: string;

	/** Manually declared tools, registered in addition to the auto-discovered ones */
	tools?: McpCustomTool[];

	/**
	 * Debounce time (ms) for refreshing the auto-discovered tools of the open sessions
	 * when the services change. Set `false` to disable the refresh. Default: 1000
	 */
	refreshDebounceTime?: number | false;

	/**
	 * Fields of the HTTP request `ctx.meta` forwarded to the called actions and events, e.g. the
	 * `user` set by the moleculer-web `authenticate` method of the route. Default: ["user"]
	 */
	forwardMeta?: string[];

	/**
	 * Close the sessions idle for this time (ms): no requests and no open SSE stream, e.g.
	 * clients gone away without a DELETE request. Set `false` to disable. Default: 30 minutes
	 */
	sessionTimeout?: number | false;

	/**
	 * Calling options of the actions called by the tools, e.g. `{ timeout: 10000 }`.
	 * The forwarded meta (see `forwardMeta`) is merged into `meta`.
	 */
	callOptions?: CallingOptions;

	/**
	 * Max length (characters) of the text result of a tool. Longer results are truncated with
	 * a note asking the LLM for a more specific request. Default: no limit
	 */
	maxResultLength?: number;

	/**
	 * Stateless mode: each POST request gets a new MCP server, no session is kept and GET/DELETE
	 * are rejected with 405. Use it to run several gateway instances without sticky sessions.
	 * Server-to-client notifications (e.g. `tools/list_changed`) and SSE resumability are not
	 * available. Default: false
	 */
	stateless?: boolean;

	/**
	 * Max number of open sessions of this gateway instance: further initialization requests are
	 * rejected with `503` until a session is closed (DELETE request or `sessionTimeout`).
	 * It protects the memory from clients (or attackers) opening sessions without closing them:
	 * each session keeps its own MCP server, with all the tools, and up to `maxStoredEvents`
	 * SSE events (about 0.5 MB with 25 tools, plus the events). Set it on the expected concurrent
	 * clients and the available memory, or `null` for no limit. Not used in stateless mode.
	 * Default: 100
	 */
	maxSessions?: number | null;

	/**
	 * Owner of a session, computed from the context of the HTTP request: the requests of a
	 * session with a different owner are rejected with `404`, as for an unknown session, so a
	 * leaked session ID can't be used by another user (e.g. to read the SSE stream and its stored
	 * events). By default the owner is the `id`, `_id`, `username` or `email` of `ctx.meta.user`
	 * (the whole user, as JSON, if it has none of them); without a user the sessions are
	 * anonymous and usable only without a user. `false` to disable the check.
	 * Not used in stateless mode.
	 */
	sessionOwner?: false | ((ctx: Context) => string | null | undefined);

	/** Max number of SSE events kept in memory per session for resumability. Default: 1000 */
	maxStoredEvents?: number;

	/**
	 * Allowed `Origin` header values, e.g. ["https://app.example.com"]. Requests from other
	 * origins are rejected (DNS rebinding protection) and the route CORS allows only these.
	 * Requests without `Origin` (non-browser clients) are always accepted. Default: any origin
	 */
	allowedOrigins?: string[];

	/**
	 * Allowed `Host` header values, with or without port, e.g. ["localhost", "127.0.0.1"].
	 * Requests to other hosts are rejected (DNS rebinding protection). Default: any host
	 */
	allowedHosts?: string[];
}
