import type { MDXComponents } from "mdx/types";

export interface TocItem {
  title: string;
  url: string;
  depth: number;
}

export interface PageTreePage {
  type: "page";
  name: string;
  url: string;
}

export interface PageTreeFolder {
  type: "folder";
  name: string;
  index?: PageTreePage;
  children: PageTreeNode[];
}

export type PageTreeNode = PageTreePage | PageTreeFolder;

export interface MdxModule {
  default: React.ComponentType<{ components?: MDXComponents }>;
}
