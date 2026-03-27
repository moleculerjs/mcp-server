import "moleculer";

declare module "moleculer" {
	interface ActionSchema {
		/** Human-readable description of this action. Used as the MCP tool description. */
		description?: string;

		/**
		 * MCP metadata for this action.
		 * - `false` — exclude from MCP tools
		 * - `true` — include with default settings
		 * - object — fine-grained control over tool name, description, annotations, enabled
		 */
		mcp?:
			| boolean
			| {
					enabled?: boolean;
					name?: string;
					description?: string;
					annotations?: Record<string, boolean>;
			  };
	}
}
