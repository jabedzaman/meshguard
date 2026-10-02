import { z } from "zod";
import { ipv4CidrSchema } from "@mesh/server-core";

export const createNetworkBody = z.object({
  name: z.string().trim().min(1, "Required").max(64, "At most 64 characters"),
  /** Defaults to 10.77.0.0/16. */
  ipv4Cidr: ipv4CidrSchema.optional(),
});
