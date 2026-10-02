import { sql } from "./support/db";
import { api, expect, PASSWORD, test } from "./support/fixtures";

test.describe("organizations", () => {
  test("switcher creates a second org with its own networks and switches back", async ({
    createUser,
    createOrganization,
  }) => {
    const user = await createUser("Switch");
    const first = await createOrganization(user, "First");
    const { page } = user;

    await page.goto("/");
    await page.fill("input[name=name]", "home");
    await page.click("text=Create network");
    await expect(page.locator("li", { hasText: "home" })).toBeVisible();

    await page.click(`header button:has-text("${first.name}")`);
    await page.click("text=New organization");
    await expect(page).toHaveURL("/organizations/create");
    const secondName = `Second ${Date.now()}`;
    await page.fill("input[name=name]", secondName);
    await page.click("text=Create organization");
    await expect(page.locator("header button", { hasText: secondName })).toBeVisible();
    await expect(page.getByText("No networks yet.")).toBeVisible();

    await page.click(`header button:has-text("${secondName}")`);
    await expect(page.getByRole("menuitem")).toHaveText([
      first.name,
      secondName,
      "New organization",
    ]);
    await page.getByRole("menuitem", { name: first.name }).click();
    await expect(page.locator("header button", { hasText: first.name })).toBeVisible();
    await expect(page.locator("li", { hasText: "home" })).toBeVisible();
  });

  test("a session without an active organization is recovered", async ({
    createUser,
    createOrganization,
  }) => {
    const user = await createUser("Recover");
    const org = await createOrganization(user, "Recover Org");
    await sql(
      `update session set active_organization_id = null
       where user_id = (select id from "user" where email = $1)`,
      [user.email],
    );

    await user.page.goto("/");
    await expect(user.page.locator("header button", { hasText: org.name })).toBeVisible();
  });

  test("deleting an organization clears it from the user's other sessions", async ({
    browser,
    createUser,
    createOrganization,
  }) => {
    const user = await createUser("Deleter");
    const org = await createOrganization(user, "Doomed");

    // Second session for the same user.
    const other = await (await browser.newContext()).newPage();
    await api(other, "/api/auth/sign-in/email", { email: user.email, password: PASSWORD });

    await api(user.page, "/api/auth/organization/delete", { organizationId: org.id });

    await other.goto("/");
    await expect(other).toHaveURL("/organizations/create");
    await other.context().close();
  });
});
