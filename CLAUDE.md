# @moleculer/mcp-server

MCP server mixin for Moleculer API Gateway. Exposes Moleculer microservice actions as MCP tools via Streamable HTTP transport.

## File Structure

```
src/
  index.ts              # Main export: McpServerMixin() function
  types.ts              # TypeScript interfaces (McpServerMixinOptions)
  schema-converter.ts   # fastest-validator → Zod schema conversion
  tool-generator.ts     # Auto-discovery: action registry → MCP tool registration
test/
  index.test.ts         # Integration tests (MCP client ↔ server)
  schema-converter.test.ts  # Schema conversion unit tests
  auto-discovery.test.ts    # Auto-discovery integration tests
  mcp-client.ts         # Test MCP client helper
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
npm run check     # tsc --noEmit (type check only)
npm test          # vitest --run --coverage
npm run ci        # vitest --watch (development)
npm run lint      # eslint
npm run dev       # nodemon with MCP inspector
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
- `toolNamePrefix` — `string` (default: `""`) — prefix for auto-generated tool names

## Tech Stack

- TypeScript 5.9, Node.js >= 20
- `@modelcontextprotocol/sdk` ^1.18.0, `zod` ^3.25, `lodash`
- `moleculer` ^0.14.12 || ^0.15.0 (peerDep)
- Test: Vitest + @vitest/coverage-v8
