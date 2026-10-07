import { z } from "zod";
import { SERVICE_NAME_PATTERN } from "@meshguard/server-core";

export const createServiceBody = z.object({
  /** A DNS label: the service answers at `<name>.svc.<network domain>`. */
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      SERVICE_NAME_PATTERN,
      "Use 1–63 letters, digits and hyphens, not starting or ending with a hyphen",
    ),
  /** Devices that serve it; can be changed later. */
  hostDeviceIds: z.array(z.uuid()).max(64).default([]),
});

export const setServiceHostsBody = z.object({
  hostDeviceIds: z.array(z.uuid()).max(64),
});
