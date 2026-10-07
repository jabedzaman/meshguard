import { z } from "zod";
import { ACL_PROTOCOLS, parseSelector } from "@meshguard/server-core";

export const updateAclBody = z.object({
  /** "deny" blocks everything between devices that no rule allows. */
  defaultAction: z.enum(["allow", "deny"]),
});

const selector = z.string().refine((text) => parseSelector(text) !== null, {
  message: "Use *, device:<id>, tag:<name>, user:<id> or role:owner|admin|member",
});

const port = z.number().int().min(1, "Ports are 1–65535").max(65535, "Ports are 1–65535");

export const createAclRuleBody = z
  .object({
    /** Who may connect: `*`, `device:<id>`, `tag:<name>`, `user:<id>` or `role:<role>`. */
    source: selector,
    /** What they may connect to, in the same form. */
    destination: selector,
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

export const checkAccessBody = z
  .object({
    sourceDeviceId: z.uuid(),
    destinationDeviceId: z.uuid(),
    protocol: z.enum(["tcp", "udp", "icmp"]),
    port: port.optional(),
  })
  .refine((input) => input.protocol === "icmp" || input.port !== undefined, {
    path: ["port"],
    message: "TCP and UDP need a port",
  });
