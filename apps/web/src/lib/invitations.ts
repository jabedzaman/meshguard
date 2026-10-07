import "server-only";
import { headers } from "next/headers";
import { eq, schema } from "@meshguard/db";
import { auth, getDb } from "~/lib/auth";
import { getSession } from "~/lib/session";

export type InvitationView =
  | {
      state: "pending";
      invitation: {
        id: string;
        organizationName: string;
        inviterEmail: string;
        role: string;
        expiresAt: Date;
      };
    }
  | { state: "wrong_recipient" }
  | { state: "expired" | "accepted" | "rejected" | "canceled" | "not_found" };

function errorCode(error: unknown): string | undefined {
  return (error as { body?: { code?: string } }).body?.code;
}

/**
 * Loads an invitation for the signed-in user. Better Auth decides whether the
 * user may see it; when it can't be shown, only its status is read so the page
 * can explain why, without revealing the organization.
 */
export async function loadInvitation(id: string): Promise<InvitationView> {
  try {
    const invitation = await auth.api.getInvitation({ headers: await headers(), query: { id } });
    return {
      state: "pending",
      invitation: {
        id: invitation.id,
        organizationName: invitation.organizationName,
        inviterEmail: invitation.inviterEmail,
        role: invitation.role,
        expiresAt: new Date(invitation.expiresAt),
      },
    };
  } catch (error) {
    if (errorCode(error) === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION") {
      return { state: "wrong_recipient" };
    }
  }

  const [row] = await getDb()
    .select({ status: schema.invitation.status, expiresAt: schema.invitation.expiresAt })
    .from(schema.invitation)
    .where(eq(schema.invitation.id, id));
  if (!row) return { state: "not_found" };
  if (row.status === "pending") return { state: "expired" };
  if (row.status === "accepted" || row.status === "rejected" || row.status === "canceled") {
    return { state: row.status };
  }
  return { state: "not_found" };
}

export type MyInvitation = { id: string; organizationName: string; role: string };

/**
 * Pending, unexpired invitations addressed to the signed-in user's email.
 * Called without the session's headers on purpose: Better Auth's client-facing
 * listing refuses users whose email is unverified, while the invitation link
 * page (see loadInvitation) only matches on the address. This stays consistent
 * with that policy.
 */
export async function listMyInvitations(): Promise<MyInvitation[]> {
  const session = await getSession();
  if (!session) return [];
  const invitations = await auth.api.listUserInvitations({ query: { email: session.user.email } });
  const now = Date.now();
  return invitations
    .filter(
      (invitation) =>
        invitation.status === "pending" && new Date(invitation.expiresAt).getTime() > now,
    )
    .map(({ id, organizationName, role }) => ({ id, organizationName, role }));
}
