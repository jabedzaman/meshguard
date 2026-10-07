import { z } from "zod";
import { SERVICE_NAME_PATTERN } from "@meshguard/server-core";

const domains = z.array(z.string().max(253)).min(1).max(32);

export const createConnectorBody = z.object({
  /** A short name for the connector, e.g. "corp". */
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      SERVICE_NAME_PATTERN,
      "Use 1–63 letters, digits and hyphens, not starting or ending with a hyphen",
    ),
  /** Domains whose traffic goes through the hosts; each covers every name under it. */
  domains,
  hostDeviceIds: z.array(z.uuid()).max(64).default([]),
});

export const updateConnectorBody = z
  .object({
    domains: domains.optional(),
    hostDeviceIds: z.array(z.uuid()).max(64).optional(),
  })
  .refine((body) => body.domains !== undefined || body.hostDeviceIds !== undefined, {
    message: "Give domains, hosts or both",
  });
