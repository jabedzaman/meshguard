import Link from "next/link";
import { MobileNav } from "~/components/docs/mobile-nav";
import { flattenTree, source } from "~/lib/source";

export function DocsHeader() {
  return (
    <header className="sticky top-0 z-20 bg-background lg:border-b lg:bg-background/80 lg:backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:gap-6 lg:px-8">
        <MobileNav pages={flattenTree(source.getTree())} />
        <Link href="/" className="font-semibold tracking-tight">
          MeshGuard
        </Link>
        <nav className="hidden items-center gap-4 text-sm text-muted-foreground lg:flex">
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>
        </nav>
        <a
          href="https://github.com/jabedzaman/meshguard"
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-sm text-muted-foreground hover:text-foreground"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
