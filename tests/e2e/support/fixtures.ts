import { test as base, expect, type Page } from "@playwright/test";
import { E2E } from "./env";

export const PASSWORD = "correct-horse-battery";

let counter = 0;
/** Unique per test run and worker, so tests can run in parallel on one database. */
export function uniqueId() {
  return `${Date.now().toString(36)}${process.pid.toString(36)}${(counter++).toString(36)}`;
}

export interface TestUser {
  name: string;
  email: string;
  page: Page;
}

/** Calls Better Auth / API endpoints as the page's signed-in user. */
export async function api<T = unknown>(page: Page, path: string, data?: unknown): Promise<T> {
  const res = data
    ? await page.request.post(`${E2E.apiUrl}${path}`, { headers: { Origin: E2E.webUrl }, data })
    : await page.request.get(`${E2E.apiUrl}${path}`, { headers: { Origin: E2E.webUrl } });
  const body = await res.json().catch(() => null);
  if (!res.ok())
    throw Object.assign(new Error(`${path} -> ${res.status()}`), { status: res.status(), body });
  return body as T;
}

/** Latest invitation link sent to `to`, via the shared Mailpit. */
export async function invitationLink(to: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${E2E.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
        );
        const { messages } = (await res.json()) as { messages: { ID: string }[] };
        if (!messages[0]) return false;
        const message = (await (
          await fetch(`${E2E.mailpitUrl}/api/v1/message/${messages[0].ID}`)
        ).json()) as {
          Text: string;
        };
        link = message.Text.match(/https?:\/\/\S+\/invitations\/\S+/)?.[0];
        return Boolean(link);
      },
      { message: `invitation email to ${to}`, timeout: 20_000 },
    )
    .toBe(true);
  return link!.replace(/^https?:\/\/[^/]+/, E2E.webUrl);
}

interface Fixtures {
  /** Creates a signed-in user in their own browser context. */
  createUser: (name: string) => Promise<TestUser>;
  /** Creates an organization (active) for the user and returns its name and id. */
  createOrganization: (user: TestUser, name: string) => Promise<{ id: string; name: string }>;
  /** Invites the user to the owner's active organization and accepts it. */
  addToOrganization: (owner: TestUser, user: TestUser, role: "admin" | "member") => Promise<void>;
}

export const test = base.extend<Fixtures>({
  createUser: async ({ browser }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (name) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${uniqueId()}@e2e.test`;
      await api(page, "/api/auth/sign-up/email", { name, email, password: PASSWORD });
      return { name, email, page };
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
  createOrganization: async ({}, use) => {
    await use(async (user, name) => {
      const id = uniqueId();
      const fullName = `${name} ${id}`;
      const org = await api<{ id: string }>(user.page, "/api/auth/organization/create", {
        name: fullName,
        slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${id}`,
      });
      return { id: org.id, name: fullName };
    });
  },
  addToOrganization: async ({}, use) => {
    await use(async (owner, user, role) => {
      const invitation = await api<{ id: string }>(
        owner.page,
        "/api/auth/organization/invite-member",
        {
          email: user.email,
          role,
        },
      );
      await api(user.page, "/api/auth/organization/accept-invitation", {
        invitationId: invitation.id,
      });
    });
  },
});

export { expect };
