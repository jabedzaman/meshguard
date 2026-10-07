import { api, expect, test, type TestUser } from "./support/fixtures";

async function memberRows(user: TestUser) {
  await user.page.goto("/members");
  const rows = user.page.locator("section").first().locator("li");
  await expect(rows.first()).toBeVisible();
  return rows;
}

test.describe("members and roles", () => {
  test("what each role can change, and the server enforcing it", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Roles Org");
    const admin = await createUser("Admin");
    const member = await createUser("Member");
    await addToOrganization(owner, admin, "admin");
    await addToOrganization(owner, member, "member");

    // Owner: pickers on others, not on themselves; can assign owner.
    let rows = await memberRows(owner);
    await expect(rows.filter({ hasText: owner.email }).getByRole("combobox")).toHaveCount(0);
    await rows.filter({ hasText: member.email }).getByRole("combobox").click();
    await expect(owner.page.getByRole("option")).toHaveText(["owner", "admin", "member"]);
    await owner.page.keyboard.press("Escape");

    // Admin: owner row read-only; can't assign owner.
    rows = await memberRows(admin);
    await expect(rows.filter({ hasText: owner.email }).getByRole("combobox")).toHaveCount(0);
    await rows.filter({ hasText: member.email }).getByRole("combobox").click();
    await expect(admin.page.getByRole("option")).toHaveText(["admin", "member"]);
    await admin.page.getByRole("option", { name: "admin" }).click();
    await expect(rows.filter({ hasText: member.email }).getByRole("combobox")).toHaveText("admin");

    await member.page.goto("/");
    await expect(member.page.locator("[data-slot=sidebar-footer]")).toContainText("admin");

    // Member view: no pickers.
    const plain = await createUser("Plain");
    await addToOrganization(owner, plain, "member");
    rows = await memberRows(plain);
    await expect(rows.getByRole("combobox")).toHaveCount(0);

    // Admin can't grant owner through the API either.
    const { members } = await api<{ members: { id: string; user: { email: string } }[] }>(
      admin.page,
      "/api/auth/organization/list-members",
    );
    const target = members.find((m) => m.user.email === member.email)!;
    await expect(
      api(admin.page, "/api/auth/organization/update-member-role", {
        memberId: target.id,
        role: "owner",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test("remove a member and leave an organization", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    const org = await createOrganization(owner, "Leave Org");
    const admin = await createUser("Admin");
    const side = await createOrganization(admin, "Side Org");
    const member = await createUser("Member");
    await addToOrganization(owner, admin, "admin");
    await addToOrganization(owner, member, "member");

    // Admin removes the member.
    const rows = await memberRows(admin);
    await expect(
      rows.filter({ hasText: owner.email }).getByRole("button", { name: /Remove/ }),
    ).toHaveCount(0);
    await admin.page.getByRole("button", { name: `Remove ${member.email}` }).click();
    await expect(admin.page.getByRole("alertdialog")).toContainText(
      `${member.email} will lose access to ${org.name}.`,
    );
    await admin.page.getByRole("button", { name: "Remove member" }).click();
    await expect(rows.filter({ hasText: member.email })).toHaveCount(0);

    await member.page.goto("/");
    await expect(member.page).toHaveURL("/organizations/create");

    // The only owner can't leave.
    await owner.page.goto("/members");
    await owner.page.getByRole("button", { name: "Leave", exact: true }).click();
    await owner.page.getByRole("button", { name: "Leave organization" }).click();
    await expect(owner.page.getByRole("alertdialog").getByRole("alert")).toHaveText(
      "You cannot leave the organization as the only owner",
    );
    await owner.page.getByRole("button", { name: "Cancel" }).click();

    // Admin leaves and lands in their other organization.
    await admin.page.goto("/members");
    await admin.page.getByRole("button", { name: "Leave", exact: true }).click();
    await admin.page.getByRole("button", { name: "Leave organization" }).click();
    await expect(
      admin.page.locator("[data-slot=sidebar-header] button", { hasText: side.name }),
    ).toBeVisible();
  });
});
