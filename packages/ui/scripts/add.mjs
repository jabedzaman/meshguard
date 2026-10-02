// Wraps `shadcn add` and undoes two quirks of its registry in this monorepo
// layout: it imports `cn` from "cn", and adds an unrelated npm package named
// "cn" as a dependency.
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

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.dependencies?.cn) {
  delete pkg.dependencies.cn;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  execFileSync("pnpm", ["install", "--no-frozen-lockfile"], { stdio: "inherit" });
}
