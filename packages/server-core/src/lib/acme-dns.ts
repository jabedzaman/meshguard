/**
 * Where ACME DNS-01 challenges are answered. The control plane only ever
 * writes `_acme-challenge` TXT records: mesh names have no public address
 * records, so nothing else is published.
 */
export interface DnsChallengeProvider {
  /** Publishes the TXT record for `host` (e.g. `_acme-challenge.laptop.brave-otter.mesh.example.com`). */
  setTxt(host: string, value: string): Promise<void>;
  clearTxt(host: string, value: string): Promise<void>;
}

async function json(res: Response, what: string) {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${body.slice(0, 200)}`);
  return body ? (JSON.parse(body) as unknown) : null;
}

/** TXT records in a Cloudflare zone. The token needs DNS edit permission on it. */
export function cloudflareDns(options: {
  apiToken: string;
  zoneId: string;
  fetch?: typeof fetch;
}): DnsChallengeProvider {
  const fetcher = options.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/dns_records`;
  const headers = {
    Authorization: `Bearer ${options.apiToken}`,
    "Content-Type": "application/json",
  };
  return {
    async setTxt(host, value) {
      await json(
        await fetcher(base, {
          method: "POST",
          headers,
          body: JSON.stringify({ type: "TXT", name: host, content: value, ttl: 60 }),
        }),
        "Cloudflare TXT create",
      );
    },
    async clearTxt(host, value) {
      const found = (await json(
        await fetcher(`${base}?type=TXT&name=${encodeURIComponent(host)}`, { headers }),
        "Cloudflare TXT list",
      )) as { result: { id: string; content: string }[] };
      for (const record of found.result) {
        // Cloudflare returns TXT content quoted.
        if (record.content.replaceAll('"', "") !== value) continue;
        await json(
          await fetcher(`${base}/${record.id}`, { method: "DELETE", headers }),
          "Cloudflare TXT delete",
        );
      }
    },
  };
}

/** Pebble's challenge test server, which answers the CA's DNS lookups in tests. */
export function challtestsrvDns(options: {
  url: string;
  fetch?: typeof fetch;
}): DnsChallengeProvider {
  const fetcher = options.fetch ?? fetch;
  const post = async (path: string, body: unknown) => {
    await json(
      await fetcher(new URL(path, options.url), {
        method: "POST",
        body: JSON.stringify(body),
      }),
      `challtestsrv ${path}`,
    );
  };
  // It wants fully qualified names.
  const fqdn = (host: string) => (host.endsWith(".") ? host : `${host}.`);
  return {
    setTxt: (host, value) => post("/set-txt", { host: fqdn(host), value }),
    clearTxt: (host) => post("/clear-txt", { host: fqdn(host) }),
  };
}
