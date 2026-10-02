import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  // permissions is a separate entry so browser code can import it without the server.
  entry: ["src/index.ts", "src/permissions.ts"],
  format: ["esm"],
  sourcemap: true,
  external: [/^@mesh\//],
});
