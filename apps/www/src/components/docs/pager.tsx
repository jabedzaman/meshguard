import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { flattenTree, source } from "~/lib/source";

export function DocsPager({ url }: { url: string }) {
  const pages = flattenTree(source.getTree());
  const index = pages.findIndex((page) => page.url === url);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index >= 0 ? pages[index + 1] : undefined;

  if (!previous && !next) return null;

  return (
    <nav className="mt-16 flex justify-between gap-4 border-t pt-6 text-sm">
      {previous ? (
        <Link href={previous.url} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          {previous.name}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.url} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          {next.name}
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </nav>
  );
}
