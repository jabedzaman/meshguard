import { generateKeyPairSync } from "node:crypto";
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
});
