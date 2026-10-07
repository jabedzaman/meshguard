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

test.describe("funnel", () => {
  test("only owners and admins turn public access on, and it changes the device's relay token", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Funnel Org");
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const laptop = await enrollDevice(owner.page, network.id, "laptop");
    const setFunnel = (page: Page, enabled: boolean) =>
      api<{ funnel: boolean; name: string }>(
        page,
        `/v1/devices/${laptop.id}/funnel`,
        { enabled },
        {
          method: "PUT",
        },
      );
    const mapOf = async () => (await sync(laptop, { endpoints: [] })).body;

    // Off by default.
    const before = await mapOf();
    expect(before.self.funnel).toBe(false);

    await expect(setFunnel(member.page, true)).rejects.toMatchObject({ status: 403 });
    await expect(
      api(owner.page, `/v1/devices/${laptop.id}/funnel`, { enabled: "yes" }, { method: "PUT" }),
    ).rejects.toMatchObject({ status: 400 });

    // A control plane without a token-signing relay can't carry public traffic; the
    // lab (`pnpm lab`) runs one, so both outcomes are right depending on the stack.
    let enabled = true;
    try {
      const result = await setFunnel(owner.page, true);
      expect(result.funnel).toBe(true);
      expect(result.name).toMatch(/^laptop\..+/);
    } catch (error) {
      expect(error).toMatchObject({ status: 409, body: { error: { code: "funnel_unavailable" } } });
      enabled = false;
    }

    const after = await mapOf();
    expect(after.self.funnel).toBe(enabled);
    expect(after.revision !== before.revision).toBe(enabled);
    if (!enabled) return;

    // The device row shows it, and turning it off takes it away again.
    const listed = await api<{ name: string; funnel: boolean }[]>(
      owner.page,
      `/v1/networks/${network.id}/devices`,
    );
    expect(listed.find((d) => d.name === "laptop")!.funnel).toBe(true);
    if (before.relay?.token) expect(after.relay.token).not.toBe(before.relay.token);
    await setFunnel(owner.page, false);
    expect((await mapOf()).self.funnel).toBe(false);
  });
});
