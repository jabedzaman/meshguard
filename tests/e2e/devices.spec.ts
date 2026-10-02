import { sql } from "./support/db";
import { deviceKeys, enroll, signingDevice, sync } from "./support/devices";
import { E2E } from "./support/env";
import { api, expect, test } from "./support/fixtures";
import { redis } from "./support/redis";

test.describe("devices", () => {
  test("an enrolled device shows up on the network page", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Device Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const { token } = await api<{ token: string }>(
      owner.page,
      `/v1/networks/${network.id}/enrollment-tokens`,
      {},
    );

    await owner.page.goto(`/networks/${network.id}`);
    await expect(owner.page.getByText("No devices yet.")).toBeVisible();

    const res = await enroll({ token, hostname: "laptop", platform: "darwin", ...deviceKeys() });
    expect(res.status).toBe(201);
    expect(res.body.device.meshIpv4).toMatch(/^10\.77\.\d+\.\d+$/);
    expect(res.body.network).toMatchObject({ id: network.id, name: "home" });

    // The API pushes the enrollment, so the device appears without a reload
    // (well inside the 5s the list used to poll at).
    const row = owner.page.locator("li", { hasText: "laptop" });
    await expect(row).toContainText("macOS", { timeout: 3_000 });
    await expect(row).toContainText(res.body.device.meshIpv4);
    await expect(owner.page.getByText("No active enrollment tokens.")).toBeVisible({
      timeout: 3_000,
    });
  });

  test("device names are DNS labels, unique in the network", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Names Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const enrollAs = async (hostname: string) => {
      const { token } = await api<{ token: string }>(
        owner.page,
        `/v1/networks/${network.id}/enrollment-tokens`,
        {},
      );
      const res = await enroll({ token, hostname, platform: "darwin", ...deviceKeys() });
      expect(res.status).toBe(201);
      return res.body.device.name as string;
    };

    expect(await enrollAs("Jabeds-MacBook-Air.local")).toBe("jabeds-macbook-air");
    expect(await enrollAs("jabeds-macbook-air")).toBe("jabeds-macbook-air-2");
    expect(await enrollAs("Jabeds-MacBook-Air")).toBe("jabeds-macbook-air-3");
  });

  test("admins rename devices; peers get the new name on sync", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Rename Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const token = () =>
      api<{ token: string }>(owner.page, `/v1/networks/${network.id}/enrollment-tokens`, {}).then(
        (t) => t.token,
      );
    const laptop = signingDevice();
    const a = await enroll({
      token: await token(),
      hostname: "laptop",
      platform: "darwin",
      ...laptop.keys,
    });
    const server = signingDevice();
    const b = await enroll({
      token: await token(),
      hostname: "server",
      platform: "linux",
      ...server.keys,
    });
    const rename = (name: string, page = owner.page) =>
      api<{ name: string }>(page, `/v1/devices/${a.body.device.id}`, { name }, { method: "PATCH" });

    // From the web: the dialog saves and the list shows the new name.
    await owner.page.goto(`/networks/${network.id}`);
    await owner.page.getByRole("button", { name: "Rename laptop" }).click();
    const input = owner.page.getByLabel("Device name");
    await input.fill("Work-Laptop");
    await expect(owner.page.getByText("work-laptop.internal")).toBeVisible();
    await owner.page.getByRole("button", { name: "Save" }).click();
    await expect(owner.page.getByRole("dialog")).toHaveCount(0);
    await expect(owner.page.locator("li", { hasText: "work-laptop" })).toContainText("macOS");

    // A name another device has is refused on the field.
    await owner.page.getByRole("button", { name: "Rename work-laptop" }).click();
    await input.fill("server");
    await owner.page.getByRole("button", { name: "Save" }).click();
    await expect(
      owner.page.getByText("Another device in this network is named server"),
    ).toBeVisible();
    await owner.page.keyboard.press("Escape");

    // Peers and the device itself see it on their next sync.
    const map = await sync(
      { id: b.body.device.id, privateKey: server.privateKey },
      { endpoints: [] },
    );
    expect(map.body.peers).toEqual([expect.objectContaining({ name: "work-laptop" })]);
    const self = await sync(
      { id: a.body.device.id, privateKey: laptop.privateKey },
      { endpoints: [] },
    );
    expect(self.body.self.name).toBe("work-laptop");

    // Only DNS labels; case is folded.
    expect((await rename("  Laptop-2 ")).name).toBe("laptop-2");
    for (const name of ["-x", "x-", "a.b", "my_box", "", "a".repeat(64)]) {
      await expect(rename(name)).rejects.toMatchObject({
        status: 400,
      });
    }
    await expect(rename("server")).rejects.toMatchObject({
      status: 409,
      body: { error: { code: "device_name_taken" } },
    });

    // Members can't rename, and see no button.
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    await expect(rename("mine", member.page)).rejects.toMatchObject({
      status: 403,
    });
    await member.page.goto(`/networks/${network.id}`);
    const row = member.page.locator("li", { hasText: "laptop-2" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: /^Rename/ })).toHaveCount(0);

    // Another organization's device is not found.
    const outsider = await createUser("Outsider");
    await createOrganization(outsider, "Other Org");
    await expect(rename("taken", outsider.page)).rejects.toMatchObject({
      status: 404,
    });
  });

  test("admins remove devices; peers drop them and the device is refused", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Remove Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const token = () =>
      api<{ token: string }>(owner.page, `/v1/networks/${network.id}/enrollment-tokens`, {}).then(
        (t) => t.token,
      );
    const old = signingDevice();
    const a = await enroll({
      token: await token(),
      hostname: "old-mac",
      platform: "darwin",
      ...old.keys,
    });
    const server = signingDevice();
    const b = await enroll({
      token: await token(),
      hostname: "server",
      platform: "linux",
      ...server.keys,
    });
    const oldDevice = { id: a.body.device.id, privateKey: old.privateKey };
    const serverDevice = { id: b.body.device.id, privateKey: server.privateKey };
    const remove = (page = owner.page, id = oldDevice.id) =>
      api(page, `/v1/devices/${id}`, undefined, { method: "DELETE" });

    // Members can't remove, and see no button.
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    await expect(remove(member.page)).rejects.toMatchObject({ status: 403 });
    await member.page.goto(`/networks/${network.id}`);
    const memberRow = member.page.locator("li", { hasText: "old-mac" });
    await expect(memberRow).toBeVisible();
    await expect(memberRow.getByRole("button", { name: /^Remove/ })).toHaveCount(0);

    // Another organization's device is not found.
    const outsider = await createUser("Outsider");
    await createOrganization(outsider, "Other Org");
    await expect(remove(outsider.page)).rejects.toMatchObject({ status: 404 });

    // From the web: confirm, and the row goes away.
    await owner.page.goto(`/networks/${network.id}`);
    await owner.page.getByRole("button", { name: "Remove old-mac" }).click();
    await owner.page.getByRole("button", { name: "Remove device" }).click();
    await expect(owner.page.locator("li", { hasText: "old-mac" })).toHaveCount(0);
    await expect(owner.page.locator("li", { hasText: "server" })).toBeVisible();
    // The member's open page hears about it too.
    await expect(memberRow).toHaveCount(0, { timeout: 3_000 });

    // Peers drop it; the removed device can't sync any more.
    expect((await sync(serverDevice, { endpoints: [] })).body.peers).toEqual([]);
    expect(await sync(oldDevice, { endpoints: [] })).toMatchObject({
      status: 401,
      body: { error: { code: "invalid_device_signature" } },
    });
    await expect(remove()).rejects.toMatchObject({ status: 404 });
  });

  test("tokens are single-use, revocable and keys can't enroll twice", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Rules Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const newToken = () =>
      api<{ id: string; token: string }>(
        owner.page,
        `/v1/networks/${network.id}/enrollment-tokens`,
        {},
      );

    const first = await newToken();
    const keys = deviceKeys();
    expect(
      (await enroll({ token: first.token, hostname: "a", platform: "linux", ...keys })).status,
    ).toBe(201);

    // Reuse.
    const reused = await enroll({
      token: first.token,
      hostname: "b",
      platform: "linux",
      ...deviceKeys(),
    });
    expect(reused).toMatchObject({
      status: 401,
      body: { error: { code: "invalid_enrollment_token" } },
    });

    // Revoked.
    const revoked = await newToken();
    await api(owner.page, `/v1/enrollment-tokens/${revoked.id}`, undefined, { method: "DELETE" });
    expect(
      (await enroll({ token: revoked.token, hostname: "c", platform: "linux", ...deviceKeys() }))
        .status,
    ).toBe(401);

    // Same keys again with a fresh token.
    const again = await newToken();
    const dup = await enroll({ token: again.token, hostname: "a", platform: "linux", ...keys });
    expect(dup).toMatchObject({
      status: 409,
      body: { error: { code: "device_already_enrolled" } },
    });

    // Validation.
    const invalid = await enroll({
      token: again.token,
      hostname: "bad host!",
      platform: "beos",
      identityPublicKey: "x",
      wireguardPublicKey: "y",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(
      ["hostname", "identityPublicKey", "platform", "wireguardPublicKey"].sort(),
    );
  });

  test("concurrent enrollments get unique addresses", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Busy Org");
    // 10 devices enrolling at once into one range must still get distinct addresses.
    const network = await api<{ id: string }>(owner.page, "/v1/networks", {
      name: "tiny",
      ipv4Cidr: "10.99.0.0/24",
    });
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () =>
        api<{ token: string }>(owner.page, `/v1/networks/${network.id}/enrollment-tokens`, {}),
      ),
    );

    const results = await Promise.all(
      tokens.map(({ token }, i) =>
        enroll({ token, hostname: `node-${i}`, platform: "linux", ...deviceKeys() }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    const ips = results.map((r) => r.body.device.meshIpv4);
    expect(new Set(ips).size).toBe(10);
    for (const ip of ips) expect(ip).toMatch(/^10\.99\.0\.\d+$/);

    const devices = await api<unknown[]>(owner.page, `/v1/networks/${network.id}/devices`);
    expect(devices).toHaveLength(10);
  });

  test("signed sync returns the network map and marks the device online", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Sync Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const token = () =>
      api<{ token: string }>(owner.page, `/v1/networks/${network.id}/enrollment-tokens`, {}).then(
        (t) => t.token,
      );

    const laptop = signingDevice();
    const server = signingDevice();
    const a = await enroll({
      token: await token(),
      hostname: "laptop",
      platform: "darwin",
      ...laptop.keys,
    });
    const b = await enroll({
      token: await token(),
      hostname: "server",
      platform: "linux",
      ...server.keys,
    });
    const laptopDevice = { id: a.body.device.id, privateKey: laptop.privateKey };
    const serverDevice = { id: b.body.device.id, privateKey: server.privateKey };

    // Server reports its endpoints; laptop sees it as a peer with them.
    expect(
      (await sync(serverDevice, { endpoints: ["192.168.1.9:51820", "[2001:db8::9]:51820"] }))
        .status,
    ).toBe(200);
    const map = await sync(laptopDevice, { endpoints: ["192.168.1.5:51820"] });
    expect(map.status).toBe(200);
    expect(map.body.self).toMatchObject({ id: laptopDevice.id, name: "laptop" });
    expect(map.body.network).toMatchObject({ id: network.id, ipv4Cidr: "10.77.0.0/16" });
    expect(map.body.peers).toEqual([
      expect.objectContaining({
        id: serverDevice.id,
        name: "server",
        wireguardPublicKey: server.keys.wireguardPublicKey,
        meshIpv4: b.body.device.meshIpv4,
        endpoints: ["192.168.1.9:51820", "[2001:db8::9]:51820"],
      }),
    ]);
    // The relay agents fall back to when a peer isn't directly reachable.
    expect(map.body.relay).toEqual({ url: expect.stringMatching(/^wss?:\/\/.+\/relay$/) });
    // STUN servers for discovering the device's public address.
    expect(map.body.stun).toEqual(expect.arrayContaining([expect.stringMatching(/^[^:]+:\d+$/)]));
    // Private identity keys never come back.
    expect(JSON.stringify(map.body)).not.toContain(server.keys.identityPublicKey);

    // Both synced, so both show as online.
    await owner.page.goto(`/networks/${network.id}`);
    await expect(owner.page.locator("li", { hasText: "laptop" })).toContainText("online");
    await expect(owner.page.locator("li", { hasText: "server" })).toContainText("online");
  });

  test("sync rejects unsigned, tampered, stale and malformed requests", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Reject Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const { token } = await api<{ token: string }>(
      owner.page,
      `/v1/networks/${network.id}/enrollment-tokens`,
      {},
    );
    const keys = signingDevice();
    const enrolled = await enroll({ token, hostname: "box", platform: "linux", ...keys.keys });
    const device = { id: enrolled.body.device.id, privateKey: keys.privateKey };

    const unsigned = await fetch(`${E2E.apiUrl}/v1/devices/self/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoints: [] }),
    });
    expect(unsigned.status).toBe(401);

    for (const res of [
      await sync(device, { endpoints: [] }, { tamper: true }),
      await sync(device, { endpoints: [] }, { timestamp: Date.now() - 5 * 60 * 1000 }),
      await sync({ ...device, privateKey: signingDevice().privateKey }, { endpoints: [] }),
      await sync({ ...device, id: "00000000-0000-4000-8000-000000000000" }, { endpoints: [] }),
    ]) {
      expect(res).toMatchObject({
        status: 401,
        body: { error: { code: "invalid_device_signature" } },
      });
    }

    const malformed = await sync(device, { endpoints: ["not-an-endpoint"] });
    expect(malformed.status).toBe(400);
  });

  test("presence changes reach the page without a reload", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Presence Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const { token } = await api<{ token: string }>(
      owner.page,
      `/v1/networks/${network.id}/enrollment-tokens`,
      {},
    );
    const keys = signingDevice();
    const enrolled = await enroll({ token, hostname: "laptop", platform: "linux", ...keys.keys });
    const device = { id: enrolled.body.device.id, privateKey: keys.privateKey };
    const lastSeenInPostgres = async () =>
      (await sql("select last_seen_at from devices where id = $1", [device.id]))[0]!.last_seen_at;

    // The first sync persists lastSeenAt; the next ones only refresh Redis.
    await sync(device, { endpoints: [] });
    const persisted = await lastSeenInPostgres();
    expect(persisted).not.toBeNull();
    await sync(device, { endpoints: [] });
    expect(await lastSeenInPostgres()).toEqual(persisted);

    await owner.page.goto(`/networks/${network.id}`);
    const row = owner.page.locator("li", { hasText: "laptop" });
    await expect(row).toContainText("online");

    // The agent stops: its presence key expires (as it would 30s after the last
    // sync) and the page hears about it without polling.
    await redis((client) =>
      client.pexpire(`presence:device:${network.id}:${enrolled.body.device.id}`, 1),
    );
    await expect(row).toContainText("last seen", { timeout: 3_000 });

    // The agent comes back: its next sync is pushed as a connect.
    await sync(device, { endpoints: [] });
    await expect(row).toContainText("online", { timeout: 3_000 });
  });
});
