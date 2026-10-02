import GithubSlugger from "github-slugger";
import type { TocItem } from "~/types/content";

function stripInlineMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}

// Mirrors rehype-slug (github-slugger), so the ids match the rendered headings.
export function extractToc(content: string): TocItem[] {
  const slugger = new GithubSlugger();
  const withoutCodeFences = content.replace(/```[\s\S]*?```/g, "");

  return [...withoutCodeFences.matchAll(/^(#{2,3})\s+(.+?)\s*#*$/gm)].map((match) => {
    const title = stripInlineMarkdown(match[2]);
    return { title, url: `#${slugger.slug(title)}`, depth: match[1].length };
  });
}
