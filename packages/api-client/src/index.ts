import type { Device, Network } from "@mesh/types";

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export function createApiClient({ baseUrl, fetch: f = fetch }: ApiClientOptions) {
  async function get<T>(path: string): Promise<T> {
    const res = await f(new URL(path, baseUrl), { credentials: "include" });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    health: () => get<{ ok: boolean }>("/healthz"),
    listNetworks: () => get<Network[]>("/v1/networks"),
    listDevices: (networkId: string) => get<Device[]>(`/v1/networks/${networkId}/devices`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
