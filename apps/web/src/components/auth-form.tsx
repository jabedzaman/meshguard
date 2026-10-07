"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { Button } from "@meshguard/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@meshguard/ui/components/card";
import { Input } from "@meshguard/ui/components/input";
import { Label } from "@meshguard/ui/components/label";
import { authClient, unwrap } from "~/lib/auth-client";
import { useResetNavigate } from "~/hooks/use-session-navigation";
import { ADD_ACCOUNT_PARAM, REDIRECT_PARAM, safeRedirect } from "~/lib/redirect";
import { useHydrated } from "~/hooks/use-hydrated";

type Mode = "sign-in" | "sign-up";

const copy = {
  "sign-in": {
    title: "Sign in",
    description: "Welcome back.",
    submit: "Sign in",
    switchText: "No account?",
    switchHref: "/sign-up",
    switchLabel: "Sign up",
  },
  "sign-up": {
    title: "Create an account",
    description: "Connect your machines in a few minutes.",
    submit: "Create account",
    switchText: "Already have an account?",
    switchHref: "/sign-in",
    switchLabel: "Sign in",
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const hydrated = useHydrated();
  const searchParams = useSearchParams();
  const navigate = useResetNavigate();
  const t = copy[mode];
  const redirectTo = safeRedirect(searchParams.get(REDIRECT_PARAM));
  const addingAccount = searchParams.has(ADD_ACCOUNT_PARAM);

  // Carry over the params that shape the flow (redirect target, add-account).
  const carried = new URLSearchParams();
  for (const key of [REDIRECT_PARAM, ADD_ACCOUNT_PARAM]) {
    const value = searchParams.get(key);
    if (value !== null) carried.set(key, value);
  }
  const switchHref = carried.size ? `${t.switchHref}?${carried}` : t.switchHref;

  const emailAuth = useMutation({
    mutationFn: (form: FormData) => {
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      return mode === "sign-up"
        ? unwrap(authClient.signUp.email({ name: String(form.get("name")), email, password }))
        : unwrap(authClient.signIn.email({ email, password }));
    },
    onSuccess: () => navigate(redirectTo),
  });

  const githubAuth = useMutation({
    mutationFn: () =>
      unwrap(
        authClient.signIn.social({
          provider: "github",
          callbackURL: new URL(redirectTo, window.location.origin).href,
        }),
      ),
  });

  const error = emailAuth.error ?? githubAuth.error;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    githubAuth.reset();
    emailAuth.mutate(new FormData(e.currentTarget));
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      {/* method="post": a submit before hydration must never put the password in the URL. */}
      <form method="post" onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-4">
          {mode === "sign-up" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" required />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              minLength={8}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error.message}
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={!hydrated || emailAuth.isPending}>
            {emailAuth.isPending ? "Please wait…" : t.submit}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!hydrated || githubAuth.isPending}
            onClick={() => {
              emailAuth.reset();
              githubAuth.mutate();
            }}
          >
            Continue with GitHub
          </Button>
          <p className="text-muted-foreground text-sm">
            {t.switchText}{" "}
            <Link href={switchHref} className="text-foreground underline underline-offset-4">
              {t.switchLabel}
            </Link>
          </p>
          {addingAccount && (
            <Link
              href={redirectTo}
              className="text-muted-foreground text-sm underline underline-offset-4"
            >
              Cancel
            </Link>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
