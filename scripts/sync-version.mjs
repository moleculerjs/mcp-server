// Run by the npm `version` lifecycle: write the new package.json version to src/version.ts
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(
	"src/version.ts",
	`// Keep in sync with package.json (checked by test/version.test.ts)\nexport const VERSION = "${version}";\n`
);
