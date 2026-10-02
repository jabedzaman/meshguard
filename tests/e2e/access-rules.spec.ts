import type { Page } from "@playwright/test";
import { enroll, signingDevice, sync } from "./support/devices";
import { api, expect, test } from "./support/fixtures";

/** A network with enrolled devices that can sign syncs. */
async function networkWithDevices(page: Page, hostnames: string[]) {
  const network = await api<{ id: string }>(page, "/v1/networks", { name: "home" });
  const devices: Record<string, { id: string; privateKey: any; ipv4: string; ipv6: string }> = {};
  for (const hostname of hostnames) {
    const { token } = await api<{ token: string }>(
      page,
      `/v1/networks/${network.id}/enrollment-tokens`,
      {},
    );
    const device = signingDevice();
    const res = await enroll({ token, hostname, platform: "linux", ...device.keys });
    expect(res.status).toBe(201);
    devices[hostname] = {
      id: res.body.device.id,
      privateKey: device.privateKey,
      ipv4: res.body.device.meshIpv4,
      ipv6: res.body.device.meshIpv6,
    };
  }
  return { network, devices };
}

const addRule = (page: Page, networkId: string, rule: Record<string, unknown>) =>
  api<{ id: string }>(page, `/v1/networks/${networkId}/acl/rules`, rule);

const setDefault = (page: Page, networkId: string, defaultAction: "allow" | "deny") =>
  api(page, `/v1/networks/${networkId}/acl`, { defaultAction }, { method: "PATCH" });

test.describe("access rules", () => {
  test("each device syncs the rules that let traffic in to it", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "ACL Org");
    const { network, devices } = await networkWithDevices(owner.page, ["laptop", "server"]);
    const { laptop, server } = devices;
    const aclOf = async (device: typeof laptop) => {
      const res = await sync(device!, { endpoints: [] });
      expect(res.status).toBe(200);
      return res.body.acl;
    };

    // New networks allow everything.
    expect(await aclOf(laptop)).toEqual({ defaultAction: "allow", inbound: [] });

    await addRule(owner.page, network.id, {
      sourceDeviceId: laptop!.id,
      destinationDeviceId: server!.id,
      protocol: "tcp",
      portFrom: 22,
    });
    await addRule(owner.page, network.id, {
      sourceDeviceId: null,
      destinationDeviceId: null,
      protocol: "icmp",
    });
    // Rules only bite once the default is deny.
    expect(await aclOf(server)).toEqual({ defaultAction: "allow", inbound: [] });

    await setDefault(owner.page, network.id, "deny");
    expect(await aclOf(server)).toEqual({
      defaultAction: "deny",
      inbound: [
        { sources: [laptop!.ipv4, laptop!.ipv6], protocol: "tcp", portFrom: 22, portTo: 22 },
        { sources: null, protocol: "icmp", portFrom: null, portTo: null },
      ],
    });
    // The laptop is only a source of the SSH rule, so only ping reaches it.
    expect(await aclOf(laptop)).toEqual({
      defaultAction: "deny",
      inbound: [{ sources: null, protocol: "icmp", portFrom: null, portTo: null }],
    });

    // The web sees the same rules with device names.
    const acl = await api<any>(owner.page, `/v1/networks/${network.id}/acl`);
    expect(acl.defaultAction).toBe("deny");
    expect(acl.rules).toMatchObject([
      { source: { name: "laptop" }, destination: { name: "server" }, protocol: "tcp" },
      { source: null, destination: null, protocol: "icmp" },
    ]);

    // Removing a device removes the rules that name it.
    await api(owner.page, `/v1/devices/${laptop!.id}`, undefined, { method: "DELETE" });
    expect((await aclOf(server)).inbound).toEqual([
      { sources: null, protocol: "icmp", portFrom: null, portTo: null },
    ]);
  });

  test("rules are validated and only admins change them", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "ACL Rules Org");
    const { network, devices } = await networkWithDevices(owner.page, ["laptop"]);
    const elsewhere = await api<{ id: string }>(owner.page, "/v1/networks", { name: "work" });
    const { token } = await api<{ token: string }>(
      owner.page,
      `/v1/networks/${elsewhere.id}/enrollment-tokens`,
      {},
    );
    const foreign = await enroll({
      token,
      hostname: "desk",
      platform: "linux",
      ...signingDevice().keys,
    });

    const fails = (rule: Record<string, unknown>, page = owner.page) =>
      addRule(page, network.id, { sourceDeviceId: null, destinationDeviceId: null, ...rule });
    await expect(fails({ protocol: "icmp", portFrom: 22 })).rejects.toMatchObject({ status: 400 });
    await expect(fails({ protocol: "tcp", portFrom: 90, portTo: 80 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(fails({ protocol: "tcp", portFrom: 70000 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      fails({ sourceDeviceId: devices.laptop!.id, destinationDeviceId: devices.laptop!.id }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(fails({ destinationDeviceId: foreign.body.device.id })).rejects.toMatchObject({
      status: 404,
      body: { error: { code: "device_not_found" } },
    });

    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    const acl = await api<any>(member.page, `/v1/networks/${network.id}/acl`);
    expect(acl).toEqual({ defaultAction: "allow", rules: [] });
    await expect(fails({ protocol: "any" }, member.page)).rejects.toMatchObject({ status: 403 });
    await expect(setDefault(member.page, network.id, "deny")).rejects.toMatchObject({
      status: 403,
    });
    const rule = await fails({ protocol: "any" });
    await expect(
      api(member.page, `/v1/acl-rules/${rule.id}`, undefined, { method: "DELETE" }),
    ).rejects.toMatchObject({ status: 403 });

    await member.page.goto(`/networks/${network.id}`);
    await expect(member.page.getByText("Any device → every device")).toBeVisible();
    await expect(member.page.getByRole("button", { name: "Add rule" })).toHaveCount(0);
    await expect(member.page.getByRole("button", { name: /^Remove rule/ })).toHaveCount(0);
  });

  test("admins manage access from the network page", async ({ createUser, createOrganization }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "ACL Web Org");
    const { network } = await networkWithDevices(owner.page, ["laptop", "server"]);
    const page = owner.page;
    await page.goto(`/networks/${network.id}`);

    await page.getByRole("button", { name: "Add rule" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("From", { exact: true }).click();
    await page.getByRole("option", { name: "laptop" }).click();
    await dialog.getByLabel("To", { exact: true }).click();
    await page.getByRole("option", { name: "server" }).click();
    await dialog.getByLabel("Ports").fill("80-70");
    await dialog.getByRole("button", { name: "Add rule" }).click();
    await expect(dialog.getByText(/A port like 22/)).toBeVisible();
    await dialog.getByLabel("Ports").fill("22");
    await dialog.getByRole("button", { name: "Add rule" }).click();
    await expect(dialog).toHaveCount(0);

    const row = page.locator("li", { hasText: "laptop → server" });
    await expect(row).toContainText("TCP 22");
    await expect(page.getByText("These rules take effect when")).toBeVisible();

    await page.getByRole("combobox", { name: "Access between devices" }).click();
    await page.getByRole("option", { name: "Only what the rules allow" }).click();
    await expect(page.getByText("These rules take effect when")).toHaveCount(0);
    await expect
      .poll(async () => (await api<any>(page, `/v1/networks/${network.id}/acl`)).defaultAction)
      .toBe("deny");

    await page.getByRole("button", { name: "Remove rule laptop → server" }).click();
    await page.getByRole("button", { name: "Remove rule", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText("No rules yet")).toBeVisible();
  });
});
