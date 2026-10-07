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

const approve = (page: Page, deviceId: string, approved: string[]) =>
  api<{ routes: { prefix: string; approved: boolean }[] }>(
    page,
    `/v1/devices/${deviceId}/routes`,
    { approved },
    { method: "PUT" },
  );

test.describe("subnet routes", () => {
  test("advertised routes wait for approval, then reach the router and its peers", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Routes Org");
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const router = await enrollDevice(owner.page, network.id, "router");
    const laptop = await enrollDevice(owner.page, network.id, "laptop");
    const lan = ["192.168.50.0/24", "10.9.0.0/16"];
    const peerRoutes = async () =>
      (await sync(laptop, { endpoints: [], advertiseRoutes: [] })).body.peers[0].routes;

    // Advertised, not approved: nobody gets them.
    const first = await sync(router, { endpoints: [], advertiseRoutes: lan });
    expect(first.body.self.routes).toEqual([]);
    expect(await peerRoutes()).toEqual([]);
    const listed = await api<{ name: string; routes: unknown }[]>(
      owner.page,
      `/v1/networks/${network.id}/devices`,
    );
    expect(listed.find((d) => d.name === "router")!.routes).toEqual([
      { prefix: "10.9.0.0/16", approved: false },
      { prefix: "192.168.50.0/24", approved: false },
    ]);

    // Owners and admins approve, and only what the device advertises.
    await expect(approve(member.page, router.id, [lan[0]!])).rejects.toMatchObject({ status: 403 });
    await expect(approve(owner.page, router.id, ["172.16.0.0/12"])).rejects.toMatchObject({
      status: 400,
    });
    await approve(owner.page, router.id, [lan[0]!]);
    const second = await sync(router, { endpoints: [], advertiseRoutes: lan });
    expect(second.body.self.routes).toEqual(["192.168.50.0/24"]);
    expect(await peerRoutes()).toEqual(["192.168.50.0/24"]);
    expect(second.body.revision).not.toBe(first.body.revision);

    // The revision moves when routes are approved or revoked, so agents re-sync at once.
    await approve(owner.page, router.id, []);
    expect(await peerRoutes()).toEqual([]);
    await approve(owner.page, router.id, lan);

    // Invalid prefixes are ignored; one the device stops advertising goes away.
    await sync(router, { endpoints: [], advertiseRoutes: ["10.9.0.0/16", "10.77.0.0/24", "bad"] });
    expect(await peerRoutes()).toEqual(["10.9.0.0/16"]);
    // An agent that predates routes leaves them alone.
    await sync(router, { endpoints: [] });
    expect(await peerRoutes()).toEqual(["10.9.0.0/16"]);
    await sync(router, { endpoints: [], advertiseRoutes: [] });
    expect(await peerRoutes()).toEqual([]);
  });

  test("an exit node is two default routes that wait for approval like any other", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Exit Org");
    const network = await api<{ id: string }>(owner.page, "/v1/networks", { name: "home" });
    const gateway = await enrollDevice(owner.page, network.id, "gateway");
    const laptop = await enrollDevice(owner.page, network.id, "laptop");
    const peerRoutes = async () =>
      (await sync(laptop, { endpoints: [], advertiseRoutes: [] })).body.peers[0].routes;

    await sync(gateway, { endpoints: [], advertiseRoutes: [], advertiseExitNode: true });
    expect(await peerRoutes()).toEqual([]);
    const listed = await api<{ name: string; routes: unknown }[]>(
      owner.page,
      `/v1/networks/${network.id}/devices`,
    );
    expect(listed.find((d) => d.name === "gateway")!.routes).toEqual([
      { prefix: "0.0.0.0/0", approved: false },
      { prefix: "::/0", approved: false },
    ]);

    await approve(owner.page, gateway.id, ["0.0.0.0/0", "::/0"]);
    expect(await peerRoutes()).toEqual(["0.0.0.0/0", "::/0"]);
    const self = await sync(gateway, {
      endpoints: [],
      advertiseRoutes: [],
      advertiseExitNode: true,
    });
    expect(self.body.self.routes).toEqual(["0.0.0.0/0", "::/0"]);

    // Subnets and the exit node are independent; stopping the offer removes it.
    await sync(gateway, { endpoints: [], advertiseRoutes: ["192.168.9.0/24"] });
    expect(await peerRoutes()).toEqual([]);
  });
});
