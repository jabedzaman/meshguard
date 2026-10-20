import { sql } from "./support/db";
import { api, expect, test, ownNetwork } from "./support/fixtures";

const TOKEN = /meshguard_enr_[A-Za-z0-9_-]{43}/;

test.describe("enrollment tokens", () => {
  test("create from the network page, shown once, stored hashed, revoke", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Token Org");
    const network = await ownNetwork<{ id: string }>(owner.page);
    const { page } = owner;

    await page.goto("/devices");

    await page.getByRole("button", { name: "Add device" }).click();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "24 hours" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    const command = (await page.locator("[role=dialog] pre").textContent())!;
    expect(command).toMatch(new RegExp(`^meshguard up --token ${TOKEN.source}$`));
    const token = command.replace("meshguard up --token ", "");
    await page.getByRole("button", { name: "Done" }).click();

    // Listed by prefix only.
    const row = page.locator("li", { hasText: token.slice(0, 20) });
    await expect(row).toContainText("you");
    await expect(page.getByText(token)).toHaveCount(0);

    // Only the hash is stored.
    const rows = await sql<{ token_hash: string; token_prefix: string }>(
      "select token_hash, token_prefix from enrollment_tokens where network_id = $1",
      [network.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_prefix).toBe(token.slice(0, 20));

    await row.getByRole("button", { name: /Revoke/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("No active enrollment tokens.")).toBeVisible();
  });

  test("members create their own tokens; only admins revoke others'", async ({
    createUser,
    createOrganization,
    addToOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Perm Org");
    const network = await ownNetwork<{ id: string }>(owner.page);
    const member = await createUser("Member");
    await addToOrganization(owner, member, "member");

    const path = `/v1/network/enrollment-tokens`;
    const ownerToken = await api<{ id: string; tokenPrefix: string }>(owner.page, path, {});
    const memberToken = await api<{ id: string; tokenPrefix: string }>(member.page, path, {
      expiresIn: "7d",
    });

    // Member: can revoke their own, not the owner's.
    await member.page.goto("/devices");
    await expect(member.page.getByRole("button", { name: "Add device" })).toBeVisible();
    await expect(
      member.page
        .locator("li", { hasText: memberToken.tokenPrefix })
        .getByRole("button", { name: /Revoke/ }),
    ).toBeVisible();
    await expect(
      member.page
        .locator("li", { hasText: ownerToken.tokenPrefix })
        .getByRole("button", { name: /Revoke/ }),
    ).toHaveCount(0);
    await expect(
      api(member.page, `/v1/enrollment-tokens/${ownerToken.id}`, undefined, { method: "DELETE" }),
    ).rejects.toMatchObject({ status: 403 });

    // Owner can revoke the member's.
    await owner.page.goto("/devices");
    await owner.page
      .locator("li", { hasText: memberToken.tokenPrefix })
      .getByRole("button", { name: /Revoke/ })
      .click();
    await owner.page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
    await expect(owner.page.locator("li", { hasText: memberToken.tokenPrefix })).toHaveCount(0);
  });

  test("another organization can't see or create tokens for the network", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Home Org");
    const network = await ownNetwork<{ id: string }>(owner.page);
    const outsider = await createUser("Outsider");
    await createOrganization(outsider, "Other Org");

    const path = `/v1/network/enrollment-tokens`;
    await expect(api(outsider.page, path)).rejects.toMatchObject({ status: 404 });
    await expect(api(outsider.page, path, {})).rejects.toMatchObject({
      status: 404,
      body: { error: { code: "network_not_found" } },
    });
  });
});

test.describe("add device dialog", () => {
  test("a closed dialog forgets its token", async ({ createUser, createOrganization }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Dialog Org");
    const { page } = owner;
    await page.goto("/devices");

    const command = page.locator("[role=dialog] pre");
    for (const close of [
      () => page.keyboard.press("Escape"),
      () => page.getByRole("button", { name: "Done" }).click(),
    ]) {
      await page.getByRole("button", { name: "Add device" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
      await expect(command).toContainText("meshguard up --token");
      await close();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.getByRole("button", { name: "Add device" }).click();
      await expect(command).toHaveCount(0);
      await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm" })).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });
});
