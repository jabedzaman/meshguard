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
  return {
    id: res.body.device.id as string,
    privateKey: device.privateKey,
    ipv4: res.body.device.meshIpv4 as string,
  };
}

type Service = {
  id: string;
  name: string;
  vip: string;
  dnsName: string;
  hosts: { id: string; name: string; online: boolean }[];
};

test.describe("services", () => {
  test("a service gets an address and reaches a client through its first online host", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Services Org");
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const one = await enrollDevice(owner.page, network.id, "host-one");
    const two = await enrollDevice(owner.page, network.id, "host-two");
    const client = await enrollDevice(owner.page, network.id, "client");
    const create = (page: Page, body: Record<string, unknown>) =>
      api<Service>(page, `/v1/networks/${network.id}/services`, body);
    const mapOf = async (device: typeof client) =>
      (await sync(device, { endpoints: [], advertiseRoutes: [] })).body;

    // Owners and admins only; names are DNS labels.
    await expect(create(member.page, { name: "web" })).rejects.toMatchObject({ status: 403 });
    await expect(create(owner.page, { name: "-bad" })).rejects.toMatchObject({ status: 400 });
    const web = await create(owner.page, { name: "Web", hostDeviceIds: [one.id, two.id] });
    expect(web.name).toBe("web");
    await expect(create(owner.page, { name: "web" })).rejects.toMatchObject({ status: 409 });
    await expect(
      create(owner.page, { name: "db", hostDeviceIds: ["6b2c9a5e-0000-4000-8000-000000000000"] }),
    ).rejects.toMatchObject({ status: 404 });

    // An address in the network's range that no device has.
    expect(web.vip).toMatch(/^10\.77\.\d+\.\d+$/);
    expect([one.ipv4, two.ipv4, client.ipv4]).not.toContain(web.vip);

    // Nobody hosting is online yet: the client knows the service but has no host.
    expect((await mapOf(client)).services).toEqual([
      { name: "web", vip: web.vip, hosting: false, hostId: null },
    ]);

    // The first online host serves; hosts know they host.
    await sync(two, { endpoints: [] });
    expect((await mapOf(client)).services[0].hostId).toBe(two.id);
    expect((await mapOf(two)).services[0]).toMatchObject({ hosting: true, hostId: null });
    await sync(one, { endpoints: [] });
    expect((await mapOf(client)).services[0].hostId).toBe(one.id);

    const listed = await api<Service[]>(owner.page, `/v1/networks/${network.id}/services`);
    expect(listed[0]).toMatchObject({ name: "web", vip: web.vip });
    expect(listed[0]!.dnsName).toMatch(/^web\.svc\./);
    expect(listed[0]!.hosts.map((h) => h.name)).toEqual(["host-one", "host-two"]);

    // Changing the hosts moves traffic at once.
    await api(
      owner.page,
      `/v1/services/${web.id}/hosts`,
      { hostDeviceIds: [two.id] },
      { method: "PUT" },
    );
    expect((await mapOf(client)).services[0].hostId).toBe(two.id);
    expect((await mapOf(one)).services[0].hosting).toBe(false);

    // Devices enrolled later never get a service's address.
    const later = await enrollDevice(owner.page, network.id, "later");
    expect(later.ipv4).not.toBe(web.vip);
  });

  test("access rules can name a service and go away with it", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Service Rules Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const host = await enrollDevice(owner.page, network.id, "host");
    const client = await enrollDevice(owner.page, network.id, "client");
    const service = await api<Service>(owner.page, `/v1/networks/${network.id}/services`, {
      name: "web",
      hostDeviceIds: [host.id],
    });
    const rules = (page: Page = owner.page) =>
      api<{ rules: { id: string; destination: { selector: string; label: string } }[] }>(
        page,
        `/v1/networks/${network.id}/acl`,
      );
    const inbound = async (device: typeof host) =>
      (await sync(device, { endpoints: [] })).body.acl.inbound;

    await expect(
      api(owner.page, `/v1/networks/${network.id}/acl/rules`, {
        source: "*",
        destination: "service:nope",
      }),
    ).rejects.toMatchObject({ status: 404 });

    await api(
      owner.page,
      `/v1/networks/${network.id}/acl`,
      { defaultAction: "deny" },
      { method: "PATCH" },
    );
    await api(owner.page, `/v1/networks/${network.id}/acl/rules`, {
      source: `device:${client.id}`,
      destination: "service:web",
      protocol: "tcp",
      portFrom: 8080,
    });
    // Only the host gets the rule; the client learns nothing about it.
    expect(await inbound(host)).toEqual([
      { sources: [client.ipv4, expect.any(String)], protocol: "tcp", portFrom: 8080, portTo: 8080 },
    ]);
    expect(await inbound(client)).toEqual([]);
    expect((await rules()).rules[0]!.destination).toMatchObject({
      selector: "service:web",
      label: "service:web",
    });

    await api(owner.page, `/v1/services/${service.id}`, undefined, { method: "DELETE" });
    expect((await rules()).rules).toEqual([]);
    expect(await inbound(host)).toEqual([]);
  });

  test("admins manage services from the network page", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Services Web Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    await enrollDevice(owner.page, network.id, "alpha");
    await enrollDevice(owner.page, network.id, "beta");
    const page = owner.page;

    await page.goto(`/networks/${network.id}?tab=services`);
    await expect(page.getByText("No services yet.")).toBeVisible();

    await page.getByRole("button", { name: "Add service" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("web");
    await dialog.getByLabel("beta").check();
    await dialog.getByRole("button", { name: "Create service" }).click();
    await expect(dialog).toHaveCount(0);

    const row = page.locator("li", { hasText: "web.svc." });
    await expect(row).toContainText("beta");
    await expect(row).not.toContainText("alpha");
    await expect(row).toContainText(/10\.77\.\d+\.\d+/);

    await page.getByRole("button", { name: "Hosts of web" }).click();
    await page.getByRole("dialog").getByLabel("alpha").check();
    await page.getByRole("dialog").getByRole("button", { name: "Save hosts" }).click();
    await expect(row).toContainText("alpha");

    // The service can be a rule's destination.
    await page.getByRole("tab", { name: "Access" }).click();
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.getByRole("dialog").getByLabel("To", { exact: true }).click();
    await page.getByRole("option", { name: "service:web" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Add rule" }).click();
    await expect(page.locator("li", { hasText: "service:web" })).toBeVisible();

    await page.getByRole("tab", { name: "Services" }).click();
    await page.getByRole("button", { name: "Delete web" }).click();
    await page.getByRole("button", { name: "Delete service" }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("tab", { name: "Access" }).click();
    await expect(page.getByText("No access rules.")).toBeVisible();
  });
});
