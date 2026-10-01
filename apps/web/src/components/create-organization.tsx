"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@mesh/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@mesh/ui/components/card";
import { Input } from "@mesh/ui/components/input";
import { Label } from "@mesh/ui/components/label";
import { authClient } from "~/lib/auth-client";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreateOrganization() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name")).trim();

    setPending(true);
    setError(null);
    // Creating an organization also makes it the session's active organization.
    const { error } = await authClient.organization.create({ name, slug: slugify(name) });
    setPending(false);
    if (error) setError(error.message ?? "Could not create organization.");
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your organization</CardTitle>
        <CardDescription>Networks and devices belong to an organization.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="org-name">Name</Label>
          <Input id="org-name" name="name" placeholder="Acme" required />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-6">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating…" : "Create organization"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
