# @moleculer/mcp-server

MCP server mixin for Moleculer API Gateway. Exposes Moleculer microservice actions as MCP tools via Streamable HTTP transport.

## File Structure

```
src/
  index.ts              # Main export: McpServerMixin() function, sessions, tools refresh
  types.ts              # TypeScript interfaces (McpServerMixinOptions, McpCustomTool)
  schema-converter.ts   # fastest-validator → Zod schema conversion
  tool-generator.ts     # Auto-discovery: action registry → MCP tool registration
  custom-tools.ts       # Registration of the `tools` option
  utils.ts              # Tool result helpers (toTextResult, toErrorResult), forwarded meta
  event-store.ts        # Bounded in-memory SSE event store
  version.ts            # Package version (kept in sync with package.json by a test)
test/
  index.test.ts         # Integration tests (MCP client ↔ server)
  schema-converter.test.ts  # Schema conversion unit tests
  schema-converter-patterns.test.ts  # Format patterns and advanced types (also checks the JSON Schema)
  auto-discovery.test.ts    # Auto-discovery integration tests
  custom-tools-refresh.test.ts  # Custom tools and dynamic refresh tests
  version.test.ts       # VERSION ↔ package.json check
  security.test.ts      # Meta forwarding, call_action filters, exposeGenericTools
  sessions.test.ts      # Event store, idle sessions cleanup, shutdown
  dns-rebinding.test.ts # allowedOrigins / allowedHosts
  call-options.test.ts  # callOptions and maxResultLength
  stateless.test.ts     # Stateless mode
  annotations.test.ts   # Annotations from REST method and action names
  request-context.test.ts # requestID, parent span and caller of the tool calls
  options.test.ts       # Mixin options, routeOptions merge, protocol errors
  session-owner.test.ts # Sessions bound to their user (sessionOwner)
  mcp-remote.test.ts    # README Claude Desktop configurations through mcp-remote (pinned devDependency)
  mcp-client.ts         # Test MCP client helper
  setup.ts              # Vitest setup: random ports never get a port refused by `fetch` ("bad port")
examples/
  index.ts              # Entry point (module selector)
  simple/
    index.ts            # Simple example (greeter + products)
    products.service.ts # CRUD products service (@moleculer/database)
  client/
    index.ts            # MCP client example
```

## Build & Test Commands

```bash
npm run build     # tsc — dual CJS/ESM output to dist/
npm run check     # tsc, strict, whole project (src, test, examples)
npm run check:src # type check of src only (used by CI with Moleculer 0.14)
npm test          # vitest --run --coverage
npm run ci        # vitest --watch (development)
npm run lint      # eslint
npm run dev       # example server (examples/simple, port 3300) with nodemon
npm run inspect   # MCP Inspector UI: connect it to http://localhost:3300/mcp (Streamable HTTP)
```

## Naming Conventions

- **Variables/functions:** camelCase
- **File names:** kebab-case (e.g. `schema-converter.ts`)
- **Types/interfaces:** PascalCase (e.g. `McpServerMixinOptions`)
- **MCP tool names:** snake_case (e.g. `weather_forecast`)
- **Constants:** UPPER_SNAKE_CASE (global), camelCase (local)

## Key Options (McpServerMixinOptions)

- `routeOptions` — moleculer-web route config (default path: `/mcp`)
- `services` — `string | string[]` — service whitelist or glob pattern
- `excludeActions` — `string[]` — action name patterns to exclude
- `exposeBrokerTools` — `boolean` (default: `true`) — show/hide list_nodes, list_services, etc.
- `exposeGenericTools` — `boolean` (default: `true`) — show/hide moleculer_call_action and moleculer_emit_event
- `toolNamePrefix` — `string` (default: `""`) — prefix for auto-generated tool names
- `tools` — `McpCustomTool[]` (default: `[]`) — manually declared tools
- `refreshDebounceTime` — `number | false` (default: `1000`) — debounce of the tools refresh on `$services.changed`
- `forwardMeta` — `string[]` (default: `["user"]`) — HTTP request `ctx.meta` fields forwarded to actions/events
- `sessionTimeout` — `number | false` (default: 30 min) — close idle sessions (`false`/`0` disable)
- `maxSessions` — `number | null` (default: `100`) — max open sessions, `503` over the limit, `null` unlimited
- `sessionOwner` — `false | (ctx) => string` (default: id of `ctx.meta.user`) — requests of another owner get `404`
- `maxStoredEvents` — `number` (default: `1000`) — SSE events kept per session
- `stateless` — `boolean` (default: `false`) — no sessions, a new MCP server per request
- `allowedOrigins` / `allowedHosts` — `string[]` — DNS rebinding protection
- `allowedEvents` — `string[]` — events allowed in moleculer_emit_event
- `callOptions` — `CallingOptions` — options of the actions called by the tools (e.g. `timeout`)
- `maxResultLength` — `number` — truncate longer tool results

## Notes

- `McpServerMixin` must come after `ApiGateway` in `mixins`.
- The tests close clients with a DELETE (`closeMcpClient`); pass `{ terminate: false }` to simulate a client gone away.
- `scripts/sync-version.mjs` runs on `npm version` and updates `src/version.ts`.
- `tsconfig.json` (strict, noEmit) covers the whole project; `tsconfig.build.json` (src only) is extended by `tsconfig.cjs.json`/`tsconfig.esm.json`, which emit JS and `.d.ts` side by side.
- The SDK validates tool arguments with the converted Zod schemas: a converter mismatch rejects or alters real requests.

## Tech Stack

- TypeScript 6, Node.js >= 22.12
- `@modelcontextprotocol/sdk` ^1.32.1, `zod` ^3.25, `lodash`
- `moleculer` ^0.14.12 || ^0.15.0 and `moleculer-web` ^0.10.0 || ^0.11.0 (peerDeps); CI also runs the tests with moleculer 0.14 + moleculer-web 0.10
- The Moleculer 0.14 typings miss some registry methods: use `getRegistry()` in `src/index.ts`
- Test: Vitest + @vitest/coverage-v8
