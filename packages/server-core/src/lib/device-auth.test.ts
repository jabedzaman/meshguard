import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signingString, verifyDeviceSignature } from "~/lib/device-auth";

const NONCE = "AAECAwQFBgcICQoLDA0ODw";

function device() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  return {
    publicKey: raw,
    sign: (method: string, path: string, timestamp: string, body: string, nonce = NONCE) =>
      sign(
        null,
        Buffer.from(signingString(method, path, timestamp, body, nonce)),
        privateKey,
      ).toString("base64"),
  };
}

describe("verifyDeviceSignature", () => {
  const now = 1_800_000_000_000;
  const ts = String(now);
  const body = '{"endpoints":["192.168.1.5:51820"]}';

  it("accepts a valid signature", () => {
    const d = device();
    const signature = d.sign("POST", "/v1/devices/self/sync", ts, body);
    expect(
      verifyDeviceSignature({
        publicKey: d.publicKey,
        signature,
        method: "POST",
        path: "/v1/devices/self/sync",
        timestamp: ts,
        body,
        nonce: NONCE,
        now,
      }),
    ).toBe(true);
  });

  it.each([
    ["body", { body: '{"endpoints":[]}' }],
    ["path", { path: "/v1/devices/self/other" }],
    ["method", { method: "GET" }],
    ["timestamp", { timestamp: String(now + 1) }],
    ["nonce", { nonce: "BAECAwQFBgcICQoLDA0ODw" }],
  ])("rejects a tampered %s", (_, change) => {
    const d = device();
    const signature = d.sign("POST", "/v1/devices/self/sync", ts, body);
    expect(
      verifyDeviceSignature({
        publicKey: d.publicKey,
        signature,
        method: "POST",
        path: "/v1/devices/self/sync",
        timestamp: ts,
        body,
        nonce: NONCE,
        now,
        ...change,
      }),
    ).toBe(false);
  });

  it("rejects a malformed nonce", () => {
    const d = device();
    const nonce = "short";
    const signature = d.sign("POST", "/p", ts, body, nonce);
    expect(
      verifyDeviceSignature({
        publicKey: d.publicKey,
        signature,
        method: "POST",
        path: "/p",
        timestamp: ts,
        body,
        nonce,
        now,
      }),
    ).toBe(false);
  });

  it("rejects another device's key", () => {
    const signer = device();
    const other = device();
    const signature = signer.sign("POST", "/p", ts, "");
    expect(
      verifyDeviceSignature({
        publicKey: other.publicKey,
        signature,
        method: "POST",
        path: "/p",
        timestamp: ts,
        body: "",
        nonce: NONCE,
        now,
      }),
    ).toBe(false);
  });

  it("rejects timestamps outside the window", () => {
    const d = device();
    const stale = String(now - 3 * 60 * 1000);
    const signature = d.sign("POST", "/p", stale, "");
    expect(
      verifyDeviceSignature({
        publicKey: d.publicKey,
        signature,
        method: "POST",
        path: "/p",
        timestamp: stale,
        body: "",
        nonce: NONCE,
        now,
      }),
    ).toBe(false);
  });

  it("rejects garbage input without throwing", () => {
    expect(
      verifyDeviceSignature({
        publicKey: "x",
        signature: "y",
        method: "POST",
        path: "/p",
        timestamp: "nope",
        body: "",
        nonce: NONCE,
      }),
    ).toBe(false);
  });

  it("matches the Go agent's signing string", () => {
    // Same vector as TestSigningString in internal/coordination/sign_test.go.
    expect(
      signingString(
        "post",
        "/v1/devices/self/sync",
        "1800000000000",
        "{}",
        "AAECAwQFBgcICQoLDA0ODw",
      ),
    ).toBe(
      "POST\n/v1/devices/self/sync\n1800000000000\nAAECAwQFBgcICQoLDA0ODw\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });
});
