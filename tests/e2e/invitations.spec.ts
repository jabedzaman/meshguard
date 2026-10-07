import { api, expect, invitationLink, PASSWORD, test, uniqueId } from "./support/fixtures";

test.describe("invitations", () => {
  test("invite from the members page, email via workers, duplicate and cancel", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Inviter");
    const org = await createOrganization(owner, "Invite Org");
    const guest = `guest-${uniqueId()}@e2e.test`;
    const { page } = owner;

    await page.goto("/members");
    await page.fill("input[name=email]", guest);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "admin" }).click();
    await page.click("text=Send invite");
    await expect(page.locator("li", { hasText: guest })).toContainText("admin");

    const link = await invitationLink(guest);
    expect(link).toMatch(/\/invitations\/\w+/);

    await page.fill("input[name=email]", guest);
    await page.click("text=Send invite");
    await expect(page.getByText("already invited")).toBeVisible();

    await page.locator("li", { hasText: guest }).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("No pending invitations.")).toBeVisible();
    expect(org.name).toContain("Invite Org");
  });

  test("a new user signs up from the link and joins", async ({
    browser,
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    const org = await createOrganization(owner, "Join Org");
    const email = `newbie-${uniqueId()}@e2e.test`;
    await api(owner.page, "/api/auth/organization/invite-member", { email, role: "admin" });
    const link = await invitationLink(email);

    const page = await (await browser.newContext()).newPage();
    await page.goto(link);
    await expect(page).toHaveURL(/\/sign-in\?redirectTo=%2Finvitations%2F/);
    await page.click("text=Sign up");
    await expect(page).toHaveURL(/\/sign-up\?redirectTo=%2Finvitations%2F/);
    await page.fill("#name", "New Bie");
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");

    await expect(page.getByText(`Join ${org.name}`).first()).toBeVisible();
    await expect(page.getByText(`${owner.email} invited you to join as admin`)).toBeVisible();
    await page.getByRole("button", { name: `Join ${org.name}` }).click();
    await expect(
      page.locator("[data-slot=sidebar-header] button", { hasText: org.name }),
    ).toBeVisible();
    const footer = page.locator("[data-slot=sidebar-footer]");
    await expect(footer).toContainText(email);
    await expect(footer).toContainText("admin");

    await page.goto(link);
    await expect(page.getByText("Invitation already accepted")).toBeVisible();
    await page.context().close();
  });

  test("declining, the wrong account and a cancelled invitation", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    const org = await createOrganization(owner, "Decline Org");
    const decliner = await createUser("Decliner");
    const bystander = await createUser("Bystander");
    const late = await createUser("Late");

    await api(owner.page, "/api/auth/organization/invite-member", {
      email: decliner.email,
      role: "member",
    });
    const cancelled = await api<{ id: string }>(
      owner.page,
      "/api/auth/organization/invite-member",
      {
        email: late.email,
        role: "member",
      },
    );
    await api(owner.page, "/api/auth/organization/cancel-invitation", {
      invitationId: cancelled.id,
    });
    const declineLink = await invitationLink(decliner.email);
    const cancelledLink = await invitationLink(late.email);

    // Wrong account.
    await bystander.page.goto(declineLink);
    await expect(bystander.page.getByText("This invitation is for someone else")).toBeVisible();
    await bystander.page.click("text=Switch account");
    await expect(bystander.page).toHaveURL(/\/sign-in\?redirectTo=%2Finvitations%2F/);

    // Decline.
    await decliner.page.goto(declineLink);
    await decliner.page.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(
      decliner.page.getByText(`You declined the invitation to ${org.name}.`),
    ).toBeVisible();
    await decliner.page.click("text=Continue");
    await expect(decliner.page).toHaveURL("/organizations/create");
    await decliner.page.goto(declineLink);
    await expect(decliner.page.getByText("Invitation declined")).toBeVisible();

    // Cancelled.
    await late.page.goto(cancelledLink);
    await expect(late.page.getByText("Invitation cancelled")).toBeVisible();
  });
});
