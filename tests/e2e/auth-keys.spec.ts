import { sql } from "./support/db";
import { deviceKeys, enroll } from "./support/devices";
import { api, expect, ownNetwork, test } from "./support/fixtures";

const PATH = "/v1/network/enrollment-tokens";

test.describe("auth keys", () => {
  test("a reusable, tagged, ephemeral key enrolls many devices", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Auth Key Org");
    const network = await ownNetwork<{ id: string }>(owner.page);

    const key = await api<{ token: string; reusable: boolean; ephemeral: boolean; tags: string[] }>(
      owner.page,
      PATH,
      { expiresIn: "30d", reusable: true, ephemeral: true, tags: ["server", "ci"] },
    );
    expect(key).toMatchObject({ reusable: true, ephemeral: true, tags: ["ci", "server"] });

    for (const hostname of ["worker-a", "worker-b"]) {
      const res = await enroll({
        token: key.token,
        hostname,
        platform: "linux",
        ...deviceKeys(),
      });
      expect(res.status).toBe(201);
      expect(res.body.device).toMatchObject({ tags: ["ci", "server"], ephemeral: true });
    }

    // Still listed as active, counting its uses.
    const active = await api<{ uses: number; reusable: boolean }[]>(owner.page, PATH);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ reusable: true, uses: 2 });

    // Revoking stops it.
    const [listed] = await api<{ id: string }[]>(owner.page, PATH);
    await api(owner.page, `/v1/enrollment-tokens/${listed!.id}`, undefined, { method: "DELETE" });
    const refused = await enroll({
      token: key.token,
      hostname: "worker-c",
      platform: "linux",
      ...deviceKeys(),
    });
    expect(refused.status).toBe(401);
    expect(
      await sql("select 1 from devices where network_id = $1 and ephemeral", [network.id]),
    ).toHaveLength(2);
  });

  test("a plain key still works once and keeps devices permanent", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Single Key Org");
    const { token } = await api<{ token: string }>(owner.page, PATH, {});

    const first = await enroll({ token, hostname: "one", platform: "linux", ...deviceKeys() });
    expect(first.status).toBe(201);
    expect(first.body.device).toMatchObject({ tags: [], ephemeral: false });
    const second = await enroll({ token, hostname: "two", platform: "linux", ...deviceKeys() });
    expect(second.status).toBe(401);
  });

  test("members can't create reusable, ephemeral or tagged keys", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Member Key Org");
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");

    for (const options of [{ reusable: true }, { ephemeral: true }, { tags: ["server"] }]) {
      await expect(api(member.page, PATH, options)).rejects.toMatchObject({ status: 403 });
    }
    await api(member.page, PATH, { expiresIn: "7d" });
    await expect(api(owner.page, PATH, { tags: ["Not A Tag"] })).rejects.toMatchObject({
      status: 400,
    });
  });

  test("offline ephemeral devices are removed; online and permanent ones stay", async ({
    createUser,
    createOrganization,
  }) => {
    test.setTimeout(120_000);
    const owner = await createUser("Owner");
    await createOrganization(owner, "Ephemeral Org");
    const network = await ownNetwork<{ id: string }>(owner.page);

    const enrollWith = async (hostname: string, options: Record<string, unknown>) => {
      const { token } = await api<{ token: string }>(owner.page, PATH, options);
      const res = await enroll({ token, hostname, platform: "linux", ...deviceKeys() });
      return res.body.device.id as string;
    };
    const stale = await enrollWith("stale", { ephemeral: true });
    const kept = await enrollWith("kept", {});
    // Both last seen long ago; only the ephemeral one is swept.
    await sql(
      "update devices set last_seen_at = now() - interval '2 hours' where network_id = $1",
      [network.id],
    );

    await expect
      .poll(
        async () =>
          (await sql<{ id: string }>("select id from devices where network_id = $1", [network.id]))
            .map((d) => d.id)
            .sort(),
        { timeout: 90_000, intervals: [2_000] },
      )
      .toEqual([kept]);
    expect(stale).not.toBe(kept);
  });
});
