import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  // permissions and slug are separate entries so browser code can import it without the server.
  entry: ["src/index.ts", "src/permissions.ts", "src/slug.ts"],
  format: ["esm"],
  sourcemap: true,
  external: [/^@meshguard\//],
});
