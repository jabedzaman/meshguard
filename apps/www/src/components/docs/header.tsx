import Link from "next/link";

export function DocsHeader() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="font-semibold tracking-tight">
          MeshGuard
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
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
