import path from "node:path";
import type { NextConfig } from "next";

// Organization subdomains are other origins to the dev server, which blocks
// their requests for dev resources (HMR, and with it hydration) by default.
const rootHost = process.env.WEB_ROOT_DOMAIN?.split(":")[0];

const nextConfig: NextConfig = {
  allowedDevOrigins: rootHost ? [rootHost, `*.${rootHost}`] : [],
  transpilePackages: ["@meshguard/ui"],
  // Self-contained server for the production image (apps/web/Dockerfile).
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
