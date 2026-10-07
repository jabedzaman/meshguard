"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { getApiError, getErrorMessage } from "@meshguard/api-client";
import { Button } from "@meshguard/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@meshguard/ui/components/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@meshguard/ui/components/form";
import { Input } from "@meshguard/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@meshguard/ui/components/select";
import { useOrganization } from "~/components/providers/organization-provider";
import {
  aclMutations,
  aclQueries,
  type CreateAclRuleInput,
  memberQueries,
  serviceQueries,
} from "~/lib/queries";

/** Selector for any device; the others are `device:<id>`, `tag:<name>`, `user:<id>`, `role:<role>`, `service:<name>`. */
const ANY = "*";

const ROLES = [
  { value: "role:owner", label: "Owners' devices" },
  { value: "role:admin", label: "Admins' devices" },
  { value: "role:member", label: "Members' devices" },
] as const;

const PROTOCOLS = [
  { value: "any", label: "All traffic" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
  { value: "icmp", label: "ICMP (ping)" },
] as const;

const schema = z
  .object({
    source: z.string(),
    destination: z.string(),
    protocol: z.enum(["any", "tcp", "udp", "icmp"]),
    /** "22", "8000-8100" or empty for every port. */
    ports: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    if (values.source.startsWith("device:") && values.source === values.destination) {
      ctx.addIssue({
        code: "custom",
        path: ["destination"],
        message: "A device always reaches itself",
      });
    }
    if (!values.ports) return;
    if (values.protocol !== "tcp" && values.protocol !== "udp") {
      ctx.addIssue({ code: "custom", path: ["ports"], message: "Ports need TCP or UDP" });
      return;
    }
    const range = parsePorts(values.ports);
    if (!range) {
      ctx.addIssue({
        code: "custom",
        path: ["ports"],
        message: "A port like 22 or a range like 8000-8100 (1–65535)",
      });
    }
  });

type Values = z.infer<typeof schema>;

function parsePorts(ports: string) {
  const match = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(ports);
  if (!match) return null;
  const portFrom = Number(match[1]);
  const portTo = match[2] === undefined ? portFrom : Number(match[2]);
  if (portFrom < 1 || portTo > 65535 || portTo < portFrom) return null;
  return { portFrom, portTo };
}

function toRule(values: Values): CreateAclRuleInput {
  return {
    source: values.source,
    destination: values.destination,
    protocol: values.protocol,
    ...(values.ports ? parsePorts(values.ports) : {}),
  };
}

/** API field → form field, for showing validation errors in place. */
const FIELDS: Record<string, keyof Values> = {
  source: "source",
  destination: "destination",
  portFrom: "ports",
  portTo: "ports",
};

const DEFAULTS: Values = { source: ANY, destination: ANY, protocol: "tcp", ports: "" };

export function AddAccessRuleDialog({
  networkId,
  devices,
}: {
  networkId: string;
  devices: { id: string; name: string; tags: string[] }[];
}) {
  const queryClient = useQueryClient();
  const organization = useOrganization();
  const { data: members = [] } = useQuery(memberQueries.list(organization.id));
  const { data: services = [] } = useQuery(serviceQueries.list(networkId));
  const tags = [...new Set(devices.flatMap((device) => device.tags))].sort();
  const [open, setOpen] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });
  const protocol = useWatch({ control: form.control, name: "protocol" });

  const create = useMutation({
    mutationFn: (values: Values) => aclMutations.createRule(networkId, toRule(values)),
    onSuccess: async () => {
      setOpen(false);
      toast.success("Rule added", { description: "Devices pick it up within a second or two." });
      await queryClient.invalidateQueries({ queryKey: aclQueries.all() });
    },
    onError: (error) => {
      const details = getApiError(error)?.details;
      const fieldError = Array.isArray(details)
        ? (details as { path: string; message: string }[]).find((d) => FIELDS[d.path])
        : undefined;
      form.setError(fieldError ? FIELDS[fieldError.path]! : "root", {
        message: fieldError?.message ?? getErrorMessage(error),
      });
    },
  });

  const deviceSelect = (name: "source" | "destination", label: string, anyLabel: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={ANY}>{anyLabel}</SelectItem>
              {tags.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Tags</SelectLabel>
                  {tags.map((tag) => (
                    <SelectItem key={tag} value={`tag:${tag}`}>
                      tag:{tag}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {services.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Services</SelectLabel>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={`service:${service.name}`}>
                      service:{service.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>Roles</SelectLabel>
                {ROLES.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              {members.length > 0 && (
                <SelectGroup>
                  <SelectLabel>People&apos;s devices</SelectLabel>
                  {members.map((member) => (
                    <SelectItem key={member.userId} value={`user:${member.userId}`}>
                      {member.user.name || member.user.email}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {devices.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Devices</SelectLabel>
                  {devices.map((device) => (
                    <SelectItem key={device.id} value={`device:${device.id}`}>
                      {device.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        setOpen(next);
        if (next) form.reset(DEFAULTS);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          Add rule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => create.mutate(values))}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Add an access rule</DialogTitle>
              <DialogDescription>
                Lets devices open connections to others: by device, by tag, by person (their
                devices), by role or by service (the devices hosting it). Replies always get back,
                so the other direction needs its own rule only if it opens connections too.
              </DialogDescription>
            </DialogHeader>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              {deviceSelect("source", "From", "Any device")}
              {deviceSelect("destination", "To", "Every device")}
            </div>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="protocol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Protocol</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        if (value !== "tcp" && value !== "udp") form.setValue("ports", "");
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROTOCOLS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ports"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ports</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={protocol === "tcp" || protocol === "udp" ? "All ports" : "—"}
                        disabled={protocol !== "tcp" && protocol !== "udp"}
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>e.g. 22 or 8000-8100</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {form.formState.errors.root && (
              <p role="alert" className="text-destructive text-sm">
                {form.formState.errors.root.message}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Adding…" : "Add rule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
