import { z } from "zod";
import { ACL_PROTOCOLS } from "@meshguard/server-core";

export const updateAclBody = z.object({
  /** "deny" blocks everything between devices that no rule allows. */
  defaultAction: z.enum(["allow", "deny"]),
});

const port = z.number().int().min(1, "Ports are 1–65535").max(65535, "Ports are 1–65535");

export const createAclRuleBody = z
  .object({
    /** Null: any device in the network. */
    sourceDeviceId: z.uuid().nullable(),
    /** Null: every device in the network. */
    destinationDeviceId: z.uuid().nullable(),
    protocol: z.enum(ACL_PROTOCOLS).default("any"),
    /** TCP/UDP destination port, or the first of a range; omit for every port. */
    portFrom: port.optional(),
    /** Last port of the range; defaults to portFrom. */
    portTo: port.optional(),
  })
  .superRefine((rule, ctx) => {
    const hasPorts = rule.portFrom !== undefined || rule.portTo !== undefined;
    if (hasPorts && rule.protocol !== "tcp" && rule.protocol !== "udp") {
      ctx.addIssue({ code: "custom", path: ["portFrom"], message: "Ports need TCP or UDP" });
    } else if (rule.portTo !== undefined && rule.portFrom === undefined) {
      ctx.addIssue({ code: "custom", path: ["portFrom"], message: "Set the first port" });
    } else if (rule.portTo !== undefined && rule.portTo < rule.portFrom!) {
      ctx.addIssue({
        code: "custom",
        path: ["portTo"],
        message: "Must not be below the first port",
      });
    }
  });
