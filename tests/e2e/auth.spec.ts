import { expect, PASSWORD, test, uniqueId } from "./support/fixtures";

test.describe("auth", () => {
  test("signed-out visits redirect to sign-in with redirectTo", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/sign-in?redirectTo=%2F");

    await page.goto("/settings");
    await expect(page).toHaveURL("/sign-in?redirectTo=%2Fsettings");
  });

  test("sign up, onboarding, sign out and sign back in", async ({ page }) => {
    const email = `jane-${uniqueId()}@e2e.test`;
    const orgName = `Acme ${uniqueId()}`;

    await page.goto("/sign-up");
    await page.fill("#name", "Jane Dev");
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await expect(page).toHaveURL("/organizations/create");

    await page.fill("input[name=name]", orgName);
    await page.click("text=Create organization");
    await expect(page.locator("header button", { hasText: orgName })).toBeVisible();
    await expect(page.locator("header")).toContainText(`${email} · owner`);

    await page.goto("/sign-in");
    await expect(page).toHaveURL("/");

    await page.click("text=Sign out");
    await expect(page).toHaveURL("/sign-in");

    await page.fill("#email", email);
    await page.fill("#password", "wrong-password-123");
    await page.click("button[type=submit]");
    await expect(page.locator("p[role=alert]")).toHaveText("Invalid email or password");

    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    // A new session gets the user's organization back.
    await expect(page.locator("header button", { hasText: orgName })).toBeVisible();
  });

  test("organization name is validated", async ({ createUser }) => {
    const user = await createUser("Val");
    await user.page.goto("/organizations/create");
    await user.page.fill("input[name=name]", "A");
    await user.page.click("text=Create organization");
    await expect(user.page.getByText("At least 2 characters")).toBeVisible();
  });
});
