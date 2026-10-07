import acme from "acme-client";
import { describe, expect, it } from "vitest";
import { AppError } from "~/errors";
import { assertCsrIsFor } from "~/services/certificates/certificates.service";

const name = "laptop.brave-otter.mesh.example.com";

async function csrFor(commonName: string, altNames: string[] = []) {
  const [, csr] = await acme.crypto.createCsr({ commonName, altNames });
  return csr.toString();
}

describe("assertCsrIsFor", () => {
  it("accepts a request for exactly the device's name", async () => {
    const plain = await csrFor(name);
    const withAlt = await csrFor(name, [name]);
    expect(() => assertCsrIsFor(plain, name)).not.toThrow();
    expect(() => assertCsrIsFor(withAlt, name)).not.toThrow();
  });

  it("refuses other names, extra names and wildcards", async () => {
    for (const csr of [
      await csrFor("server.brave-otter.mesh.example.com"),
      await csrFor(name, ["server.brave-otter.mesh.example.com"]),
      await csrFor(name, ["example.com"]),
      await csrFor(`*.brave-otter.mesh.example.com`),
      await csrFor("example.com"),
    ]) {
      expect(() => assertCsrIsFor(csr, name)).toThrowError(AppError);
    }
  });

  it("refuses what is not a request", () => {
    expect(() => assertCsrIsFor("", name)).toThrowError(AppError);
    expect(() => assertCsrIsFor("not a csr", name)).toThrowError(/Not a valid certificate request/);
  });
});
