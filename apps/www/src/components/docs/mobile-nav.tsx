"use client";

import { cn } from "@meshguard/ui/lib/utils";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { PageTreePage } from "~/types/content";

// Below lg the sidebar is hidden; this full-screen menu lists every page instead.
export function MobileNav({ pages }: { pages: PageTreePage[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const links = [{ name: "Home", url: "/" }, ...pages].filter((link) =>
    link.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <button
        type="button"
        aria-label="Toggle menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="group -ml-1 flex size-8 items-center justify-center lg:hidden"
        data-open={open || undefined}
      >
        <span className="relative size-4.5">
          <span className="absolute top-1 left-0 h-0.5 w-full bg-foreground transition-all duration-150 ease-out group-data-open:top-[0.4rem] group-data-open:-rotate-45 motion-reduce:transition-none" />
          <span className="absolute top-2.5 left-0 h-0.5 w-full bg-foreground transition-all duration-150 ease-out group-data-open:top-[0.4rem] group-data-open:rotate-45 motion-reduce:transition-none" />
        </span>
      </button>
      {open ? (
        <div className="fixed inset-x-0 top-14 bottom-0 z-50 animate-in fade-in slide-in-from-top-1 overflow-y-auto bg-background pb-24 duration-200 lg:hidden">
          <div className="sticky top-0 bg-linear-to-b from-background via-background px-4 pt-3 pb-2">
            <label className="relative block">
              <span className="sr-only">Search</span>
              <Search className="absolute top-3 left-3 size-4.5 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search…"
                className="w-full rounded-lg border bg-background py-2 pr-4 pl-10 text-base outline-none placeholder:text-muted-foreground focus:border-ring dark:bg-secondary [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
          </div>
          <nav aria-label="Menu" className="flex flex-col p-2.5">
            {links.map((link) => (
              <Link
                key={link.url}
                href={link.url}
                onClick={close}
                aria-current={link.url === pathname ? "page" : undefined}
                className={cn(
                  "px-3 py-2 text-xl font-medium",
                  link.url === pathname ? "text-muted-foreground" : "hover:text-muted-foreground",
                )}
              >
                {link.name}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  );
}
