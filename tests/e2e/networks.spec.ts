import { api, expect, ownNetwork, test } from "./support/fixtures";

test.describe("networks", () => {
  test("creating an organization makes its network with the default range", async ({
    createUser,
    createOrganization,
  }) => {
    const user = await createUser("Net");
    await createOrganization(user, "Net Org");
    const network = await ownNetwork<{ ipv4Cidr: string }>(user.page);
    expect(network.ipv4Cidr).toBe("10.77.0.0/16");

    // The dashboard shows it.
    await user.page.goto("/");
    await expect(user.page.getByText("10.77.0.0/16")).toBeVisible();
  });

  test("the organization form takes the range, and rejects public ones", async ({
    createUser,
  }) => {
    const user = await createUser("Range");
    const { page } = user;
    await page.goto("/organizations/create");
    await page.fill("input[name=name]", "Range Org");
    await page.fill("input[name=ipv4Cidr]", "100.64.0.0/16");
    await page.click("text=Create organization");
    await expect(page.getByText("Must be within a private range")).toBeVisible();

    await page.fill("input[name=ipv4Cidr]", "172.20.0.0/16");
    await page.click("text=Create organization");
    await expect(page.getByText("172.20.0.0/16")).toBeVisible();
  });

  test("each network gets its own random DNS domain", async ({
    createUser,
    createOrganization,
  }) => {
    const user = await createUser("Dns");
    await createOrganization(user, "Dns Org");
    const home = await ownNetwork(user.page);
    const other = await createUser("Dns2");
    await createOrganization(other, "Dns Org 2");
    const lab = await ownNetwork(other.page);

    // Like a tailnet name: two random words under the base domain.
    expect(home.dnsDomain).toMatch(/^[a-z]+-[a-z]+\.mesh\.jabed\.dev$/);
    expect(lab.dnsDomain).not.toBe(home.dnsDomain);

    await user.page.goto("/devices");
    await expect(user.page.getByText(home.dnsDomain)).toBeVisible();
  });

  test("members can see the network but not create more", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Perm Org");
    const network = await ownNetwork(owner.page);

    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    await member.page.goto("/");
    await expect(member.page.locator("[data-slot=sidebar-footer]")).toContainText("member");
    await expect(member.page.getByText(network.dnsDomain)).toBeVisible();

    // Networks are made with organizations, not through the API.
    await expect(api(owner.page, "/v1/network", { name: "second" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
