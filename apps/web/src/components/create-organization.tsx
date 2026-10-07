"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@meshguard/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@meshguard/ui/components/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@meshguard/ui/components/form";
import { Input } from "@meshguard/ui/components/input";
import { authClient, unwrap } from "~/lib/auth-client";
import { useHydrated } from "~/hooks/use-hydrated";
import { useResetNavigate } from "~/hooks/use-session-navigation";
import { REDIRECT_PARAM, safeRedirect } from "~/lib/redirect";
import { SignOutButton } from "~/components/sign-out-button";

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
  const hydrated = useHydrated();
  const navigate = useResetNavigate();
  const redirectTo = safeRedirect(useSearchParams().get(REDIRECT_PARAM));
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  // Creating an organization also makes it the session's active organization.
  const createOrganization = useMutation({
    mutationFn: ({ name }: Values) =>
      unwrap(authClient.organization.create({ name, slug: slugify(name) })),
    // Resets the router cache: it holds "/" as a redirect back here.
    onSuccess: () => navigate(redirectTo),
    onError: (error) => form.setError("root", { message: error.message }),
  });

  // A user who already belongs to an organization can back out of creating another.
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => unwrap(authClient.organization.list()),
  });
  const hasOrganization = (organizations.data?.length ?? 0) > 0;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create an organization</CardTitle>
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
          <CardFooter className="mt-6 flex-col gap-2">
            <Button
              type="submit"
              className="w-full"
              disabled={!hydrated || createOrganization.isPending}
            >
              {createOrganization.isPending ? "Creating…" : "Create organization"}
            </Button>
            {hasOrganization ? (
              <Button asChild variant="ghost" className="w-full">
                <Link href={redirectTo}>Cancel</Link>
              </Button>
            ) : (
              <SignOutButton variant="ghost" className="w-full" />
            )}
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
