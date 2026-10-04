import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { ac, roles } from "./permissions";
import type { AuthEnv } from "@meshguard/config";
import { and, asc, eq, schema, type Db } from "@meshguard/db";

export interface AuthOptions {
  secret: string;
  /** Public URL of the API that serves /api/auth. */
  baseURL: string;
  /** Origins allowed to call the auth endpoints with cookies, e.g. the web dashboard. */
  trustedOrigins: string[];
  /** Shares session cookies across subdomains of this domain (web and API on different hosts). */
  cookieDomain?: string;
  github?: { clientId: string; clientSecret: string };
  /**
   * Sends the invitation email. Only the API (which serves /api/auth) needs
   * it; other instances, like the web app's session reader, can omit it.
   */
  sendInvitationEmail?: (invitation: InvitationEmailData) => Promise<void>;
}

export interface InvitationEmailData {
  id: string;
  email: string;
  role: string;
  organizationName: string;
  inviterName: string;
}

export function authOptionsFromEnv(env: AuthEnv): AuthOptions {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_URL],
    cookieDomain: env.AUTH_COOKIE_DOMAIN,
    github:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
        : undefined,
  };
}

// Human identity only. Devices authenticate with their own key pairs.
export function createAuth(db: Db, options: AuthOptions) {
  return betterAuth({
    appName: "MeshGuard",
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: "/api/auth",
    trustedOrigins: options.trustedOrigins,
    advanced: options.cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: options.cookieDomain } }
      : undefined,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    socialProviders: options.github ? { github: options.github } : {},
    plugins: [
      organization({
        ac,
        roles,
        sendInvitationEmail: async (data) => {
          if (!options.sendInvitationEmail) {
            throw new Error("Invitation emails are not configured on this auth instance");
          }
          await options.sendInvitationEmail({
            id: data.id,
            email: data.email,
            role: data.role,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name,
          });
        },
        // Sessions keep activeOrganizationId after the org is deleted or the
        // user is removed from it. Clear it so it can be trusted as-is (the web
        // proxy routes on it without loading the organization).
        organizationHooks: {
          afterDeleteOrganization: async ({ organization }) => {
            await db
              .update(schema.session)
              .set({ activeOrganizationId: null })
              .where(eq(schema.session.activeOrganizationId, organization.id));
          },
          afterRemoveMember: async ({ member, organization }) => {
            await db
              .update(schema.session)
              .set({ activeOrganizationId: null })
              .where(
                and(
                  eq(schema.session.userId, member.userId),
                  eq(schema.session.activeOrganizationId, organization.id),
                ),
              );
          },
        },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          // New sessions start without an active organization; default to the
          // user's oldest membership so returning users land in their org.
          before: async (session) => {
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(asc(schema.member.createdAt))
              .limit(1);
            return {
              data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
            };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export * from "./permissions";
export type Session = Auth["$Infer"]["Session"]["session"];
export type User = Auth["$Infer"]["Session"]["user"];
