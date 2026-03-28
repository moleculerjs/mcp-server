# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] (since 0.1.0)

### Breaking changes

- **`McpServerMixinOptions` interface moved** to a separate `types.ts` module. If you imported it directly from `src/index.ts`, update your import path.
- **`sendResponse` call signature changed** to the standard moleculer-web 4-argument format `(req, res, data, opts)` instead of the previous 4-arg `(req, res, statusCode, data)`. This aligns with moleculer-web v0.10+ conventions.

### New features

- **Auto-discovery tool generation** — The mixin now automatically discovers Moleculer actions from the broker registry and registers per-action MCP tools with proper Zod input schemas. LLMs get dedicated, well-typed tools instead of relying solely on the generic `moleculer_call_action`.
- **fastest-validator → Zod schema converter** (`src/schema-converter.ts`) — Converts Moleculer's fastest-validator param definitions to Zod schemas, supporting: string, number, boolean, enum, array, object, nested objects, optional/required fields, and default values.
- **Service whitelist filtering** — New `services` option accepts a string glob pattern or an array of service names to control which services' actions get auto-discovered. Uses Moleculer's `Utils.match()` for full glob support (`*`, `**`, `?`).
- **Action exclusion patterns** — New `excludeActions` option to exclude specific action name patterns from auto-discovery (e.g. `["$node.*"]`).
- **`exposeBrokerTools` option** — Controls whether generic broker tools (`moleculer_list_nodes`, `moleculer_list_services`, `moleculer_list_actions`, `moleculer_list_events`) are registered. Default: `true`. When `false`, `moleculer_call_action` and `moleculer_emit_event` are still available.
- **`toolNamePrefix` option** — Adds a prefix to auto-generated tool names (e.g. `prefix_greeter_hello` instead of `greeter_hello`).
- **MCP annotation detection** — Auto-discovered tools get automatic `readOnlyHint`/`destructiveHint`/`idempotentHint` annotations based on action name patterns (e.g. `get*`, `list*` → readOnly; `delete*`, `remove*` → destructive). Custom annotations via `action.mcp.annotations` are merged on top.
- **CI/CD publish workflow** — `.github/workflows/publish.yml` for automated npm publishing with provenance on GitHub releases (trusted publisher).

### Fixed issues

- **`stopped()` lifecycle Map iteration bug** — Used `for...in` on a `Map`, which doesn't iterate entries. Fixed to `for...of` with proper destructuring.
- **`sendResponse` inconsistency** — Some calls used a non-standard argument order. Standardized all `sendResponse` calls to the moleculer-web 4-arg format.
- **Dead code cleanup** — Removed commented-out resource handlers, hardcoded tool registrations, and unused code blocks.
- **`getNodeList` ignoring params** — The handler didn't pass through `params` to the registry call; now properly forwards `withServices` and `onlyAvailable` parameters.
- **`z.enum` crash on empty/non-string arrays** — Added guard for non-empty string array check before calling `z.enum()`, falling back to `z.union(z.literal(...))` for mixed types.
- **`JSON.stringify(undefined)` in call_action response** — Added undefined guard with null fallback to prevent silent empty responses.
- **Error serialization losing details** — Error responses now explicitly extract `name`, `message`, and `stack` properties instead of relying on `JSON.stringify(err)` which loses non-enumerable fields.
- **MCP annotations merge** — Detected annotations and user-defined `mcp.annotations` are now properly spread-merged instead of one overwriting the other.
- **Internal `$node.*` actions filtered** — Auto-discovery automatically excludes internal Moleculer actions (starting with `$`) to avoid exposing infrastructure tools to LLMs.
- **CORS support for MCP Inspector** — Added CORS configuration to the route, allowing the MCP Inspector and other browser-based clients to connect cross-origin. Allowed headers include `mcp-session-id`, `mcp-protocol-version`, and `Last-Event-ID`.
- **Unknown session ID handling** — POST requests with an unknown `mcp-session-id` now create a new session instead of returning 400. This fixes reconnection issues with MCP SDK v1.28+ clients.
