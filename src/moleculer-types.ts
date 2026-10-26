import "moleculer";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

declare module "moleculer" {
	interface ActionSchema {
		/** Human-readable description of this action. Used as the MCP tool description. */
		description?: string;

		/** Short human-readable title of this action. Used as the MCP tool title. */
		title?: string;

		/**
		 * MCP metadata for this action.
		 * - `false` — exclude from MCP tools
		 * - `true` — include with default settings
		 * - object — fine-grained control over tool name, title, description, annotations, enabled
		 */
		mcp?:
			| boolean
			| {
					enabled?: boolean;
					name?: string;
					title?: string;
					description?: string;
					/** Merged with the annotations detected from the REST method or the action name */
					annotations?: ToolAnnotations;
			  };
	}
}
