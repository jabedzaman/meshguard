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

export const serviceQueries = {
  all: () => ["services"] as const,
  list: (networkId: string) =>
    queryOptions({
      queryKey: [...serviceQueries.all(), networkId],
      queryFn: () =>
        parseResponse(api.v1.networks[":networkId"].services.$get({ param: { networkId } })),
      // Hosts go on and offline from the command line.
      refetchInterval: 5000,
    }),
};

export const serviceMutations = {
  create: (networkId: string, name: string, hostDeviceIds: string[]) =>
    parseResponse(
      api.v1.networks[":networkId"].services.$post({
        param: { networkId },
        json: { name, hostDeviceIds },
      }),
    ),
  setHosts: (id: string, hostDeviceIds: string[]) =>
    parseResponse(api.v1.services[":id"].hosts.$put({ param: { id }, json: { hostDeviceIds } })),
  remove: (id: string) => parseResponse(api.v1.services[":id"].$delete({ param: { id } })),
};

export const deviceMutations = {
  rename: (id: string, name: string) =>
    parseResponse(api.v1.devices[":id"].$patch({ param: { id }, json: { name } })),
  remove: (id: string) => parseResponse(api.v1.devices[":id"].$delete({ param: { id } })),
  setTags: (id: string, tags: string[]) =>
    parseResponse(api.v1.devices[":id"].tags.$put({ param: { id }, json: { tags } })),
  setRoutes: (id: string, approved: string[]) =>
    parseResponse(api.v1.devices[":id"].routes.$put({ param: { id }, json: { approved } })),
};

type AclRoute = (typeof api.v1.networks)[":networkId"]["acl"];
export type AclDefaultAction = InferRequestType<AclRoute["$patch"]>["json"]["defaultAction"];
export type CreateAclRuleInput = InferRequestType<AclRoute["rules"]["$post"]>["json"];
export type CheckAccessInput = InferRequestType<AclRoute["check"]["$post"]>["json"];

export const aclQueries = {
  all: () => ["acl"] as const,
  get: (networkId: string) =>
    queryOptions({
      queryKey: [...aclQueries.all(), networkId],
      queryFn: () =>
        parseResponse(api.v1.networks[":networkId"].acl.$get({ param: { networkId } })),
    }),
  document: (networkId: string) =>
    queryOptions({
      queryKey: [...aclQueries.all(), networkId, "document"],
      queryFn: () =>
        parseResponse(api.v1.networks[":networkId"].acl.document.$get({ param: { networkId } })),
    }),
};

export const aclMutations = {
  setDefaultAction: (networkId: string, defaultAction: AclDefaultAction) =>
    parseResponse(
      api.v1.networks[":networkId"].acl.$patch({ param: { networkId }, json: { defaultAction } }),
    ),
  createRule: (networkId: string, rule: CreateAclRuleInput) =>
    parseResponse(
      api.v1.networks[":networkId"].acl.rules.$post({ param: { networkId }, json: rule }),
    ),
  removeRule: (id: string) => parseResponse(api.v1["acl-rules"][":id"].$delete({ param: { id } })),
  check: (networkId: string, input: CheckAccessInput) =>
    parseResponse(
      api.v1.networks[":networkId"].acl.check.$post({ param: { networkId }, json: input }),
    ),
};

export const deviceLoginQueries = {
  detail: (id: string) =>
    queryOptions({
      queryKey: ["device-logins", id],
      queryFn: () => parseResponse(api.v1["device-logins"][":id"].$get({ param: { id } })),
      retry: false,
    }),
};

export const deviceLoginMutations = {
  approve: (id: string, networkId: string) =>
    parseResponse(
      api.v1["device-logins"][":id"].approve.$post({ param: { id }, json: { networkId } }),
    ),
  deny: (id: string) => parseResponse(api.v1["device-logins"][":id"].deny.$post({ param: { id } })),
};
