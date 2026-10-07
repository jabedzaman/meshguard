import type { Page } from "@playwright/test";
import { enroll, signingDevice, sync } from "./support/devices";
import { api, expect, test } from "./support/fixtures";

async function enrollDevice(page: Page, networkId: string, hostname: string) {
  const { token } = await api<{ token: string }>(
    page,
    `/v1/networks/${networkId}/enrollment-tokens`,
    {},
  );
  const device = signingDevice();
  const res = await enroll({ token, hostname, platform: "linux", ...device.keys });
  expect(res.status).toBe(201);
  return { id: res.body.device.id as string, privateKey: device.privateKey };
}

type Connector = {
  id: string;
  name: string;
  domains: string[];
  hosts: { id: string; name: string; online: boolean }[];
};

test.describe("app connectors", () => {
  test("a connector names domains and hosts, and clients are pointed at the first online host", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Connectors Org");
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const gateway = await enrollDevice(owner.page, network.id, "gateway");
    const client = await enrollDevice(owner.page, network.id, "client");
    const create = (page: Page, body: Record<string, unknown>) =>
      api<Connector>(page, `/v1/networks/${network.id}/connectors`, body);
    const mapOf = async (device: typeof client) =>
      (await sync(device, { endpoints: [], advertiseRoutes: [] })).body;

    // Owners and admins only; names and domains are checked.
    const body = {
      name: "corp",
      domains: ["Corp.Example.COM", "*.tool.example.org"],
      hostDeviceIds: [gateway.id],
    };
    await expect(create(member.page, body)).rejects.toMatchObject({ status: 403 });
    await expect(create(owner.page, { ...body, name: "-bad" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(create(owner.page, { ...body, domains: [] })).rejects.toMatchObject({
      status: 400,
    });
    await expect(create(owner.page, { ...body, domains: ["not a domain"] })).rejects.toMatchObject({
      status: 400,
    });
    await expect(create(owner.page, { ...body, domains: ["com"] })).rejects.toMatchObject({
      status: 400,
    });
    const created = await create(owner.page, body);
    expect(created.domains).toEqual(["corp.example.com", "tool.example.org"]);
    await expect(create(owner.page, body)).rejects.toMatchObject({ status: 409 });

    // No host online yet; once the gateway syncs, the client is pointed at it.
    expect((await mapOf(client)).connectors).toEqual([
      { name: "corp", domains: created.domains, hosting: false, hostId: null },
    ]);
    await sync(gateway, { endpoints: [] });
    expect((await mapOf(client)).connectors[0].hostId).toBe(gateway.id);
    expect((await mapOf(gateway)).connectors[0]).toMatchObject({ hosting: true, hostId: null });

    // Editing moves it at once, and the list shows who is online.
    await api(
      owner.page,
      `/v1/connectors/${created.id}`,
      { domains: ["only.example.net"] },
      { method: "PATCH" },
    );
    expect((await mapOf(client)).connectors[0].domains).toEqual(["only.example.net"]);
    await api(
      owner.page,
      `/v1/connectors/${created.id}`,
      { hostDeviceIds: [] },
      { method: "PATCH" },
    );
    expect((await mapOf(client)).connectors[0].hostId).toBeNull();
    const listed = await api<Connector[]>(owner.page, `/v1/networks/${network.id}/connectors`);
    expect(listed[0]).toMatchObject({ name: "corp", hosts: [] });

    await api(owner.page, `/v1/connectors/${created.id}`, undefined, { method: "DELETE" });
    expect((await mapOf(client)).connectors).toEqual([]);
  });

  test("admins manage connectors from the network page", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Connectors Web Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    await enrollDevice(owner.page, network.id, "gateway");
    const page = owner.page;

    await page.goto(`/networks/${network.id}?tab=services`);
    await expect(page.getByText("No app connectors yet.")).toBeVisible();
    await page.getByRole("button", { name: "Add connector" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("corp");
    await dialog.getByLabel("Domains").fill("corp.example.com, tool.example.org");
    await dialog.getByLabel("gateway").check();
    await dialog.getByRole("button", { name: "Create connector" }).click();
    await expect(dialog).toHaveCount(0);

    const row = page.locator("li", { hasText: "corp.example.com" });
    await expect(row).toContainText("tool.example.org");
    await expect(row).toContainText("gateway");

    await page.getByRole("button", { name: "Delete corp" }).click();
    await page.getByRole("button", { name: "Delete connector" }).click();
    await expect(row).toHaveCount(0);
  });
});
