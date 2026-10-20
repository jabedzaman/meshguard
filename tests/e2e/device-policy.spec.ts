import { sql } from "./support/db";
import { enroll, signingDevice, sync } from "./support/devices";
import { api, expect, test } from "./support/fixtures";

const TOKENS = "/v1/network/enrollment-tokens";

/** Enrolls a device like an agent does and returns what it needs to sign syncs. */
async function join(
  page: Parameters<typeof api>[0],
  hostname: string,
  options: Record<string, unknown> = {},
) {
  const { token } = await api<{ token: string }>(page, TOKENS, options);
  const device = signingDevice();
  const res = await enroll({ token, hostname, platform: "linux", ...device.keys });
  expect(res.status).toBe(201);
  return {
    id: res.body.device.id as string,
    privateKey: device.privateKey,
    enrolled: res.body,
  };
}

const peerNames = async (device: { id: string; privateKey: any }) =>
  ((await sync(device, { endpoints: [] })).body.peers as { name: string }[]).map((p) => p.name);

test.describe("device approval and key expiry", () => {
  test("new devices wait for approval when the network asks for it", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Approval Org");
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");

    const settings = await api<{ deviceApproval: boolean }>(
      owner.page,
      "/v1/network",
      { deviceApproval: true },
      { method: "PATCH" },
    );
    expect(settings.deviceApproval).toBe(true);

    const trusted = await join(owner.page, "trusted", { preApproved: true });
    expect(trusted.enrolled.pendingApproval).toBe(false);
    const waiting = await join(member.page, "waiting");
    expect(waiting.enrolled.pendingApproval).toBe(true);

    // Refused, with a reason only the device itself sees; peers don't list it.
    const refused = await sync(waiting, { endpoints: [] });
    expect(refused).toMatchObject({
      status: 403,
      body: { error: { code: "device_pending_approval" } },
    });
    expect(await peerNames(trusted)).toEqual([]);

    // Members can't approve; owners can.
    await expect(api(member.page, `/v1/devices/${waiting.id}/approve`, {})).rejects.toMatchObject({
      status: 403,
    });
    await api(owner.page, `/v1/devices/${waiting.id}/approve`, {});
    expect((await sync(waiting, { endpoints: [] })).status).toBe(200);
    expect(await peerNames(trusted)).toEqual(["waiting"]);
  });

  test("pre-approved keys are for admins, and approval can be turned off again", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Plain Org");
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");

    await expect(api(member.page, TOKENS, { preApproved: true })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      api(member.page, "/v1/network", { deviceApproval: true }, { method: "PATCH" }),
    ).rejects.toMatchObject({ status: 403 });

    // Approval is off by default: devices join straight away.
    const device = await join(member.page, "open");
    expect(device.enrolled.pendingApproval).toBe(false);
    expect((await sync(device, { endpoints: [] })).status).toBe(200);
  });

  test("keys expire, expired devices leave the mesh, and renewing brings them back", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Expiry Org");
    await api(owner.page, "/v1/network", { keyExpiryDays: 30 }, { method: "PATCH" });

    const stable = await join(owner.page, "stable");
    const aging = await join(owner.page, "aging");
    const rows = await sql<{ days: number }>(
      "select round(extract(epoch from key_expires_at - now()) / 86400)::int as days from devices where id = $1",
      [aging.id],
    );
    expect(rows[0]!.days).toBe(30);
    expect(await peerNames(stable)).toEqual(["aging"]);

    await sql("update devices set key_expires_at = now() - interval '1 minute' where id = $1", [
      aging.id,
    ]);
    expect(await sync(aging, { endpoints: [] })).toMatchObject({
      status: 403,
      body: { error: { code: "device_key_expired" } },
    });
    expect(await peerNames(stable)).toEqual([]);

    // The list says so, and renewing starts a new period.
    const listed = await api<{ id: string; keyExpired: boolean }[]>(
      owner.page,
      "/v1/network/devices",
    );
    expect(listed.find((d) => d.id === aging.id)?.keyExpired).toBe(true);
    await api(owner.page, `/v1/devices/${aging.id}/key`, { action: "renew" }, { method: "PUT" });
    expect((await sync(aging, { endpoints: [] })).status).toBe(200);
    expect(await peerNames(stable)).toEqual(["aging"]);

    // "never" clears the end date, and a network without expiry issues none.
    await api(owner.page, `/v1/devices/${aging.id}/key`, { action: "never" }, { method: "PUT" });
    expect(
      await sql("select 1 from devices where id = $1 and key_expires_at is null", [aging.id]),
    ).toHaveLength(1);
    await api(owner.page, "/v1/network", { keyExpiryDays: null }, { method: "PATCH" });
    const forever = await join(owner.page, "forever");
    expect(
      await sql("select 1 from devices where id = $1 and key_expires_at is null", [forever.id]),
    ).toHaveLength(1);
  });

  test("owners set the policy and approve or renew from the devices page", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Policy UI Org");
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    const { page } = owner;
    await page.goto("/devices");

    await page.getByRole("switch", { name: "Approve new devices" }).click();
    await expect(page.getByText("Device policy saved")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Approve new devices" })).toBeChecked();

    // A member's device waits; the owner approves it.
    const waiting = await join(member.page, "waiting");
    const row = page.locator("li", { hasText: "waiting" });
    await expect(row).toContainText("pending approval");
    await row.getByRole("button", { name: "Approve waiting" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
    await expect(row).not.toContainText("pending approval");
    expect((await sync(waiting, { endpoints: [] })).status).toBe(200);

    // An expired key shows up and can be renewed.
    await sql("update devices set key_expires_at = now() - interval '1 minute' where id = $1", [
      waiting.id,
    ]);
    await page.reload();
    await expect(row).toContainText("key expired");
    await row.getByRole("button", { name: "Renew key of waiting" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
    await expect(row).not.toContainText("key expired");

    // Members don't get the policy card.
    await member.page.goto("/devices");
    await expect(member.page.getByText("Device policy")).toHaveCount(0);
  });
});
