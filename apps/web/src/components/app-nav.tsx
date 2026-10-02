"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@meshguard/ui/lib/utils";

const LINKS = [
  { href: "/", label: "Networks" },
  { href: "/members", label: "Members" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b">
      {LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            pathname === href
              ? "border-foreground font-medium"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
