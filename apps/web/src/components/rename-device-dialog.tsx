"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { deviceMutations, deviceQueries } from "~/lib/queries";

// Mirrors DEVICE_NAME_PATTERN in server-core; the API has the final say.
const schema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
      "Use 1–63 letters, digits and hyphens, not starting or ending with a hyphen",
    ),
});

type Values = z.infer<typeof schema>;

export function RenameDeviceDialog({ device }: { device: { id: string; name: string } }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: device.name },
  });

  const rename = useMutation({
    mutationFn: ({ name }: Values) => deviceMutations.rename(device.id, name),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: deviceQueries.all() });
    },
    onError: (error) => {
      const apiError = getApiError(error);
      const fieldError = Array.isArray(apiError?.details)
        ? (apiError.details as { path: string; message: string }[]).find((d) => d.path === "name")
        : undefined;
      form.setError(apiError?.code === "device_name_taken" || fieldError ? "name" : "root", {
        message: fieldError?.message ?? getErrorMessage(error),
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (rename.isPending) return;
        setOpen(next);
        if (next) form.reset({ name: device.name });
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Rename ${device.name}`}>
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => rename.mutate(values))}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Rename {device.name}</DialogTitle>
              <DialogDescription>
                The name is also the device&apos;s address on the mesh. Peers pick up the new one
                within a few seconds.
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Device name</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" spellCheck={false} {...field} />
                  </FormControl>
                  <FormDescription>
                    Resolves as <span className="font-mono">{field.value || "name"}.internal</span>
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
              <Button type="submit" disabled={rename.isPending}>
                {rename.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
