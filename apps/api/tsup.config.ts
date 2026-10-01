import { defineConfig } from "tsup";

const IS_PROD = process.env.NODE_ENV === "production";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  format: ["esm"],
  minify: IS_PROD,
  sourcemap: true,
});
