import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "@mesh/api-client";
import { parseResponse } from "@mesh/api-client";
import { api } from "~/lib/api";
import { authClient, unwrap } from "~/lib/auth-client";

export const networkQueries = {
  all: () => ["networks"] as const,
  list: (organizationId: string) =>
    queryOptions({
      queryKey: [...networkQueries.all(), organizationId],
      queryFn: () => parseResponse(api.v1.networks.$get()),
    }),
};

export type CreateNetworkInput = InferRequestType<typeof api.v1.networks.$post>["json"];

export const networkMutations = {
  create: (input: CreateNetworkInput) => parseResponse(api.v1.networks.$post({ json: input })),
};

export const invitationQueries = {
  all: () => ["invitations"] as const,
  pending: (organizationId: string) =>
    queryOptions({
      queryKey: [...invitationQueries.all(), organizationId],
      queryFn: async () => {
        const invitations = await unwrap(authClient.organization.listInvitations());
        return (invitations ?? []).filter((invitation) => invitation.status === "pending");
      },
    }),
};
