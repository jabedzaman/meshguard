import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@meshguard/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@meshguard/ui/components/card";
import { MyInvitations } from "~/components/my-invitations";
import { SignOutButton } from "~/components/sign-out-button";
import { listMyInvitations } from "~/lib/invitations";
import { orgUrl } from "~/lib/org-host";
import { getSession, listOrganizations } from "~/lib/session";

// Reads the session per request; never prerender at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Choose an organization" };

function organizationHref({ id, slug }: { id: string; slug: string }) {
  return orgUrl(slug) ?? `/api/organizations/${encodeURIComponent(id)}/activate`;
}

// Where signed-in users with several organizations pick one. Each opens on its
// own subdomain; without subdomains, the activate route makes it the active one.
// Where sign-in lands when it has no other destination.
export default async function OrganizationsPage() {
  const [session, organizations, invitations] = await Promise.all([
    getSession(),
    listOrganizations(),
    listMyInvitations(),
  ]);

  // Nothing to choose between: no organization yet, or just the one.
  const [only, ...others] = organizations;
  if (!only && invitations.length === 0) redirect("/organizations/create");
  if (only && others.length === 0 && invitations.length === 0) redirect(organizationHref(only));

  return (
    <>
      <MyInvitations invitations={invitations} />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Choose an organization</CardTitle>
          <CardDescription>Signed in as {session?.user.email}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {organizations.map((organization) => (
            <Button
              key={organization.id}
              asChild
              variant="outline"
              className="h-auto justify-start"
            >
              <a href={organizationHref(organization)}>
                <span className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 items-center justify-center rounded-lg text-sm font-semibold uppercase">
                  {organization.name[0]}
                </span>
                <span className="grid text-left leading-tight">
                  <span className="font-medium">{organization.name}</span>
                  <span className="text-muted-foreground text-xs">{organization.slug}</span>
                </span>
              </a>
            </Button>
          ))}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button asChild variant="ghost" className="w-full">
            <Link href="/organizations/create">
              <PlusIcon className="size-4" />
              New organization
            </Link>
          </Button>
          <SignOutButton variant="ghost" className="w-full" />
        </CardFooter>
      </Card>
    </>
  );
}
