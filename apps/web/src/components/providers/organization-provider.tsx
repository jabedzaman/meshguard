"use client";

import { createContext, useContext } from "react";

export interface ActiveOrganization {
  id: string;
  name: string;
  slug: string;
}

const OrganizationContext = createContext<ActiveOrganization | null>(null);

/** Provided by the (app) layout, which loads the organization on the server. */
export function OrganizationProvider({
  organization,
  children,
}: {
  organization: ActiveOrganization;
  children: React.ReactNode;
}) {
  return <OrganizationContext value={organization}>{children}</OrganizationContext>;
}

export function useOrganization(): ActiveOrganization {
  const organization = useContext(OrganizationContext);
  if (!organization) throw new Error("useOrganization must be used inside the (app) layout");
  return organization;
}
