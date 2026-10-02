import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { sql } from "./support/db";
import { E2E } from "./support/env";
import { api, expect, test } from "./support/fixtures";

/** Raw 32-byte public keys, base64, as the agent sends them. */
function deviceKeys() {
  const raw = (type: "ed25519" | "x25519") =>
    generateKeyPairSync(type as "ed25519")
      .publicKey.export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("base64");
  return { identityPublicKey: raw("ed25519"), wireguardPublicKey: raw("x25519") };
}

/** A device with its private identity key, for signing sync requests like the agent. */
function signingDevice() {
  const identity = generateKeyPairSync("ed25519");
  const raw = (key: KeyObject) =>
    key.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  return {
    privateKey: identity.privateKey,
    keys: {
      identityPublicKey: raw(identity.publicKey),
      wireguardPublicKey: raw(generateKeyPairSync("x25519").publicKey),
    },
  };
}

/** Signed POST /v1/devices/self/sync, as internal/coordination/sign.go does it. */
async function sync(
  device: { id: string; privateKey: KeyObject },
  body: unknown,
  { tamper = false, timestamp = Date.now() } = {},
) {
  const path = "/v1/devices/self/sync";
  const json = JSON.stringify(body);
  const bodyHash = createHash("sha256").update(json).digest("hex");
  const message = `POST\n${path}\n${timestamp}\n${bodyHash}`;
  const signature = sign(null, Buffer.from(message), device.privateKey).toString("base64");
  const res = await fetch(`${E2E.apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mesh-Device": device.id,
      "X-Mesh-Timestamp": String(timestamp),
      "X-Mesh-Signature": signature,
    },
    body: tamper ? JSON.stringify({ endpoints: ["6.6.6.6:51820"] }) : json,
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** What `mesh up` sends. No session: the token is the credential. */
async function enroll(body: Record<string, unknown>) {
  const res = await fetch(`${E2E.apiUrl}/v1/devices/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

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

    // The list polls, so the device appears without a reload.
    const row = owner.page.locator("li", { hasText: "laptop" });
    await expect(row).toContainText("macOS");
    await expect(row).toContainText(res.body.device.meshIpv4);
    await expect(owner.page.getByText("No active enrollment tokens.")).toBeVisible();
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

  test("a device that stops syncing goes offline without a reload", async ({
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
    await sync({ id: enrolled.body.device.id, privateKey: keys.privateKey }, { endpoints: [] });

    await owner.page.goto(`/networks/${network.id}`);
    const row = owner.page.locator("li", { hasText: "laptop" });
    await expect(row).toContainText("online");

    // The agent stops: its last sync is now older than the online window.
    await sql("update devices set last_seen_at = now() - interval '1 minute' where id = $1", [
      enrolled.body.device.id,
    ]);
    await expect(row).toContainText("last seen", { timeout: 15_000 });
  });
});
