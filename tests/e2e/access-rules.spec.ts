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
      source: `device:${laptop!.id}`,
      destination: `device:${server!.id}`,
      protocol: "tcp",
      portFrom: 22,
    });
    await addRule(owner.page, network.id, { source: "*", destination: "*", protocol: "icmp" });
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
      {
        source: { kind: "device", label: "laptop" },
        destination: { kind: "device", label: "server" },
        protocol: "tcp",
      },
      { source: { kind: "any" }, destination: { kind: "any" }, protocol: "icmp" },
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
      addRule(page, network.id, { source: "*", destination: "*", ...rule });
    await expect(fails({ protocol: "icmp", portFrom: 22 })).rejects.toMatchObject({ status: 400 });
    await expect(fails({ protocol: "tcp", portFrom: 90, portTo: 80 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(fails({ protocol: "tcp", portFrom: 70000 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      fails({
        source: `device:${devices.laptop!.id}`,
        destination: `device:${devices.laptop!.id}`,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(fails({ destination: `device:${foreign.body.device.id}` })).rejects.toMatchObject({
      status: 404,
      body: { error: { code: "device_not_found" } },
    });
    for (const selector of ["tag:Bad Tag", "role:root", "group:x", ""]) {
      await expect(fails({ source: selector })).rejects.toMatchObject({ status: 400 });
    }
    await expect(fails({ source: "user:not-a-member" })).rejects.toMatchObject({
      status: 404,
      body: { error: { code: "member_not_found" } },
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

  test("rules name tags, people and roles, and follow changes to them", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    const org = await createOrganization(owner, "ACL Tags Org");
    const { network, devices } = await networkWithDevices(owner.page, ["db", "web"]);
    const alice = await createUser("Alice");
    const bob = await createUser("Bob");
    await addToOrganization(owner, alice, "member");
    await addToOrganization(owner, bob, "admin");
    const enrollAs = async (page: Page, hostname: string) => {
      const { token } = await api<{ token: string }>(
        page,
        `/v1/networks/${network.id}/enrollment-tokens`,
        {},
      );
      const device = signingDevice();
      const res = await enroll({ token, hostname, platform: "darwin", ...device.keys });
      return {
        id: res.body.device.id as string,
        privateKey: device.privateKey,
        ipv4: res.body.device.meshIpv4 as string,
        ipv6: res.body.device.meshIpv6 as string,
      };
    };
    const laptop = await enrollAs(alice.page, "alice-laptop");
    const desktop = await enrollAs(bob.page, "bob-desktop");
    const { db, web } = devices;
    const tag = (id: string, tags: string[], page = owner.page) =>
      api(page, `/v1/devices/${id}/tags`, { tags }, { method: "PUT" });
    const inbound = async (device: { id: string; privateKey: any }) =>
      (await sync(device, { endpoints: [] })).body.acl.inbound;
    const members = await api<{
      members: { id: string; userId: string; user: { email: string } }[];
    }>(owner.page, `/api/auth/organization/list-members?organizationId=${org.id}`);
    const userId = (email: string) => members.members.find((m) => m.user.email === email)!.userId;

    // Tags: owners and admins only, validated, case folded.
    await expect(tag(db!.id, ["server"], alice.page)).rejects.toMatchObject({ status: 403 });
    await expect(tag(db!.id, ["-bad"])).rejects.toMatchObject({ status: 400 });
    await expect(tag(db!.id, ["Server", "db"])).resolves.toMatchObject({ tags: ["db", "server"] });
    await tag(web!.id, ["server"], bob.page);

    await setDefault(owner.page, network.id, "deny");
    await addRule(owner.page, network.id, { source: "role:admin", destination: "tag:server" });
    await addRule(owner.page, network.id, {
      source: `user:${userId(alice.email)}`,
      destination: "tag:db",
      protocol: "tcp",
      portFrom: 5432,
    });

    const all = { protocol: "any", portFrom: null, portTo: null };
    const postgres = { protocol: "tcp", portFrom: 5432, portTo: 5432 };
    expect(await inbound(db!)).toEqual([
      { sources: [desktop.ipv4, desktop.ipv6], ...all },
      { sources: [laptop.ipv4, laptop.ipv6], ...postgres },
    ]);
    expect(await inbound(web!)).toEqual([{ sources: [desktop.ipv4, desktop.ipv6], ...all }]);
    expect(await inbound(laptop)).toEqual([]);

    // Check and the policy file agree.
    const check = (from: string, to: string, protocol: string, port?: number) =>
      api<{ allowed: boolean; ruleIndex: number | null }>(
        owner.page,
        `/v1/networks/${network.id}/acl/check`,
        { sourceDeviceId: from, destinationDeviceId: to, protocol, port },
      );
    expect(await check(laptop.id, db!.id, "tcp", 5432)).toEqual({ allowed: true, ruleIndex: 1 });
    expect(await check(laptop.id, db!.id, "tcp", 22)).toEqual({ allowed: false, ruleIndex: null });
    expect(await check(desktop.id, web!.id, "icmp")).toEqual({ allowed: true, ruleIndex: 0 });
    expect(await api(owner.page, `/v1/networks/${network.id}/acl/document`)).toEqual({
      defaultAction: "deny",
      rules: [
        { source: "role:admin", destination: "tag:server", protocol: "any", ports: "*" },
        { source: `user:${alice.email}`, destination: "tag:db", protocol: "tcp", ports: "5432" },
      ],
    });

    // Promoting Alice makes her laptop an admin device; untagging web drops its rules.
    await api(owner.page, "/api/auth/organization/update-member-role", {
      memberId: members.members.find((m) => m.user.email === alice.email)!.id,
      role: "admin",
      organizationId: org.id,
    });
    expect((await inbound(db!))[0].sources).toEqual([
      laptop.ipv4,
      laptop.ipv6,
      desktop.ipv4,
      desktop.ipv6,
    ]);
    await tag(web!.id, []);
    expect(await inbound(web!)).toEqual([]);

    // The page shows tags and rule labels.
    await owner.page.goto(`/networks/${network.id}`);
    // The db device row carries both tags (rule rows mention one each).
    await expect(
      owner.page.locator("li").filter({ hasText: "tag:db" }).filter({ hasText: "tag:server" }),
    ).toHaveCount(1);
    await expect(owner.page.getByText("role:admin → tag:server")).toBeVisible();
    await expect(owner.page.getByText("Alice → tag:db")).toBeVisible();

    // Tag from the page, then check access and view the policy file.
    const page = owner.page;
    await page.getByRole("button", { name: "Tags of web" }).click();
    await page.getByLabel("Tags", { exact: true }).fill("tag:server, edge");
    await page.getByRole("button", { name: "Save tags" }).click();
    await expect(
      page.locator("li").filter({ hasText: "tag:edge" }).filter({ hasText: "tag:server" }),
    ).toHaveCount(1);
    await page.getByRole("combobox", { name: "Check from" }).click();
    await page.getByRole("option", { name: "bob-desktop" }).click();
    await page.getByRole("combobox", { name: "Check to" }).click();
    await page.getByRole("option", { name: "web" }).click();
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("bob-desktop may connect to web (rule 1).");
    await page.getByLabel("Check port").fill("5432");
    await page.getByRole("combobox", { name: "Check from" }).click();
    await page.getByRole("option", { name: "alice-laptop" }).click();
    await page.getByRole("combobox", { name: "Check to" }).click();
    await page.getByRole("option", { name: "db", exact: true }).click();
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("alice-laptop may connect to db");
    await page.getByRole("button", { name: "View as policy file" }).click();
    await expect(page.getByLabel("Policy file")).toContainText('"source": "role:admin"');
  });
});
