import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { enroll, requestCertificate, signingDevice } from "./support/devices";
import { api, expect, test } from "./support/fixtures";

/** A PEM certificate request (needs openssl on the machine running the tests). */
function csr(names: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "csr-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "csr.pem"),
        "-subj",
        `/CN=${names[0]}`,
        "-addext",
        `subjectAltName=${names.map((n) => `DNS:${n}`).join(",")}`,
      ],
      { stdio: "ignore" },
    );
    return readFileSync(join(dir, "csr.pem"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

test.describe("certificates", () => {
  test("a device may only ask for a certificate for its own name", async ({
    createUser,
    createOrganization,
  }) => {
    const owner = await createUser("Owner");
    await createOrganization(owner, "Certs Org");
    const network = await api<{ id: string; dnsDomain: string }>(owner.page, "/v1/networks", {
      name: "home",
    });
    const laptop = await enrollDevice(owner.page, network.id, "laptop");
    await enrollDevice(owner.page, network.id, "server");

    // Another device's name, an extra name, a wildcard, other domains, and noise.
    for (const names of [
      [`server.${network.dnsDomain}`],
      [`laptop.${network.dnsDomain}`, `server.${network.dnsDomain}`],
      [`*.${network.dnsDomain}`],
      ["laptop.example.com"],
    ]) {
      const res = await requestCertificate(laptop, csr(names));
      expect(res.status, names.join()).toBe(400);
      expect(res.body.error.code).toBe("invalid_csr");
    }
    const garbage = await requestCertificate(laptop, "not a csr");
    expect(garbage.status).toBe(400);
    expect(garbage.body.error.code).toBe("invalid_csr");
  });
});
