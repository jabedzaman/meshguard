"use client";

import { cn } from "@meshguard/ui/lib/utils";
import { useEffect, useState } from "react";
import type { TocItem } from "~/types/content";

export function DocsToc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.url.slice(1));

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );

    for (const item of items) {
      const element = document.getElementById(item.url.slice(1));
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <aside className="hidden xl:block">
      <div className="sticky top-28">
        <p className="mb-3 text-xs font-medium uppercase text-muted-foreground">On this page</p>
        <nav className="space-y-1 border-l text-sm">
          {items.map((item) => (
            <a
              key={item.url}
              href={item.url}
              className={cn(
                "-ml-px block border-l py-1 text-muted-foreground transition-colors hover:text-foreground",
                item.depth === 3 ? "pl-6" : "pl-3",
                item.url.slice(1) === activeId
                  ? "border-foreground text-foreground"
                  : "border-transparent",
              )}
            >
              {item.title}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}
