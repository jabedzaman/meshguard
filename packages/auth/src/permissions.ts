import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// Source of truth for organization roles. Shared by the server (enforcement)
// and the browser (hiding actions a role can't take); keep this file free of
// server-only imports.

/** Every action that can be granted, by resource. */
export const statements = {
  ...defaultStatements,
  network: ["create", "read", "update", "delete"],
  device: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
  /** Full control, including deleting the organization. */
  owner: ac.newRole({
    ...ownerAc.statements,
    network: ["create", "read", "update", "delete"],
    device: ["create", "read", "update", "delete"],
  }),
  /** Runs the organization day to day; can't delete it or change owners. */
  admin: ac.newRole({
    ...adminAc.statements,
    network: ["create", "read", "update", "delete"],
    device: ["create", "read", "update", "delete"],
  }),
  /** Uses the networks and enrolls their own devices. */
  member: ac.newRole({
    ...memberAc.statements,
    network: ["read"],
    device: ["create", "read"],
  }),
};

export type Role = keyof typeof roles;

export const ROLES = Object.keys(roles) as Role[];

/** A set of actions to check, e.g. `{ network: ["create"] }`. */
export type Permissions = {
  [Resource in keyof typeof statements]?: (typeof statements)[Resource][number][];
};
