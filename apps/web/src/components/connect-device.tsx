"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, LaptopIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
import { Label } from "@meshguard/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@meshguard/ui/components/select";
import { Skeleton } from "@meshguard/ui/components/skeleton";
import { useOrganization, usePermission } from "~/components/providers/organization-provider";
import { timeAgo } from "~/lib/time";
import { deviceLoginMutations, deviceLoginQueries, networkQueries } from "~/lib/queries";

const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "Linux", windows: "Windows" };

/** Approves a browser login started by `meshguard up` on another machine. */
export function ConnectDevice({ id }: { id: string }) {
  const organization = useOrganization();
  const canEnroll = usePermission({ device: ["create"] });
  const queryClient = useQueryClient();
  const [networkId, setNetworkId] = useState<string>();

  const login = useQuery({ ...deviceLoginQueries.detail(id), enabled: id !== "" });
  const networks = useQuery(networkQueries.list(organization.id));

  const approve = useMutation({
    mutationFn: (networkId: string) => deviceLoginMutations.approve(id, networkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });
  const deny = useMutation({ mutationFn: () => deviceLoginMutations.deny(id) });

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
            <Link href="/">Go to networks</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }
  if (deny.isSuccess) {
    return <Notice title="Login denied" description="The device was not connected." />;
  }

  const selected = networkId ?? (networks.data?.length === 1 ? networks.data[0]!.id : undefined);
  const error = approve.error ?? deny.error ?? networks.error;
  const busy = approve.isPending || deny.isPending;

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
        <div className="grid gap-2">
          <Label htmlFor="network">Network</Label>
          <Select value={selected} onValueChange={setNetworkId} disabled={networks.isPending}>
            <SelectTrigger id="network" className="w-full">
              <SelectValue
                placeholder={networks.data?.length === 0 ? "No networks yet" : "Choose a network"}
              />
            </SelectTrigger>
            <SelectContent>
              {networks.data?.map((network) => (
                <SelectItem key={network.id} value={network.id}>
                  {network.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {getErrorMessage(error)}
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button disabled={!selected || busy} onClick={() => selected && approve.mutate(selected)}>
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
