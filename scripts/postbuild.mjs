// Mark the module type of each build output (the root package.json is "type": "module")
import { writeFileSync } from "node:fs";

writeFileSync("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }) + "\n");
writeFileSync("dist/esm/package.json", JSON.stringify({ type: "module" }) + "\n");
