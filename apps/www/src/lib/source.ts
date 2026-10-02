import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { extractToc } from "~/lib/toc";
import type { MdxModule, PageTreeFolder, PageTreeNode, PageTreePage, TocItem } from "~/types/content";

// Docs are MDX files under src/content/docs. A folder's meta.json sets its
// sidebar title and page order; index.mdx is the folder's own page.
const docsDirectory = path.join(process.cwd(), "src/content/docs");

export interface DocPage {
  slugs: string[];
  url: string;
  title: string;
  description?: string;
  toc: TocItem[];
  load: () => Promise<MdxModule>;
}

interface MetaFile {
  title?: string;
  pages?: string[];
}

function readMeta(directory: string): MetaFile {
  try {
    return JSON.parse(readFileSync(path.join(directory, "meta.json"), "utf8")) as MetaFile;
  } catch {
    return {};
  }
}

function titleFromSegment(value: string) {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getMdxFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return getMdxFiles(path.join(directory, entry.name), relativePath);
    return entry.name.endsWith(".mdx") ? [relativePath] : [];
  });
}

function createPage(filePath: string): DocPage {
  const { data, content } = matter(readFileSync(path.join(docsDirectory, filePath), "utf8"));
  const segments = filePath.replace(/\.mdx$/, "").split("/");
  const slugs = segments.at(-1) === "index" ? segments.slice(0, -1) : segments;

  if (typeof data.title !== "string") {
    throw new Error(`Missing title in ${filePath}`);
  }

  return {
    slugs,
    url: ["/docs", ...slugs].join("/"),
    title: data.title,
    description: typeof data.description === "string" ? data.description : undefined,
    toc: extractToc(content),
    load: () => import(`../content/docs/${filePath}`) as Promise<MdxModule>,
  };
}

function byOrder(order: string[]) {
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? Infinity : index;
  };
  return (left: string, right: string) => rank(left) - rank(right) || left.localeCompare(right);
}

function buildFolder(directory: string, segments: string[], pages: Map<string, DocPage>): PageTreeFolder {
  const meta = readMeta(directory);
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.name.endsWith(".mdx"))
    .map((entry) => ({ entry, key: entry.name.replace(/\.mdx$/, "") }))
    .sort((left, right) => byOrder(meta.pages ?? [])(left.key, right.key));

  const folder: PageTreeFolder = {
    type: "folder",
    name: meta.title ?? titleFromSegment(segments.at(-1) ?? "Docs"),
    children: [],
  };

  for (const { entry, key } of entries) {
    if (entry.isDirectory()) {
      folder.children.push(buildFolder(path.join(directory, entry.name), [...segments, key], pages));
      continue;
    }

    const page = pages.get((key === "index" ? segments : [...segments, key]).join("/"));
    if (!page) continue;

    const node: PageTreePage = { type: "page", name: page.title, url: page.url };
    if (key === "index") folder.index = node;
    else folder.children.push(node);
  }

  return folder;
}

interface ContentIndex {
  pages: Map<string, DocPage>;
  tree: PageTreeNode[];
}

let cached: ContentIndex | undefined;

function getIndex(): ContentIndex {
  // Rebuild on every request in dev so new and edited files show up.
  if (cached && process.env.NODE_ENV === "production") return cached;

  const pages = new Map(getMdxFiles(docsDirectory).map((file) => {
    const page = createPage(file);
    return [page.slugs.join("/"), page];
  }));
  const root = buildFolder(docsDirectory, [], pages);
  cached = { pages, tree: root.index ? [root.index, ...root.children] : root.children };
  return cached;
}

export function flattenTree(nodes: PageTreeNode[]): PageTreePage[] {
  return nodes.flatMap((node) =>
    node.type === "page" ? [node] : [...(node.index ? [node.index] : []), ...flattenTree(node.children)],
  );
}

export const source = {
  getPage: (slugs: string[] = []) => getIndex().pages.get(slugs.join("/")),
  getPages: () => [...getIndex().pages.values()],
  getTree: () => getIndex().tree,
};
