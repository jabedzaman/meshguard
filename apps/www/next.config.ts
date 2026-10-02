import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@meshguard/ui"],
  pageExtensions: ["ts", "tsx", "md", "mdx"],
};

// Plugins are named by string so Turbopack can load them (functions can't
// cross into Rust); their options must stay serializable.
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-frontmatter", "remark-gfm"],
    rehypePlugins: [
      "rehype-slug",
      [
        "rehype-pretty-code",
        { theme: { light: "github-light", dark: "github-dark" }, keepBackground: false },
      ],
    ],
  },
});

export default withMDX(nextConfig);
