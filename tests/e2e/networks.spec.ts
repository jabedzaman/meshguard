import { api, expect, test } from "./support/fixtures";

test.describe("networks", () => {
  test("create with the default range, reject duplicates and public ranges", async ({
    createUser,
    createOrganization,
  }) => {
    const user = await createUser("Net");
    await createOrganization(user, "Net Org");
    const { page } = user;
    await page.goto("/");

    await page.getByRole("button", { name: "New network" }).click();
    await page.fill("input[name=name]", "home");
    await page.click("text=Create network");
    const row = page.locator("li", { hasText: "home" });
    await expect(row).toContainText("10.77.0.0/16");
    await expect(row).toContainText(/fd[0-9a-f]{2}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::\/48/);

    await page.getByRole("button", { name: "New network" }).click();
    await page.fill("input[name=name]", "home");
    await page.click("text=Create network");
    await expect(page.getByText("A network with this name already exists")).toBeVisible();

    await page.fill("input[name=name]", "lab");
    await page.fill("input[name=ipv4Cidr]", "100.64.0.0/16");
    await page.click("text=Create network");
    await expect(page.getByText("Must be within a private range")).toBeVisible();

    await page.fill("input[name=ipv4Cidr]", "172.20.0.0/16");
    await page.click("text=Create network");
    await expect(page.locator("li", { hasText: "lab" })).toContainText("172.20.0.0/16");
  });

  test("each network gets its own random DNS domain", async ({
    createUser,
    createOrganization,
  }) => {
    const user = await createUser("Dns");
    await createOrganization(user, "Dns Org");
    const create = (name: string) =>
      api<{ id: string; dnsDomain: string }>(user.page, "/v1/networks", { name });
    const home = await create("home");
    const lab = await create("lab");

    // Like a tailnet name: two random words under the base domain.
    expect(home.dnsDomain).toMatch(/^[a-z]+-[a-z]+\.mesh\.jabed\.dev$/);
    expect(lab.dnsDomain).not.toBe(home.dnsDomain);

    await user.page.goto(`/networks/${home.id}`);
    await expect(user.page.getByText(home.dnsDomain)).toBeVisible();
  });

  test("members can see networks but not create them", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Perm Org");
    await owner.page.goto("/");
    await owner.page.getByRole("button", { name: "New network" }).click();
    await owner.page.fill("input[name=name]", "shared");
    await owner.page.click("text=Create network");
    await expect(owner.page.locator("li", { hasText: "shared" })).toBeVisible();

    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    await member.page.goto("/");
    await expect(member.page.locator("[data-slot=sidebar-footer]")).toContainText("member");
    await expect(member.page.locator("li", { hasText: "shared" })).toBeVisible();
    await expect(member.page.getByRole("button", { name: "New network" })).toHaveCount(0);

    await expect(api(member.page, "/v1/networks", { name: "sneaky" })).rejects.toMatchObject({
      status: 403,
      body: { error: { code: "insufficient_permissions" } },
    });
  });
});
