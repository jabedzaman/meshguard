"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@mesh/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@mesh/ui/components/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@mesh/ui/components/form";
import { Input } from "@mesh/ui/components/input";
import { authClient, unwrap } from "~/lib/auth-client";

const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(64, "At most 64 characters"),
});

type Values = z.infer<typeof schema>;

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreateOrganization() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  // Creating an organization also makes it the session's active organization.
  const createOrganization = useMutation({
    mutationFn: ({ name }: Values) =>
      unwrap(authClient.organization.create({ name, slug: slugify(name) })),
    // Full navigation: the client router cached "/" as a redirect back here
    // from before the organization existed.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
    onSuccess: () => window.location.assign("/"),
    onError: (error) => form.setError("root", { message: error.message }),
  });

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your organization</CardTitle>
        <CardDescription>Networks and devices belong to an organization.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => createOrganization.mutate(values))}>
          <CardContent className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <p role="alert" className="text-destructive text-sm">
                {form.formState.errors.root.message}
              </p>
            )}
          </CardContent>
          <CardFooter className="mt-6">
            <Button type="submit" className="w-full" disabled={createOrganization.isPending}>
              {createOrganization.isPending ? "Creating…" : "Create organization"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
