"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
import { usePermission } from "~/components/providers/organization-provider";
import { networkMutations, networkQueries } from "~/lib/queries";
import { useHydrated } from "~/hooks/use-hydrated";

// Shape checks only; the API validates the range (private, prefix, host bits)
// and its message is shown on the field.
const schema = z.object({
  name: z.string().trim().min(1, "Required").max(64, "At most 64 characters"),
  ipv4Cidr: z.string().trim(),
});

type Values = z.infer<typeof schema>;

export function CreateNetworkDialog() {
  const canCreate = usePermission({ network: ["create"] });
  if (!canCreate) return null;
  return <CreateNetworkDialogInner />;
}

function CreateNetworkDialogInner() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", ipv4Cidr: "" },
  });

  const createNetwork = useMutation({
    mutationFn: ({ name, ipv4Cidr }: Values) =>
      networkMutations.create({ name, ipv4Cidr: ipv4Cidr || undefined }),
    onSuccess: async () => {
      setOpen(false);
      form.reset();
      toast.success("Network created");
      await queryClient.invalidateQueries({ queryKey: networkQueries.all() });
    },
    onError: (error) => {
      const apiError = getApiError(error);
      if (apiError?.code === "network_name_taken") {
        form.setError("name", { message: apiError.message });
        return;
      }
      const fieldErrors = Array.isArray(apiError?.details)
        ? (apiError.details as { path: string; message: string }[])
        : [];
      for (const { path, message } of fieldErrors) {
        if (path === "name" || path === "ipv4Cidr") form.setError(path, { message });
      }
      if (fieldErrors.length === 0) form.setError("root", { message: getErrorMessage(error) });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (createNetwork.isPending) return;
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={!hydrated}>
          <PlusIcon />
          New network
        </Button>
      </DialogTrigger>
      <DialogContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => createNetwork.mutate(values))}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>New network</DialogTitle>
              <DialogDescription>
                Devices in a network reach each other by name over an encrypted mesh.
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Network name</FormLabel>
                  <FormControl>
                    <Input placeholder="home" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ipv4Cidr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>IPv4 range</FormLabel>
                  <FormControl>
                    <Input placeholder="10.77.0.0/16" className="font-mono" {...field} />
                  </FormControl>
                  <FormDescription>
                    Optional. Change it if 10.77.x clashes with your LAN.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <p role="alert" className="text-destructive text-sm">
                {form.formState.errors.root.message}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={createNetwork.isPending}>
                {createNetwork.isPending ? "Creating…" : "Create network"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
