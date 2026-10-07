import { deviceKeys, enroll, randomClientIp } from "./support/devices";
import { expect, test } from "./support/fixtures";

test.describe("rate limits", () => {
  test("public routes answer 429 with Retry-After once a client address is over the limit, and only that address", async () => {
    const noisy = randomClientIp();
    const token = "meshguard_enr_not-a-real-token";
    const attempt = (ip: string) =>
      enroll({ token, hostname: "laptop", platform: "linux", ...deviceKeys() }, ip);

    // Enrollment allows 20 attempts a minute per address: a bad token is a 401 until then.
    let blockedAt = 0;
    for (let i = 1; i <= 25 && !blockedAt; i++) {
      const res = await attempt(noisy);
      if (res.status === 429) {
        blockedAt = i;
        expect(res.body.error.code).toBe("rate_limited");
        expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
      } else {
        expect(res.status).toBe(401);
      }
    }
    expect(blockedAt).toBe(21);

    // Another address is unaffected.
    expect((await attempt(randomClientIp())).status).toBe(401);
  });
});
