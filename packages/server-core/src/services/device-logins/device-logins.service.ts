import { randomBytes, randomInt } from "node:crypto";
import type { Redis } from "ioredis";
import { NotFoundError } from "~/errors";
import { hashToken } from "~/lib/tokens";
import type {
  Actor,
  EnrollmentTokensService,
} from "~/services/enrollment-tokens/enrollment-tokens.service";

/** How long a login can be approved. */
export const DEVICE_LOGIN_TTL_SECONDS = 10 * 60;
/** How often the CLI should poll. */
export const DEVICE_LOGIN_POLL_INTERVAL_SECONDS = 2;

export const DEVICE_LOGIN_SECRET_PREFIX = "meshguard_login_";

/** The lookup key in the approval URL: 128 random bits, so it can't be guessed. */
export const DEVICE_LOGIN_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

// No 0/O/1/I/L: the code is only compared by eye between the terminal and the page.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "ABCD-EFGH". */
function generateUserCode() {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!;
  const part = () => Array.from({ length: 4 }, pick).join("");
  return `${part()}-${part()}`;
}

interface LoginState {
  /** Lookup key of the approval page (in its URL). */
  id: string;
  /** Shown in the terminal and on the page so the user can tell they match. Not a key. */
  userCode: string;
  /** Set when a signed-in user approves the login. */
  approvedBy?: string;
  networkId?: string;
  /** The enrollment token minted on approval; deleted from Redis once the CLI collects it. */
  token?: string;
  /** What the device said about itself, shown on the approval page. */
  hostname: string;
  platform: string;
  /** Address the login was started from, as the API saw it. For display only. */
  ip?: string;
  startedAt: string;
}

const secretKey = (secret: string) => `device-login:secret:${hashToken(secret)}`;
const idKey = (id: string) => `device-login:id:${id}`;

export type DeviceLoginPoll = { status: "pending" } | { status: "approved"; token: string };

/**
 * Browser login for `meshguard up` (device authorization, as in RFC 8628): the
 * CLI starts a login and shows a URL, a signed-in user approves it for a
 * network, and the CLI collects an enrollment token owned by that user. State
 * lives in Redis with a TTL; nothing is kept once the login ends.
 */
export class DeviceLoginsService {
  constructor(
    private readonly redis: Redis,
    private readonly enrollmentTokens: EnrollmentTokensService,
    private readonly webUrl: string,
  ) {}

  /** Starts a login. `secret` is for the CLI alone; the user opens `verificationUrl` and compares `userCode`. */
  async start(device: { hostname: string; platform: string; ip?: string }) {
    const secret = `${DEVICE_LOGIN_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
    const id = randomBytes(16).toString("base64url");
    const userCode = generateUserCode();
    const state: LoginState = { id, userCode, ...device, startedAt: new Date().toISOString() };
    await this.redis
      .multi()
      .set(secretKey(secret), JSON.stringify(state), "EX", DEVICE_LOGIN_TTL_SECONDS)
      .set(idKey(id), hashToken(secret), "EX", DEVICE_LOGIN_TTL_SECONDS)
      .exec();
    const url = new URL("/connect", this.webUrl);
    url.searchParams.set("login", id);
    return {
      secret,
      userCode,
      verificationUrl: url.toString(),
      expiresIn: DEVICE_LOGIN_TTL_SECONDS,
      interval: DEVICE_LOGIN_POLL_INTERVAL_SECONDS,
    };
  }

  private async load(id: string) {
    const secretHash = await this.redis.get(idKey(id));
    if (!secretHash) throw new NotFoundError("device_login");
    const raw = await this.redis.get(`device-login:secret:${secretHash}`);
    if (!raw) throw new NotFoundError("device_login");
    return { secretHash, state: JSON.parse(raw) as LoginState };
  }

  /** What the approval page shows before the user confirms. */
  async describe(id: string) {
    const { state } = await this.load(id);
    return {
      userCode: state.userCode,
      hostname: state.hostname,
      platform: state.platform,
      ip: state.ip ?? null,
      startedAt: state.startedAt,
      approved: Boolean(state.approvedBy),
    };
  }

  /** Approves the login for a network in the actor's organization; the device will belong to the actor. */
  async approve(actor: Actor, id: string, networkId: string) {
    const { secretHash, state } = await this.load(id);
    if (state.approvedBy) return;
    const { token } = await this.enrollmentTokens.create(actor, networkId, "1h");
    const next: LoginState = { ...state, approvedBy: actor.userId, networkId, token };
    // KEEPTTL: approving must not extend the login's lifetime.
    await this.redis.set(`device-login:secret:${secretHash}`, JSON.stringify(next), "KEEPTTL");
  }

  /** Denies a pending login so the CLI stops waiting. */
  async deny(id: string) {
    const { secretHash } = await this.load(id);
    await this.redis.del(`device-login:secret:${secretHash}`, idKey(id));
  }

  /** The CLI's poll. The token is returned once, then the login is gone. */
  async poll(secret: string): Promise<DeviceLoginPoll> {
    const raw = await this.redis.get(secretKey(secret));
    if (!raw) throw new NotFoundError("device_login");
    const state = JSON.parse(raw) as LoginState;
    if (!state.token) return { status: "pending" };
    await this.redis.del(secretKey(secret), idKey(state.id));
    return { status: "approved", token: state.token };
  }
}
