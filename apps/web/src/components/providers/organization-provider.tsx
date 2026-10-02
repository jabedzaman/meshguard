"use client";

import { createContext, useContext } from "react";
import type { Permissions, Role } from "@mesh/auth/permissions";
import { authClient } from "~/lib/auth-client";

export interface ActiveOrganization {
  id: string;
  name: string;
  slug: string;
}

interface OrganizationContextValue {
  organization: ActiveOrganization;
  role: Role;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

/** Provided by the (app) layout, which loads the organization and role on the server. */
export function OrganizationProvider({
  organization,
  role,
  children,
}: OrganizationContextValue & { children: React.ReactNode }) {
  return <OrganizationContext value={{ organization, role }}>{children}</OrganizationContext>;
}

function useOrganizationContext(): OrganizationContextValue {
  const value = useContext(OrganizationContext);
  if (!value) throw new Error("Organization hooks must be used inside the (app) layout");
  return value;
}

export function useOrganization(): ActiveOrganization {
  return useOrganizationContext().organization;
}

export function useRole(): Role {
  return useOrganizationContext().role;
}

/**
 * Whether the user's role grants every action in `permissions`. For hiding UI
 * only; the API enforces permissions on every request.
 */
export function usePermission(permissions: Permissions): boolean {
  const role = useRole();
  return authClient.organization.checkRolePermission({ permissions, role });
}
