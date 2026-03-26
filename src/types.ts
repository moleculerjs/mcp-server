import type { ApiRouteSchema } from "moleculer-web";

export interface McpServerMixinOptions {
	routeOptions?: ApiRouteSchema;

	/** Whitelist of service names (array) or glob pattern (string) */
	services?: string | string[];

	/** Action name patterns to exclude from auto-discovery */
	excludeActions?: string[];

	/** Whether to expose broker tools (list_nodes, list_services, etc.). Default: true */
	exposeBrokerTools?: boolean;

	/** Prefix for auto-generated tool names. Default: "" */
	toolNamePrefix?: string;
}
