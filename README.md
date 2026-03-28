![Moleculer logo](http://moleculer.services/images/banner.png)

[![Integration & Unit Test](https://github.com/moleculerjs/mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/moleculerjs/mcp-server/actions/workflows/test.yml)
[![NPM version](https://badgen.net/npm/v/@moleculer/mcp-server)](https://www.npmjs.com/package/@moleculer/mcp-server)

# @moleculer/mcp-server
MCP server mixin for Moleculer API Gateway (moleculer-web).

Expose your Moleculer microservices to AI assistants (Claude, GPT, etc.) via the [Model Context Protocol](https://modelcontextprotocol.io/).

<video controls src="docs/Code_PIxZeLiRX3.mp4" title="Introduction to MCP Server"></video>

## Features

- **Auto-discovery** — Moleculer actions are automatically registered as MCP tools with proper schemas
- **Schema conversion** — fastest-validator params are converted to Zod schemas automatically
- **Tool annotations** — REST method-based auto-detection of `readOnlyHint`, `destructiveHint`, `idempotentHint`
- **Service filtering** — Whitelist services or exclude specific actions via glob patterns
- **MCP metadata** — Fine-grained control over tool name, description, and annotations per action
- **Built-in broker tools** — List nodes, services, actions, events + generic call/emit tools
- **Streamable HTTP transport** — Standards-compliant MCP server with session management and resumability

## Install

```bash
npm i @moleculer/mcp-server moleculer-web
```

## Quick Start

Add the MCP server mixin to your API Gateway service:

```javascript
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "@moleculer/mcp-server";

// api.service.js
export default {
  name: "api",
  mixins: [ApiGateway, McpServerMixin()],
  settings: {
    port: 3000
  }
};
```

That's it! The MCP server is available at `http://localhost:3000/mcp`. All your Moleculer actions are automatically exposed as MCP tools.

## Auto-discovery

When the broker starts, the mixin scans the service registry and registers each action as an individual MCP tool. This means AI assistants get dedicated, well-typed tools instead of a single generic "call action" tool.

**Example:** A `weather.forecast` action becomes a `weather_forecast` MCP tool with its own input schema and description.

```javascript
// weather.service.js
export default {
  name: "weather",
  actions: {
    forecast: {
      description: "Get weather forecast for a city",
      params: {
        city: "string",
        days: { type: "number", default: 3 }
      },
      rest: "GET /forecast",
      handler(ctx) {
        return { city: ctx.params.city, forecast: "sunny" };
      }
    }
  }
};
```

This automatically generates an MCP tool:
- **Name:** `weather_forecast`
- **Description:** `"Get weather forecast for a city"`
- **Input schema:** `{ city: z.string(), days: z.number().default(3) }`
- **Annotations:** `{ readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false }` (auto-detected from `GET`)

Tool names are derived from the action name by replacing dots with underscores: `service.action` → `service_action`.

Internal actions (prefixed with `$`) are always excluded.

## Configuration Options

```javascript
McpServerMixin({
  // Route options for moleculer-web (default path: /mcp)
  routeOptions: {
    path: "/mcp"
  },

  // Whitelist specific services (array or glob pattern string)
  services: ["weather", "products"],
  // OR: services: "tools.*",

  // Exclude specific actions by glob pattern
  excludeActions: ["$node.*", "api.*"],

  // Show/hide built-in broker tools (list_nodes, list_services, etc.)
  // Default: true
  exposeBrokerTools: true,

  // Prefix for auto-generated tool names
  // Default: "" (no prefix)
  // Example: "mol_" → tool name: "mol_weather_forecast"
  toolNamePrefix: ""
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `routeOptions` | `ApiRouteSchema` | `{ path: "/mcp" }` | moleculer-web route configuration |
| `services` | `string \| string[]` | `undefined` | Whitelist of service names or glob pattern |
| `excludeActions` | `string[]` | `undefined` | Action name patterns to exclude |
| `exposeBrokerTools` | `boolean` | `true` | Whether to register built-in broker tools |
| `toolNamePrefix` | `string` | `""` | Prefix for auto-generated tool names |

## Action Description & MCP Metadata

### Description field

Add a `description` field to your actions. It will be used as the MCP tool description, helping AI assistants understand what the tool does:

```javascript
actions: {
  forecast: {
    description: "Get weather forecast for a city by name",
    params: { city: "string" },
    handler(ctx) { /* ... */ }
  }
}
```

If no description is provided, a default is generated: `"Call the weather.forecast Moleculer action"`.

### MCP metadata

Use the `mcp` field in your action schema for fine-grained control:

```javascript
actions: {
  forecast: {
    params: { city: "string" },
    mcp: {
      // Override the tool description
      description: "Get detailed weather forecast",
      // Override the tool name (default: service_action)
      name: "get_forecast",
      // Explicit annotations (overrides auto-detection)
      annotations: { readOnlyHint: true },
      // Enable/disable this tool (default: true)
      enabled: true
    },
    handler(ctx) { /* ... */ }
  }
}
```

You can also use shorthand:
- `mcp: true` — register with default settings (same as omitting the field)
- `mcp: false` — exclude this action from MCP tools

## Tool Annotations

MCP tool annotations help AI assistants understand the behavior of each tool. The mixin auto-detects annotations based on the action's REST method:

| REST Method | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| `GET` | `true` | `false` | `true` | `false` |
| `PUT` | `false` | `false` | `true` | `false` |
| `DELETE` | `false` | `true` | `true` | `false` |
| `POST` (or no REST) | `false` | `false` | `false` | `false` |

You can override auto-detected annotations using the `mcp.annotations` field:

```javascript
actions: {
  dangerousReset: {
    rest: "POST /reset",
    mcp: {
      annotations: {
        destructiveHint: true,
        idempotentHint: false
      }
    },
    handler(ctx) { /* ... */ }
  }
}
```

## Schema Conversion

The mixin automatically converts fastest-validator parameter schemas to Zod schemas for MCP tool input validation. The following mappings are supported:

| fastest-validator | Zod equivalent |
|---|---|
| `"string"` | `z.string()` |
| `"number"` | `z.number()` |
| `"boolean"` | `z.boolean()` |
| `"date"` | `z.string()` |
| `"email"` | `z.string().email()` |
| `"url"` | `z.string().url()` |
| `"any"` | `z.any()` |
| `{ type: "string", min: 3, max: 100 }` | `z.string().min(3).max(100)` |
| `{ type: "string", pattern: "^[a-z]+$" }` | `z.string().regex(...)` |
| `{ type: "string", enum: ["a", "b"] }` | `z.enum(["a", "b"])` |
| `{ type: "number", positive: true, integer: true }` | `z.number().positive().int()` |
| `{ type: "number", min: 0, max: 100 }` | `z.number().min(0).max(100)` |
| `{ type: "array", items: "string" }` | `z.array(z.string())` |
| `{ type: "object", props: { name: "string" } }` | `z.object({ name: z.string() })` |
| `{ type: "enum", values: ["a", "b"] }` | `z.enum(["a", "b"])` |
| `{ type: "string", optional: true }` | `z.string().optional()` |
| `{ type: "number", default: 5 }` | `z.number().default(5)` |
| `"number\|integer\|positive"` (pipe syntax) | `z.number().int().positive()` |
| Unknown/custom type | `z.any()` |

## Built-in Tools

When `exposeBrokerTools` is `true` (default), the following broker-level tools are registered:

| Tool | Description |
|---|---|
| `moleculer_list_nodes` | List all Moleculer nodes in the cluster |
| `moleculer_list_services` | List all registered services |
| `moleculer_list_actions` | List all available actions |
| `moleculer_list_events` | List all event listeners |

These tools are always registered regardless of `exposeBrokerTools`:

| Tool | Description |
|---|---|
| `moleculer_call_action` | Call any Moleculer action by name (generic fallback) |
| `moleculer_emit_event` | Emit or broadcast a Moleculer event |

## MCP Client Setup

### Claude Code

```bash
claude mcp add --transport http moleculer http://127.0.0.1:3000/mcp
```

### Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "moleculer": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

### Generic MCP Client

```json
{
  "servers": {
    "moleculer": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

## License
The project is available under the [MIT license](https://tldrlegal.com/license/mit-license).

## Contact
Copyright (c) 2026 MoleculerJS

[![@MoleculerJS](https://img.shields.io/badge/github-moleculerjs-green.svg)](https://github.com/moleculerjs) [![@MoleculerJS](https://img.shields.io/badge/twitter-MoleculerJS-blue.svg)](https://twitter.com/MoleculerJS)
