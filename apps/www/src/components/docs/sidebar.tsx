"use client";

import { cn } from "@meshguard/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PageTreeNode } from "~/types/content";

interface DocsSidebarProps {
  tree: PageTreeNode[];
}

// Top-level pages render first; each top-level folder becomes a titled section.
export function DocsSidebar({ tree }: DocsSidebarProps) {
  const pathname = usePathname();
  const pages = tree.filter((node) => node.type === "page");
  const folders = tree.filter((node) => node.type === "folder");

  const nav = (
    <nav aria-label="Docs" className="space-y-6 text-sm">
      {pages.length > 0 ? <SidebarList nodes={pages} pathname={pathname} /> : null}
      {folders.map((folder) => (
        <div key={folder.name}>
          <p className="mb-2 px-3 font-medium">{folder.name}</p>
          <SidebarList
            nodes={[...(folder.index ? [folder.index] : []), ...folder.children]}
            pathname={pathname}
          />
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <details className="group border-b py-3 lg:hidden">
        <summary className="cursor-pointer list-none text-sm font-medium">Menu</summary>
        <div className="pt-4">{nav}</div>
      </details>
      <aside className="hidden lg:block">
        <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-14 pr-2">{nav}</div>
      </aside>
    </>
  );
}

function SidebarList({ nodes, pathname }: { nodes: PageTreeNode[]; pathname: string }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) =>
        node.type === "page" ? (
          <li key={node.url}>
            <Link
              href={node.url}
              aria-current={node.url === pathname ? "page" : undefined}
              className={cn(
                "block rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                node.url === pathname && "bg-accent font-medium text-accent-foreground",
              )}
            >
              {node.name}
            </Link>
          </li>
        ) : (
          <li key={node.name} className="pt-2">
            <p className="px-3 py-1.5 text-xs font-medium uppercase text-muted-foreground">{node.name}</p>
            <SidebarList
              nodes={[...(node.index ? [node.index] : []), ...node.children]}
              pathname={pathname}
            />
          </li>
        ),
      )}
    </ul>
  );
}
