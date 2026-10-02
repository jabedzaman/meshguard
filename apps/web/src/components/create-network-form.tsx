"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { getApiError, getErrorMessage } from "@mesh/api-client";
import { Button } from "@mesh/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@mesh/ui/components/form";
import { Input } from "@mesh/ui/components/input";
import { networkMutations, networkQueries } from "~/lib/queries";

// Shape checks only; the API validates the range (private, prefix, host bits)
// and its message is shown on the field.
const schema = z.object({
  name: z.string().trim().min(1, "Required").max(64, "At most 64 characters"),
  ipv4Cidr: z.string().trim(),
});

type Values = z.infer<typeof schema>;

export function CreateNetworkForm() {
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", ipv4Cidr: "" },
  });

  const createNetwork = useMutation({
    mutationFn: ({ name, ipv4Cidr }: Values) =>
      networkMutations.create({ name, ipv4Cidr: ipv4Cidr || undefined }),
    onSuccess: async () => {
      form.reset();
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
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => createNetwork.mutate(values))}
        className="flex flex-col gap-4 rounded-md border p-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Network name</FormLabel>
                <FormControl>
                  <Input placeholder="home" {...field} />
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
        </div>
        {form.formState.errors.root && (
          <p role="alert" className="text-destructive text-sm">
            {form.formState.errors.root.message}
          </p>
        )}
        <Button type="submit" className="self-start" disabled={createNetwork.isPending}>
          {createNetwork.isPending ? "Creating…" : "Create network"}
        </Button>
      </form>
    </Form>
  );
}
