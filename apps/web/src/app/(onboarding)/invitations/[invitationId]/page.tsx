import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@meshguard/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meshguard/ui/components/card";
import { InvitationResponse } from "~/components/invitation-response";
import { SignOutButton } from "~/components/sign-out-button";
import { loadInvitation } from "~/lib/invitations";
import { getSession } from "~/lib/session";

export const metadata: Metadata = { title: "Invitation" };

const UNAVAILABLE: Record<string, { title: string; description: string }> = {
  expired: {
    title: "This invitation has expired",
    description:
      "Invitations are valid for 48 hours. Ask the person who invited you to send a new one.",
  },
  accepted: {
    title: "Invitation already accepted",
    description: "You've already joined this organization.",
  },
  rejected: {
    title: "Invitation declined",
    description: "This invitation was declined. Ask for a new one if that was a mistake.",
  },
  canceled: {
    title: "Invitation cancelled",
    description: "The organization cancelled this invitation.",
  },
  not_found: {
    title: "Invitation not found",
    description: "Check that you opened the full link from the email.",
  },
};

export default async function InvitationPage({ params }: PageProps<"/invitations/[invitationId]">) {
  const { invitationId } = await params;
  const [view, session] = await Promise.all([loadInvitation(invitationId), getSession()]);

  if (view.state === "pending") {
    const { invitation } = view;
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join {invitation.organizationName}</CardTitle>
          <CardDescription>
            {invitation.inviterEmail} invited you to join as <strong>{invitation.role}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitationResponse
            invitationId={invitation.id}
            organizationName={invitation.organizationName}
          />
        </CardContent>
      </Card>
    );
  }

  if (view.state === "wrong_recipient") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>This invitation is for someone else</CardTitle>
          <CardDescription>
            You&apos;re signed in as {session?.user.email}. Sign in with the email address the
            invitation was sent to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton
            label="Switch account"
            redirectTo={`/sign-in?redirectTo=${encodeURIComponent(`/invitations/${invitationId}`)}`}
          />
        </CardContent>
      </Card>
    );
  }

  const { title, description } = UNAVAILABLE[view.state]!;
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/">Go to MeshGuard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
