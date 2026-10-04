import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@meshguard/ui"],
  // Self-contained server for the production image (apps/web/Dockerfile).
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
