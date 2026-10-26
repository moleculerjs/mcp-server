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
- **Tool annotations** — Auto-detection of `readOnlyHint`, `destructiveHint`, `idempotentHint` from the REST method or the action name
- **Service filtering** — Whitelist services or exclude specific actions via glob patterns
- **MCP metadata** — Fine-grained control over tool name, title, description, and annotations per action
- **Custom tools** — Declare extra tools with Zod input/output schemas, backed by an action or a function
- **Dynamic refresh** — Open sessions get the tools of services started (or stopped) after they connected
- **Built-in broker tools** — List nodes, services, actions, events + generic call/emit tools
- **Authentication** — Protect the route as any moleculer-web route; the authenticated user is forwarded to the actions
- **Request ID and tracing** — Tool calls share the `requestID` of the HTTP request and, with tracing enabled, are child spans of it
- **Streamable HTTP transport** — Standards-compliant MCP server with session management, resumability and DNS rebinding protection
- **Stateless mode** — No sessions, for gateways running in several instances without sticky sessions

## Install

```bash
npm i @moleculer/mcp-server moleculer-web
```

Requires Node.js 22.12 or newer. Both Moleculer 0.14 and 0.15 are supported, with the matching moleculer-web version:

| Moleculer | moleculer-web |
| --- | --- |
| `^0.15.0` | `^0.11.0` |
| `^0.14.12` | `^0.10.0` |

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

> `McpServerMixin` must come **after** `ApiGateway` in `mixins`: it adds its route to the gateway.

Before exposing the server outside localhost, read [Security](#security).

## Auto-discovery

The mixin scans the service registry and registers each action as an individual MCP tool, on every session (or, in stateless mode, every request). This means AI assistants get dedicated, well-typed tools instead of a single generic "call action" tool.

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

Tool names are derived from the action name by replacing dots (and any other character not valid in a MCP tool name: only letters, digits, `_` and `-` are) with underscores: `service.action` → `service_action`, `v2.users.get` → `v2_users_get`. `toolNamePrefix` is prepended, `mcp.name` replaces the whole name.

Internal actions (prefixed with `$`) are always excluded, and so are actions whose `visibility` is not `"published"` (the default), as in the API gateway, and the actions of every moleculer-web gateway of the cluster, this one included (e.g. `api.listAliases`, which lists all the routes). The actions of stopped services, which the registry keeps without endpoints, are not exposed either.

Params declared with `$$root: true` are exposed as a single `$$root` argument and unwrapped before calling the action.

### Dynamic refresh

When services join or leave the cluster (`$services.changed`), the auto-discovered tools of every open MCP session are regenerated and the clients receive a `notifications/tools/list_changed` notification. The refresh is debounced by `refreshDebounceTime` (default `1000` ms); set it to `false` to keep the tools fixed for the whole session. New sessions and stateless requests always get the current tools.

The converted tools are cached and shared by all the sessions until the next `$services.changed`, so the schemas of the actions are not converted again for every session or request.

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
  excludeActions: ["admin.*"],

  // Show/hide built-in broker tools (list_nodes, list_services, etc.)
  // Default: true
  exposeBrokerTools: true,

  // Show/hide the generic moleculer_call_action and moleculer_emit_event tools
  // Default: true
  exposeGenericTools: true,

  // Prefix for auto-generated tool names
  // Default: "" (no prefix)
  // Example: "mol_" → tool name: "mol_weather_forecast"
  toolNamePrefix: "",

  // Manually declared tools (see "Custom tools")
  tools: [],

  // Debounce time (ms) of the tools refresh when services change, false to disable
  // Default: 1000
  refreshDebounceTime: 1000,

  // ctx.meta fields of the HTTP request forwarded to actions and events (see "Security")
  // Default: ["user"]
  forwardMeta: ["user"],

  // Close sessions idle for this time (ms), false to disable
  // Default: 30 minutes
  sessionTimeout: 30 * 60 * 1000,

  // Max open sessions of this gateway instance, null for no limit (see "Sessions")
  // Default: 100
  maxSessions: 100,

  // Owner of a session: requests of another user get 404, false to disable (see "Sessions")
  // Default: the id, _id, username or email of ctx.meta.user
  sessionOwner: ctx => ctx.meta.user?.id,

  // SSE events kept in memory per session for resumability
  // Default: 1000
  maxStoredEvents: 1000,

  // Run without sessions, for several gateway instances (see "Sessions")
  // Default: false
  stateless: false,

  // DNS rebinding protection: allowed Origin and Host headers
  // Default: any
  allowedOrigins: ["https://app.example.com"],
  allowedHosts: ["localhost", "mcp.example.com"],

  // Events that moleculer_emit_event can emit
  // Default: any
  allowedEvents: ["orders.*"],

  // Calling options of the actions called by the tools
  callOptions: { timeout: 10000 },

  // Truncate tool results longer than this (characters)
  // Default: no limit
  maxResultLength: 50000
})
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `routeOptions` | `Partial<ApiRouteSchema>` | `{ path: "/mcp" }` | moleculer-web route configuration. The MCP aliases, the CORS methods/headers needed by MCP and `bodyParsers.json: false` are always added |
| `services` | `string \| string[]` | `undefined` | Whitelist of service names or glob pattern |
| `excludeActions` | `string[]` | `undefined` | Action name patterns to exclude |
| `exposeBrokerTools` | `boolean` | `true` | Whether to register built-in broker tools |
| `exposeGenericTools` | `boolean` | `true` | Whether to register `moleculer_call_action` and `moleculer_emit_event` |
| `toolNamePrefix` | `string` | `""` | Prefix for auto-generated tool names |
| `tools` | `McpCustomTool[]` | `[]` | Manually declared tools |
| `refreshDebounceTime` | `number \| false` | `1000` | Debounce of the tools refresh on `$services.changed`, `false` to disable |
| `forwardMeta` | `string[]` | `["user"]` | `ctx.meta` fields of the HTTP request forwarded to the called actions and events |
| `sessionTimeout` | `number \| false` | `1800000` (30 min) | Close sessions with no requests and no open SSE stream for this time. `false` or `0` to disable |
| `maxSessions` | `number \| null` | `100` | Max open sessions of this gateway instance; new sessions get `503` over the limit. `null` for no limit |
| `sessionOwner` | `false \| (ctx) => string` | id of `ctx.meta.user` | Owner of a session, from the HTTP request context: the requests of another owner get `404`. `false` to disable |
| `maxStoredEvents` | `number` | `1000` | SSE events kept in memory per session to resume interrupted streams |
| `stateless` | `boolean` | `false` | No sessions: a new MCP server per request (multi-instance gateways) |
| `allowedOrigins` | `string[]` | any | Allowed `Origin` headers (also used for the route CORS) |
| `allowedHosts` | `string[]` | any | Allowed `Host` headers, with or without port |
| `allowedEvents` | `string[]` | any | Event name patterns allowed in `moleculer_emit_event` |
| `callOptions` | `CallingOptions` | `{}` | Moleculer calling options (e.g. `timeout`) of the actions called by the tools |
| `maxResultLength` | `number` | no limit | Max characters of a tool result; longer results are truncated with a note |

If two tools end up with the same name (e.g. two actions with the same `mcp.name`), the first registered one wins and the others are skipped with a warning. Registration order: broker tools, generic tools (`moleculer_call_action`, `moleculer_emit_event`), custom tools, auto-discovered tools.

## Security

### Authentication

The MCP route is a regular moleculer-web route, so it can be protected with the usual `authentication`/`authorization` route options. The `ctx.meta` fields listed in `forwardMeta` (by default the `user` returned by `authenticate`) are forwarded to every action called by a tool and to every emitted event, so the actions can check who is calling them. They are taken from each HTTP request, not from the session.

```javascript
export default {
  name: "api",
  mixins: [ApiGateway, McpServerMixin({ routeOptions: { authentication: true } })],
  methods: {
    async authenticate(ctx, route, req) {
      const token = req.headers["authorization"]?.replace("Bearer ", "");
      // Returning null lets the request go on as anonymous: throw to reject it
      if (!token) throw new ApiGateway.Errors.UnAuthorizedError(ApiGateway.Errors.ERR_NO_TOKEN);
      const user = await ctx.call("users.resolveToken", { token });
      if (!user) throw new ApiGateway.Errors.UnAuthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN);
      return user; // → ctx.meta.user
    }
  }
};
```

Custom tools with a function handler receive the forwarded meta as third argument and the options for `broker.call` as fourth: `handler(params, broker, meta, callOptions)`.

### Request ID and tracing

The actions and events called by the tools are linked to the HTTP request: they get its `requestID` (e.g. from the `X-Request-ID` header, so the logs of a tool call can be correlated with the request), the request context as parent (with tracing enabled, the calls are child spans of the request) and the gateway as `ctx.caller`. The request `ctx.meta` is not inherited: only the `forwardMeta` fields are forwarded. In function handlers of custom tools, pass `callOptions` to `broker.call` to keep the link.

### What the LLM can call

- Auto-discovered tools are generated only for actions that pass all the filters: not internal (`$`), `published` visibility, not `mcp: false`, not an action of a moleculer-web gateway, matching `services` and not matching `excludeActions`.
- `moleculer_call_action` and `moleculer_list_actions` apply the same filters: a filtered action returns a `not exposed via MCP` error and is not listed.
- `moleculer_emit_event` can emit any event except the internal ones (`$services.changed`, `$node.*`, ...), unless `allowedEvents` is set: then only the matching events, internal ones included. Set `exposeGenericTools: false` if the LLM must not emit events or call actions by name.
- `moleculer_list_nodes`/`_services`/`_events` describe the whole cluster: set `exposeBrokerTools: false` if that must stay private.
- Use `callOptions` (e.g. `{ timeout: 10000 }`) to bound the calls: Moleculer calls can't be aborted when the client cancels a request.

### DNS rebinding protection

The MCP specification requires servers to validate the `Origin` header, so that a web page can't reach a local MCP server from the browser. Set `allowedOrigins` (and `allowedHosts` for local servers): requests with other values are rejected with `403`, and the route CORS allows only the listed origins. Requests without `Origin` (non-browser clients such as Claude Code) are always accepted.

```javascript
McpServerMixin({
  allowedOrigins: ["http://localhost:6274"], // e.g. the MCP Inspector
  allowedHosts: ["localhost", "127.0.0.1"]
})
```

### Sessions

Each MCP session lives in the memory of the gateway process. Sessions are closed on `DELETE` requests or after `sessionTimeout` without activity, and keep at most `maxStoredEvents` SSE events to resume interrupted streams.

`maxSessions` (default `100`) bounds the open sessions, so clients that open sessions without closing them (or an attacker doing it on purpose) can't exhaust the memory: over the limit, new sessions are rejected with `503` until a session is closed, while the open ones keep working. Each session has its own MCP server with all the tools: about 0.5 MB with 25 tools (measured), more with more tools, plus up to `maxStoredEvents` SSE events. Size it on the expected concurrent clients (an idle client keeps its session for `sessionTimeout`) and on the available memory, e.g. `maxSessions: 1000` for ~1000 users on a gateway with enough memory, or `null` for no limit when the route is authenticated and the clients are trusted.

Each session is bound to the user that opened it: by default the `id`, `_id`, `username` or `email` of `ctx.meta.user` (the whole user as JSON if it has none of them). The requests of another user get `404 Session not found`, as for an unknown session, so a leaked session ID can't be used to read the SSE stream and the stored events of its owner. Sessions opened without a user are usable only without a user. Set `sessionOwner` to compare something else (e.g. `ctx => ctx.meta.user.tenantId`), or `false` to disable the check.

Requests with an unknown session ID (closed, expired or of a restarted gateway) get `404 Session not found`, as the MCP specification requires: the clients then start a new session. Requests without a session ID that are not an initialization get `400`.

Request bodies are limited to 4 MB.

With several gateway instances behind a load balancer, either use sticky sessions or set `stateless: true`: every POST request gets a new MCP server, no session ID is issued and `GET`/`DELETE` answer `405`. In this mode server-to-client notifications (e.g. `tools/list_changed`) and stream resumability are not available. The tools of the actions are converted once and cached until the services change (`$services.changed`), so a new server per request costs little.

## Custom tools

Tools that don't map 1:1 to an action can be declared with the `tools` option. `input` and `output` are Zod raw shapes (Zod 3, `zod@^3.25`, the version used by the mixin); `handler` is either an action name (called with the tool params) or a function `(params, broker, meta, callOptions)`.

```javascript
import { z } from "zod";

McpServerMixin({
  tools: [
    {
      name: "sum",
      title: "Sum",
      description: "Sum two numbers",
      input: {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number")
      },
      output: {
        total: z.number().describe("Result")
      },
      handler: params => ({ total: params.a + params.b }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "create_product",
      description: "Create a new product",
      input: { name: z.string(), price: z.number() },
      handler: "products.create"
    }
  ]
})
```

When `output` is set, the result is also returned as `structuredContent` (required by the MCP spec) and must match the schema.

## Tool results and errors

The result of an action or of a custom tool handler is returned to the LLM as JSON text. With `maxResultLength`, longer results are truncated with a note that asks the LLM for more specific parameters (e.g. filters or pagination).

Errors (of the actions and of the custom tool handlers) are returned as tool errors (`isError: true`), so the LLM can see what went wrong: the text contains the error `name`, `message`, `code`, `type` and `data`, never the stack trace.

## Action Description & MCP Metadata

### Description and title fields

Add a `description` field to your actions. It will be used as the MCP tool description, helping AI assistants understand what the tool does. The `title` field is used as the MCP tool title, a short human-readable name shown by the clients:

```javascript
actions: {
  forecast: {
    title: "Weather forecast",
    description: "Get weather forecast for a city by name",
    params: { city: "string" },
    handler(ctx) { /* ... */ }
  }
}
```

If no description is provided, a default is generated: `"Call the weather.forecast Moleculer action"`. If no title is provided, the default is `"Call weather.forecast"`.

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
      // Override the tool title (default: "Call service.action")
      title: "Weather forecast",
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

MCP tool annotations help AI assistants understand the behavior of each tool. The mixin auto-detects annotations based on the action's REST method or, for actions without `rest`, on the verb at the start of the action name:

| REST Method | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| --- | --- | --- | --- | --- |
| `GET` | `true` | `false` | `true` | `false` |
| `PUT` | `false` | `false` | `true` | `false` |
| `DELETE` | `false` | `true` | `true` | `false` |
| `POST` (or no REST) | `false` | `false` | `false` | `false` |

| Action name (without `rest`) | Detected as |
| --- | --- |
| `get*`, `find*`, `list*`, `count*`, `search*`, `query*`, `fetch*`, `read*`, `resolve*`, `show*`, `describe*`, `exists*`, `has*`, `is*` | `GET` |
| `remove*`, `delete*`, `destroy*`, `purge*`, `drop*`, `clear*` | `DELETE` |
| `replace*`, `set*`, `put*`, `upsert*` | `PUT` |
| anything else (e.g. `create`, `update`, `send`) | `POST` |

Only whole verbs match: `getById` is `GET`, `getaway` is not.

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

The explicit annotations are merged with the detected ones: set only the hints that differ.

### Choosing the annotations

The auto-detection only knows the REST method or the action name, not what the handler does: check the actions whose behavior doesn't match their method (e.g. a `POST /search` that only reads, a `GET` that writes a log record used by the business logic, an `update` that increments a counter). Ask these questions, in order:

1. **`readOnlyHint` — Does the action change anything?** `true` only if it never modifies its environment: no database writes, no emitted events or called actions that change data, no messages sent. Logs, metrics and caches don't count. When it's `true`, `destructiveHint` and `idempotentHint` are meaningless.
2. **`destructiveHint` — Can a call lose or overwrite existing data?** `true` if it deletes, overwrites or replaces existing data, or does something that can't be undone (e.g. cancelling an order, revoking an access). `false` if it only adds data (e.g. creating a record, appending a comment) or changes it in a way that is easy to restore.
3. **`idempotentHint` — Does a second call with the same arguments change something more?** `true` if repeating the call has no additional effect (e.g. `set` a field to a value, `remove` by ID: the second call fails or does nothing). `false` if every call adds or increments something (e.g. `create` generates a new ID, `send` sends another email, `increment` adds again). The response can differ (e.g. the second `remove` returns a `NotFound` error): only the effect counts.

| Action | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| --- | --- | --- | --- |
| `products.find`, `products.get`, `POST /search` | `true` | — | — |
| `products.create` | `false` | `false` | `false` |
| `products.update` (sets the given fields) | `false` | `true` | `true` |
| `products.update` (`stock: { $inc: 1 }`) | `false` | `true` | `false` |
| `products.remove`, `orders.cancel` | `false` | `true` | `true` |
| `mail.send` (also `openWorldHint: true`) | `false` | `false` | `false` |

`openWorldHint` (always detected as `false`) tells whether the action reaches entities outside the system, e.g. sending emails or calling a third-party API: set it to `true` for these actions.

The clients can use the annotations to ask for a confirmation before a destructive tool, run the read-only ones without asking, or retry the idempotent ones after an error. When in doubt choose the safer value (`readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`): a wrong "safe" hint can make a client call or retry a tool without asking. The annotations are only hints, not a security mechanism: protect the actions with authentication, `mcp: false` or `excludeActions`.

The custom tools (the `tools` option) have no auto-detected annotations: without `annotations`, the clients assume the MCP defaults (`readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: true`).

## Schema Conversion

The mixin automatically converts fastest-validator parameter schemas to Zod schemas for MCP tool input validation. The following mappings are supported:

| fastest-validator | Zod equivalent |
| --- | --- |
| `"string"` | `z.string()` |
| `"number"` | `z.number()` |
| `"boolean"` | `z.boolean()` |
| `"date"` | `z.string()` |
| `"email"` | `z.string().email()` |
| `"url"` | `z.string().url()` |
| `"any"` | `z.any()` |
| `{ type: "string", min: 3, max: 100 }` | `z.string().min(3).max(100)` |
| `{ type: "string", pattern: "^[a-z]+$" }` | `z.string().regex(...)` (`patternFlags` supported) |
| `{ type: "string", enum: ["a", "b"] }` | `z.enum(["a", "b"])` |
| `{ type: "number", positive: true, integer: true }` | `z.number().positive().int()` |
| `{ type: "number", min: 0, max: 100 }` | `z.number().min(0).max(100)` |
| `{ type: "array", items: "string" }` | `z.array(z.string())` |
| `{ type: "object", props: { name: "string" } }` | `z.object({ name: z.string() }).passthrough()` (unknown properties are kept, as in fastest-validator) |
| `{ type: "object", strict: true, props: { ... } }` | `z.object({ ... }).strict()` (`strict: "remove"` strips the unknown properties) |
| `{ type: "object" }` | `z.object({}).passthrough()` (any object) |
| `{ $$type: "object\|optional", city: "string" }` | `z.object({ city: z.string() }).passthrough().optional()` |
| `{ type: "enum", values: ["a", "b"] }` | `z.enum(["a", "b"])` |
| `{ type: "string", optional: true }` | `z.string().optional()` |
| `{ type: "number", default: 5 }` | `z.number().default(5)` |
| `{ type: "number", default: () => Date.now() }` | `z.number().optional()` (the action applies the dynamic default) |
| `"number\|integer\|positive"` (pipe syntax) | `z.number().int().positive()` |
| `"string\|min:3\|max:10"` (pipe syntax with options) | `z.string().min(3).max(10)` |
| `"uuid"` | `z.string().uuid()` |
| `{ type: "string", nullable: true }` | `z.string().nullable()` |
| `{ type: "string", description: "..." }` | `z.string().describe("...")` |
| `{ type: "string", length: 3 }` / `empty: false` | `z.string().length(3)` / `.min(1)` |
| `{ type: "array", items: "string", min: 1, max: 5 }` | `z.array(z.string()).min(1).max(5)` |
| `{ type: "object", properties: { ... } }` | same as `props` |
| `{ type: "multi", rules: ["string", "number"] }` or `["string", "number"]` | `z.union([z.string(), z.number()])` |
| `{ type: "string", alpha: true }` (also `numeric`, `alphanum`, `alphadash`, `hex`, `base64`, `singleLine`) | `z.string().regex(...)` with the fastest-validator pattern |
| `"mac"` | `z.string().regex(...)` (MAC address formats) |
| `{ type: "currency", currencySymbol: "$", ... }` | `z.string().regex(...)` built like fastest-validator (`customRegex` supported) |
| `"luhn"` | `z.string()` with a description of the checksum |
| `{ type: "tuple", items: ["number", "string"] }` | `z.tuple([z.number(), z.string()])` |
| `{ type: "record", key: "string", value: "number" }` | `z.record(z.string(), z.number())` |
| `{ type: "equal", value: "yes" }` | `z.literal("yes")` (`field` comparisons are not converted) |
| Unknown/custom type | `z.any()` |

The Zod schema describes the tool to the LLM (as JSON Schema) and the MCP SDK validates the tool arguments with it before calling the action, whose validator then runs as usual. Rules that can't be expressed in JSON Schema (e.g. `trim`, `convert`, custom `check` functions) are not converted: they are left to the action's validator.

The JSON Schema is generated by the MCP SDK, which squashes the unions of primitive types without constraints into a `type` array: `["string", "number"]` (`multi`) becomes `{ "type": ["string", "number"] }` and `{ type: "string", nullable: true }` becomes `{ "type": ["string", "null"] }`, while with a constraint (e.g. `["string|min:1", "number"]`) they become `anyOf` branches. It is valid JSON Schema, but the MCP Inspector warns about it: a client that maps the tool schemas to a dialect with a single `type` (e.g. the Gemini function declarations) may reject the tool or drop the constraint. The SDK converts the Zod 4 schemas with `z.toJSONSchema()`, which generates `anyOf` branches for these unions too (e.g. `{ "anyOf": [{ "type": "string" }, { "type": "null" }] }`): solving it requires migrating the mixin from Zod 3 to Zod 4.

## Built-in Tools

When `exposeBrokerTools` is `true` (default), the following broker-level tools are registered:

| Tool | Description |
| --- | --- |
| `moleculer_list_nodes` | List all Moleculer nodes in the cluster (with `withServices`, a summary of their services: name, version, metadata, action and event names) |
| `moleculer_list_services` | List all registered services (without their `settings`) |
| `moleculer_list_actions` | List the actions callable through MCP (same filters as auto-discovery) |
| `moleculer_list_events` | List all event listeners |

The service `settings` and the node `config` are never returned: settings often contain credentials (e.g. a database URI) that are not listed in `$secureSettings`.

These tools are registered regardless of `exposeBrokerTools`, unless `exposeGenericTools` is `false`:

| Tool | Description |
| --- | --- |
| `moleculer_call_action` | Call an exposed Moleculer action by name (generic fallback, same filters as auto-discovery) |
| `moleculer_emit_event` | Emit or broadcast a Moleculer event (not the internal `$` ones, unless allowed by `allowedEvents`) |

## MCP Client Setup

### Claude Code

```bash
claude mcp add --transport http moleculer http://127.0.0.1:3000/mcp
```

With `authentication` enabled on the route, pass the token as a header:

```bash
claude mcp add --transport http moleculer http://127.0.0.1:3000/mcp --header "Authorization: Bearer <token>"
```

`claude mcp list` checks the connection: with a wrong token it shows the `401` of the server.

### Claude Desktop

`claude_desktop_config.json` starts local (stdio) servers only: connect a server running on your machine through the [`mcp-remote`](https://github.com/geelen/mcp-remote) bridge, which needs Node.js 18 or newer. Open the file from Settings → Developer → Edit Config, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "moleculer": {
      "command": "npx",
      "args": ["-y", "mcp-remote@0.14.3", "http://localhost:3000/mcp"]
    }
  }
}
```

With `authentication` enabled on the route, pass the token as a header. Keep the value in `env` and don't put a space after `Authorization:`: Claude Desktop on Windows doesn't escape the spaces inside `args`.

```json
{
  "mcpServers": {
    "moleculer": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.14.3",
        "http://localhost:3000/mcp",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer <token>"
      }
    }
  }
}
```

`mcp-remote` accepts plain HTTP only for `localhost` and `127.0.0.1`: for a server on another machine of a trusted private network add the `--allow-http` flag.

The version of `mcp-remote` is pinned on purpose: without it, `npx` runs the latest release, published by a third party, on every start of Claude Desktop. `0.14.3` is the version tested with this package (`test/mcp-remote.test.ts` runs these configurations); update it after checking the new release.

With a wrong token the server answers `401` and `mcp-remote` tries an OAuth login, which this package doesn't support: the client registration fails and `mcp-remote` exits with `Dynamic Client Registration rejected (HTTP 404)` in its log, without opening a browser. Check the token in `AUTH_HEADER`.

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

## Development

```bash
npm run dev        # example server (examples/simple) on http://localhost:3300/mcp
npm run inspect    # MCP Inspector: connect it to http://localhost:3300/mcp (Streamable HTTP)
npm test           # tests with coverage
npm run check      # type check (src, test, examples)
npm run lint       # eslint
npm run build      # CommonJS and ESM builds in dist/
```

## License

The project is available under the [MIT license](https://tldrlegal.com/license/mit-license).

## Contact

Copyright (c) 2026 MoleculerJS

[![@MoleculerJS](https://img.shields.io/badge/github-moleculerjs-green.svg)](https://github.com/moleculerjs) [![@MoleculerJS](https://img.shields.io/badge/twitter-MoleculerJS-blue.svg)](https://twitter.com/MoleculerJS)
