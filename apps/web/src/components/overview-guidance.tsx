"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@meshguard/ui/components/button";
import { useOrganization } from "~/components/providers/organization-provider";
import {
  aclQueries,
  deviceQueries,
  enrollmentTokenQueries,
  memberQueries,
  serviceQueries,
} from "~/lib/queries";
import { timeAgo } from "~/lib/time";

const HOUR = 3600 * 1000;

/** Warnings worth acting on, one line each. Renders nothing while loading or when all is well. */
export function AttentionStrip() {
  const { data: devices } = useQuery(deviceQueries.list());
  const { data: tokens } = useQuery(enrollmentTokenQueries.active());
  const { data: acl } = useQuery(aclQueries.get());

  const items: { key: string; text: string; href: string; action: string }[] = [];

  const stale = devices?.filter(
    (d) => !d.online && d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() > 24 * HOUR,
  );
  if (stale?.length) {
    const oldest = stale.reduce((a, b) => (a.lastSeenAt! < b.lastSeenAt! ? a : b));
    items.push({
      key: "stale",
      text: `${stale.length} ${stale.length === 1 ? "device has" : "devices have"} been offline for over a day (${oldest.name} ${timeAgo(oldest.lastSeenAt!)}).`,
      href: "/devices",
      action: "Review",
    });
  }

  const expiring = tokens?.filter((t) => new Date(t.expiresAt).getTime() - Date.now() < 24 * HOUR);
  if (expiring?.length) {
    items.push({
      key: "tokens",
      text: `${expiring.length} enrollment ${expiring.length === 1 ? "token expires" : "tokens expire"} within a day.`,
      href: "/connect",
      action: "Manage",
    });
  }

  if (acl && acl.defaultAction !== "deny") {
    items.push({
      key: "acl",
      text: "Access is open by default: every device can reach every other device.",
      href: "/access",
      action: "Restrict",
    });
  }

  if (items.length === 0) return null;

  return (
    <ul className="mb-8 flex flex-col gap-2" aria-label="Needs attention">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm"
        >
          <AlertTriangleIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1">{item.text}</span>
          <Button variant="ghost" size="sm" asChild>
            <Link href={item.href}>{item.action}</Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** First-run checklist. Each step ticks itself from live data; the card disappears once all are done. */
export function GettingStarted() {
  const organization = useOrganization();
  const { data: devices } = useQuery(deviceQueries.list());
  const { data: services } = useQuery(serviceQueries.list());
  const { data: acl } = useQuery(aclQueries.get());
  const { data: members } = useQuery(memberQueries.list(organization.id));

  if (!devices || !services || !acl || !members) return null;

  const steps = [
    { label: "Connect your first device", href: "/connect", done: devices.length > 0 },
    { label: "Publish a service", href: "/services", done: services.length > 0 },
    { label: "Create an access rule", href: "/access", done: acl.rules.length > 0 },
    { label: "Invite a teammate", href: "/members", done: members.length > 1 },
  ];
  const completed = steps.filter((s) => s.done).length;
  if (completed === steps.length) return null;

  return (
    <section className="mb-8 rounded-xl border p-5" aria-label="Getting started">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-lg font-medium">Get started</h2>
        <span className="text-muted-foreground text-sm">
          {completed} of {steps.length} done
        </span>
      </div>
      <div className="bg-muted mb-4 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full transition-all"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.label}>
            <Link
              href={step.href}
              className="hover:bg-accent flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors"
            >
              {step.done ? (
                <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CircleIcon className="text-muted-foreground size-4" />
              )}
              <span className={step.done ? "text-muted-foreground line-through" : "font-medium"}>
                {step.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
