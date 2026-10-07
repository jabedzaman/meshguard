import { Agent } from "node:https";
import acme from "acme-client";
import { eq, schema, type Db } from "@meshguard/db";
import { AppError, NotFoundError, TooManyRequestsError } from "~/errors";
import type { DnsChallengeProvider } from "~/lib/acme-dns";
import type { RateLimiter } from "~/lib/rate-limiter";

const { acmeAccounts, devices, networks } = schema;

export interface CertificatesConfig {
  directoryUrl: string;
  email?: string;
  dns: DnsChallengeProvider;
  /**
   * Don't look the TXT record up ourselves before asking the CA to. We do by
   * default, which waits for real DNS to propagate; a test DNS server isn't
   * reachable through the system resolver.
   */
  skipChallengeVerification?: boolean;
}

/** Certificates a device may ask for per day. CAs limit how many they issue per domain. */
export const CERTIFICATES_PER_DAY = 5;

/** CSR fields are small; refuse anything else before parsing. */
const MAX_CSR_LENGTH = 4096;

/**
 * Certificates for mesh names: `<device>.<network label>.<base domain>`. The
 * device keeps its private key and sends a CSR; the control plane proves
 * control of the name to the CA with a DNS-01 challenge under the base domain
 * (it owns that zone) and returns the chain. Only the device's own name can be
 * requested, by the device itself.
 */
export class CertificatesService {
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly db: Db,
    private readonly rateLimiter: RateLimiter,
    private readonly config: CertificatesConfig | null,
    /** `<label>.<base domain>`: where a network's devices resolve. */
    private readonly dnsDomain: (label: string) => string,
  ) {}

  get enabled() {
    return this.config !== null;
  }

  /** The name a device's certificate is for, e.g. `laptop.brave-otter.mesh.jabed.dev`. */
  async nameOf(deviceId: string) {
    const [row] = await this.db
      .select({ name: devices.name, dnsLabel: networks.dnsLabel })
      .from(devices)
      .innerJoin(networks, eq(networks.id, devices.networkId))
      .where(eq(devices.id, deviceId));
    if (!row) throw new NotFoundError("device");
    return `${row.name}.${this.dnsDomain(row.dnsLabel)}`;
  }

  /** Issues the certificate chain (PEM) for the device's own name. */
  async issue(deviceId: string, csr: string) {
    if (!this.config) {
      throw new AppError(
        501,
        "certificates_not_configured",
        "This control plane doesn't issue HTTPS certificates",
      );
    }
    if (csr.length > MAX_CSR_LENGTH) {
      throw new AppError(400, "invalid_csr", "The certificate request is too large");
    }
    const name = await this.nameOf(deviceId);
    assertCsrIsFor(csr, name);

    const limit = await this.rateLimiter.hit(
      "certificate",
      deviceId,
      CERTIFICATES_PER_DAY,
      24 * 60 * 60 * 1000,
    );
    if (!limit.allowed) throw new TooManyRequestsError(limit.retryAfter);

    // One order per name at a time: an agent retrying must not start another.
    const pending = this.inFlight.get(name);
    if (pending) return { name, certificate: await pending };
    const order = this.order(csr, name).finally(() => this.inFlight.delete(name));
    this.inFlight.set(name, order);
    return { name, certificate: await order };
  }

  private async order(csr: string, name: string) {
    const config = this.config!;
    const client = new acme.Client({
      directoryUrl: config.directoryUrl,
      accountKey: await this.accountKey(config.directoryUrl),
    });
    const host = `_acme-challenge.${name}`;
    try {
      return await client.auto({
        csr,
        email: config.email,
        termsOfServiceAgreed: true,
        challengePriority: ["dns-01"],
        skipChallengeVerification: config.skipChallengeVerification,
        challengeCreateFn: (_authz, _challenge, value) => config.dns.setTxt(host, value),
        challengeRemoveFn: (_authz, _challenge, value) => config.dns.clearTxt(host, value),
      });
    } catch (error) {
      throw new AppError(
        502,
        "certificate_failed",
        `The certificate authority didn't issue the certificate: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The account key for the directory, created on first use. */
  private async accountKey(directoryUrl: string) {
    const [existing] = await this.db
      .select({ keyPem: acmeAccounts.keyPem })
      .from(acmeAccounts)
      .where(eq(acmeAccounts.directoryUrl, directoryUrl));
    if (existing) return existing.keyPem;
    const key = (await acme.crypto.createPrivateEcdsaKey()).toString();
    // Two replicas may race; the loser reads the winner's key.
    await this.db.insert(acmeAccounts).values({ directoryUrl, keyPem: key }).onConflictDoNothing();
    const [stored] = await this.db
      .select({ keyPem: acmeAccounts.keyPem })
      .from(acmeAccounts)
      .where(eq(acmeAccounts.directoryUrl, directoryUrl));
    return stored!.keyPem;
  }
}

/**
 * Accepts a CSR only for exactly `name`, so a device can't get a certificate
 * for another device's name or for anything outside its network's domain.
 */
export function assertCsrIsFor(csr: string, name: string) {
  let domains: { commonName: string | null; altNames: string[] };
  try {
    domains = acme.crypto.readCsrDomains(csr) as typeof domains;
  } catch {
    throw new AppError(400, "invalid_csr", "Not a valid certificate request");
  }
  const names = new Set([domains.commonName, ...domains.altNames].filter(Boolean));
  if (names.size !== 1 || !names.has(name)) {
    throw new AppError(
      400,
      "invalid_csr",
      `The certificate request must be for ${name} and nothing else`,
    );
  }
}

/** For tests against Pebble, whose directory uses a certificate no CA signed. */
export function trustAnyAcmeServer() {
  acme.axios.defaults.httpsAgent = new Agent({ rejectUnauthorized: false });
}
