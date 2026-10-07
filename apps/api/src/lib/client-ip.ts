import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/** The caller's address: behind a proxy its header, else the socket. Trust the header only when a proxy always sets it. */
export function clientIp(c: Context) {
  const forwarded = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || getConnInfo(c).remote.address || "unknown";
}
