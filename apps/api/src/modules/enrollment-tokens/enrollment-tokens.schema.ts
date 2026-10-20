import { z } from "zod";
import {
  ENROLLMENT_TOKEN_TTLS,
  TAG_PATTERN,
  type EnrollmentTokenTtl,
} from "@meshguard/server-core";

export const createEnrollmentTokenBody = z.object({
  /** How long the token stays valid. */
  expiresIn: z
    .enum(Object.keys(ENROLLMENT_TOKEN_TTLS) as [EnrollmentTokenTtl, ...EnrollmentTokenTtl[]])
    .default("1h"),
  /** Enrolls any number of devices (owners and admins only). */
  reusable: z.boolean().default(false),
  /** Its devices are removed after being offline a while (owners and admins only). */
  ephemeral: z.boolean().default(false),
  /** Its devices skip the network's device approval (owners and admins only). */
  preApproved: z.boolean().default(false),
  /** Tags (without "tag:") its devices start with; they grant access, so owners and admins only. */
  tags: z.array(z.string().regex(TAG_PATTERN, "Not a valid tag")).max(20).default([]),
});
