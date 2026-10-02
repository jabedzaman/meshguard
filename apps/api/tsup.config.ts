import { defineConfig } from "tsup";

const IS_PROD = process.env.NODE_ENV === "production";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts", "src/app.ts"],
  // Only AppType is consumed by other packages (@meshguard/api-client).
  dts: { entry: "src/app.ts" },
  format: ["esm"],
  minify: IS_PROD,
  sourcemap: true,
});
