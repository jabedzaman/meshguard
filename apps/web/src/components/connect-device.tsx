"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, LaptopIcon } from "lucide-react";
import Link from "next/link";
import { getErrorMessage } from "@meshguard/api-client";
import { Button } from "@meshguard/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@meshguard/ui/components/card";
import { Skeleton } from "@meshguard/ui/components/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@meshguard/ui/components/select";
import { useOrganization, usePermission } from "~/components/providers/organization-provider";
import { useResetNavigate } from "~/hooks/use-session-navigation";
import { authClient, unwrap } from "~/lib/auth-client";
import { timeAgo } from "~/lib/time";
import { deviceLoginMutations, deviceLoginQueries, networkQueries } from "~/lib/queries";

const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "Linux", windows: "Windows" };

export type ConnectOrganization = { id: string; name: string; url: string | null };

/** Approves a browser login started by `meshguard up` on another machine. */
export function ConnectDevice({
  id,
  organizations,
}: {
  id: string;
  organizations: ConnectOrganization[];
}) {
  const organization = useOrganization();
  const navigate = useResetNavigate();
  const canEnroll = usePermission({ device: ["create"] });
  const queryClient = useQueryClient();

  const login = useQuery({ ...deviceLoginQueries.detail(id), enabled: id !== "" });
  const network = useQuery(networkQueries.current());

  const approve = useMutation({
    mutationFn: () => deviceLoginMutations.approve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });
  const deny = useMutation({ mutationFn: () => deviceLoginMutations.deny(id) });
  // Approval joins the session's active organization, so choosing one switches it.
  const switchOrganization = useMutation({
    mutationFn: (target: ConnectOrganization) =>
      unwrap(authClient.organization.setActive({ organizationId: target.id })),
    onSuccess: (_, target) => navigate(target.url ?? `/connect?login=${encodeURIComponent(id)}`),
  });

  if (id === "") {
    return (
      <Notice
        title="No login link"
        description="Run meshguard up on the device and open the link it prints."
      />
    );
  }
  if (login.isPending) return <Skeleton className="h-56 rounded-xl" />;
  if (login.error) {
    return (
      <Notice
        title="This login has expired"
        description="Logins last 10 minutes. Run meshguard up again on the device to get a new link."
      />
    );
  }
  if (!canEnroll) {
    return (
      <Notice
        title="Your role can't add devices"
        description={`Ask an owner or admin of ${organization.name} to approve this device.`}
      />
    );
  }
  if (approve.isSuccess || login.data.approved) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5" /> Device approved
          </CardTitle>
          <CardDescription>
            {login.data.hostname} is joining. It appears in the network in a few seconds.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href="/devices">Go to devices</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }
  if (deny.isSuccess) {
    return <Notice title="Login denied" description="The device was not connected." />;
  }

  const error = approve.error ?? deny.error ?? network.error ?? switchOrganization.error;
  const busy = approve.isPending || deny.isPending || switchOrganization.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LaptopIcon className="size-5" /> {login.data.hostname}
        </CardTitle>
        <CardDescription>
          Check that this code matches the one in your terminal, and only continue if you ran the
          command yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="font-mono text-2xl tracking-widest">{login.data.userCode}</p>
        <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt>System</dt>
          <dd className="text-foreground">
            {PLATFORMS[login.data.platform] ?? login.data.platform}
          </dd>
          {login.data.ip && (
            <>
              <dt>Requested from</dt>
              <dd className="text-foreground">{login.data.ip}</dd>
            </>
          )}
          <dt>Requested</dt>
          <dd className="text-foreground">{timeAgo(login.data.startedAt)}</dd>
        </dl>
        <div className="flex flex-col gap-2">
          <label htmlFor="connect-organization" className="text-sm font-medium">
            Join organization
          </label>
          <Select
            value={organization.id}
            disabled={busy || organizations.length < 2}
            onValueChange={(value) => {
              const target = organizations.find((o) => o.id === value);
              if (target) switchOrganization.mutate(target);
            }}
          >
            <SelectTrigger id="connect-organization" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {network.data && (
            <p className="text-muted-foreground text-sm">
              {login.data.hostname} joins the{" "}
              <span className="text-foreground font-medium">{network.data.name}</span> network.
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {getErrorMessage(error)}
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button disabled={!network.data || busy} onClick={() => approve.mutate()}>
          {approve.isPending ? "Approving…" : "Approve"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => deny.mutate()}>
          Deny
        </Button>
      </CardFooter>
    </Card>
  );
}

function Notice({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
