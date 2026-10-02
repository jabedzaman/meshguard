import { z } from "zod";
import { ENROLLMENT_TOKEN_TTLS, type EnrollmentTokenTtl } from "@mesh/server-core";

export const createEnrollmentTokenBody = z.object({
  /** How long the token stays valid. */
  expiresIn: z
    .enum(Object.keys(ENROLLMENT_TOKEN_TTLS) as [EnrollmentTokenTtl, ...EnrollmentTokenTtl[]])
    .default("1h"),
});
