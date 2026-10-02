"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@mesh/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mesh/ui/components/dropdown-menu";
import {
  type ActiveOrganization,
  useOrganization,
} from "~/components/providers/organization-provider";
import { authClient, unwrap } from "~/lib/auth-client";

export function OrganizationSwitcher({ organizations }: { organizations: ActiveOrganization[] }) {
  const active = useOrganization();

  const switchOrganization = useMutation({
    mutationFn: (organizationId: string) =>
      unwrap(authClient.organization.setActive({ organizationId })),
    // Full navigation drops router and query caches holding the previous org's data.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
    onSuccess: () => window.location.assign("/"),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto gap-3 px-2 py-1.5"
          disabled={switchOrganization.isPending}
        >
          <span className="grid text-left leading-tight">
            <span className="text-xl font-semibold">{active.name}</span>
            <span className="text-muted-foreground text-xs">{active.slug}</span>
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          Organizations
        </DropdownMenuLabel>
        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization.id}
            onSelect={() => {
              if (organization.id !== active.id) switchOrganization.mutate(organization.id);
            }}
          >
            <span className="flex-1 truncate">{organization.name}</span>
            {organization.id === active.id && <CheckIcon className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/organizations/create" className="text-muted-foreground">
            <PlusIcon className="size-4" />
            New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
