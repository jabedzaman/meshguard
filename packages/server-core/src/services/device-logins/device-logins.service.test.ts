import { Redis } from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DeviceLoginsService } from "~/services/device-logins/device-logins.service";
import type { EnrollmentTokensService } from "~/services/enrollment-tokens/enrollment-tokens.service";

// Runs against a real Redis (the dev one by default); logins here expire on their own.
const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15", {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
const reachable = await redis.connect().then(
  () => true,
  () => false,
);

const create = vi.fn(async () => ({ token: "meshguard_enr_test" }));
const logins = new DeviceLoginsService(
  redis,
  { create } as unknown as EnrollmentTokensService,
  "https://web.example.com",
);
const actor = { userId: "user-1", organizationId: "org-1" };
const idOf = (login: { verificationUrl: string }) =>
  new URL(login.verificationUrl).searchParams.get("login")!;
const device = { hostname: "laptop", platform: "darwin", ip: "203.0.113.9" };

describe.runIf(reachable)("device logins", () => {
  afterAll(() => redis.disconnect());

  it("hands the enrollment token to the CLI once, after approval", async () => {
    const login = await logins.start(device);
    expect(login.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const id = new URL(login.verificationUrl).searchParams.get("login")!;
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(login.verificationUrl).not.toContain(login.userCode);

    expect(await logins.poll(login.secret)).toEqual({ status: "pending" });
    expect(await logins.describe(id)).toMatchObject({
      hostname: "laptop",
      ip: "203.0.113.9",
      userCode: login.userCode,
    });

    await logins.approve(actor, id, "network-1");
    expect(create).toHaveBeenCalledWith(actor, "network-1", "1h");
    expect(await logins.poll(login.secret)).toEqual({
      status: "approved",
      token: "meshguard_enr_test",
    });

    // Collected: the login is gone.
    await expect(logins.poll(login.secret)).rejects.toMatchObject({ status: 404 });
    await expect(logins.describe(id)).rejects.toMatchObject({ status: 404 });
  });

  it("ignores a second approval", async () => {
    create.mockClear();
    const id = idOf(await logins.start(device));
    await logins.approve(actor, id, "network-1");
    await logins.approve(actor, id, "network-1");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("doesn't look a login up by its short code", async () => {
    const login = await logins.start(device);
    await expect(logins.describe(login.userCode)).rejects.toMatchObject({ status: 404 });
  });

  it("stops a denied login", async () => {
    const login = await logins.start(device);
    await logins.deny(idOf(login));
    await expect(logins.poll(login.secret)).rejects.toMatchObject({ status: 404 });
  });
});
