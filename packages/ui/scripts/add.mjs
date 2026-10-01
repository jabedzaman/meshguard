// Wraps `shadcn add` and rewrites the `cn` import it emits for this monorepo
// layout (`from "cn"`) to the package path.
// Usage: pnpm --filter @mesh/ui ui:add button dialog
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

execFileSync("pnpm", ["dlx", "shadcn@latest", "add", "-y", ...process.argv.slice(2)], {
  stdio: "inherit",
});

const dir = new URL("../src/components/", import.meta.url);
for (const file of readdirSync(dir)) {
  if (!file.endsWith(".tsx")) continue;
  const path = new URL(file, dir);
  const src = readFileSync(path, "utf8");
  const fixed = src.replaceAll('from "cn"', 'from "@mesh/ui/lib/utils"');
  if (fixed !== src) writeFileSync(path, fixed);
}
