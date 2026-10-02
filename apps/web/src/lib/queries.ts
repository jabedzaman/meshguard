import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "@meshguard/api-client";
import { parseResponse } from "@meshguard/api-client";
import { api } from "~/lib/api";
import { authClient, unwrap } from "~/lib/auth-client";

export const networkQueries = {
  all: () => ["networks"] as const,
  detail: (networkId: string) =>
    queryOptions({
      queryKey: [...networkQueries.all(), "detail", networkId],
      queryFn: () => parseResponse(api.v1.networks[":id"].$get({ param: { id: networkId } })),
    }),
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
        return invitations.filter((invitation) => invitation.status === "pending");
      },
    }),
};

export const memberQueries = {
  all: () => ["members"] as const,
  list: (organizationId: string) =>
    queryOptions({
      queryKey: [...memberQueries.all(), organizationId],
      queryFn: async () => (await unwrap(authClient.organization.listMembers())).members,
    }),
};

export type EnrollmentTokenTtl = NonNullable<
  InferRequestType<
    (typeof api.v1.networks)[":networkId"]["enrollment-tokens"]["$post"]
  >["json"]["expiresIn"]
>;

export const enrollmentTokenQueries = {
  all: () => ["enrollment-tokens"] as const,
  active: (networkId: string) =>
    queryOptions({
      queryKey: [...enrollmentTokenQueries.all(), networkId],
      queryFn: () =>
        parseResponse(
          api.v1.networks[":networkId"]["enrollment-tokens"].$get({ param: { networkId } }),
        ),
    }),
};

export const enrollmentTokenMutations = {
  create: (networkId: string, expiresIn: EnrollmentTokenTtl) =>
    parseResponse(
      api.v1.networks[":networkId"]["enrollment-tokens"].$post({
        param: { networkId },
        json: { expiresIn },
      }),
    ),
  revoke: (id: string) =>
    parseResponse(api.v1["enrollment-tokens"][":id"].$delete({ param: { id } })),
};

export const deviceQueries = {
  all: () => ["devices"] as const,
  list: (networkId: string) =>
    queryOptions({
      queryKey: [...deviceQueries.all(), networkId],
      queryFn: () =>
        parseResponse(api.v1.networks[":networkId"].devices.$get({ param: { networkId } })),
    }),
};
