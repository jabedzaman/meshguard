import { describe, expect, it } from "vitest";
import { challtestsrvDns, cloudflareDns } from "~/lib/acme-dns";

type Call = { method: string; url: string; body?: unknown };

function fakeFetch(listed: Record<string, { id: string; content: string }[]> = {}) {
  const calls: Call[] = [];
  const fetcher = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const type = /type=(\w+)/.exec(url)?.[1];
    const result = (init?.method ?? "GET") === "GET" ? (listed[type ?? ""] ?? []) : {};
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("cloudflareDns", () => {
  const options = { apiToken: "t", zoneId: "z" };

  it("creates a TXT record and removes only the one with the same value", async () => {
    const { calls, fetcher } = fakeFetch({
      TXT: [
        { id: "1", content: '"keep"' },
        { id: "2", content: '"value"' },
      ],
    });
    const dns = cloudflareDns({ ...options, fetch: fetcher });
    await dns.setTxt("_acme-challenge.x.example.com", "value");
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: { type: "TXT", name: "_acme-challenge.x.example.com", content: "value" },
    });
    await dns.clearTxt("_acme-challenge.x.example.com", "value");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      "https://api.cloudflare.com/client/v4/zones/z/dns_records/2",
    ]);
  });

  it("points a name at an address, replacing what was there, unproxied", async () => {
    const { calls, fetcher } = fakeFetch({ A: [{ id: "old", content: "1.2.3.4" }] });
    const dns = cloudflareDns({ ...options, fetch: fetcher });
    await dns.setA("x.example.com", "5.6.7.8");
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE", "POST"]);
    expect(calls[2]!.body).toMatchObject({ type: "A", content: "5.6.7.8", proxied: false });

    const same = fakeFetch({ A: [{ id: "a", content: "5.6.7.8" }] });
    await cloudflareDns({ ...options, fetch: same.fetcher }).setA("x.example.com", "5.6.7.8");
    expect(same.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("reports API failures", async () => {
    const fetcher = (async () => new Response("denied", { status: 403 })) as typeof fetch;
    await expect(
      cloudflareDns({ ...options, fetch: fetcher }).setA("x.example.com", "1.1.1.1"),
    ).rejects.toThrow(/403/);
  });
});

describe("challtestsrvDns", () => {
  it("uses fully qualified names", async () => {
    const { calls, fetcher } = fakeFetch();
    const dns = challtestsrvDns({ url: "http://challtestsrv:8055", fetch: fetcher });
    await dns.setTxt("_acme-challenge.x.example.com", "v");
    await dns.setA("x.example.com", "10.0.0.1");
    await dns.clearA("x.example.com");
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      ["http://challtestsrv:8055/set-txt", { host: "_acme-challenge.x.example.com.", value: "v" }],
      ["http://challtestsrv:8055/add-a", { host: "x.example.com.", addresses: ["10.0.0.1"] }],
      ["http://challtestsrv:8055/clear-a", { host: "x.example.com." }],
    ]);
  });
});
