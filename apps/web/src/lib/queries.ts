import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "@meshguard/api-client";
import { parseResponse } from "@meshguard/api-client";
import { api } from "~/lib/api";
import { authClient, unwrap } from "~/lib/auth-client";

export const networkQueries = {
  all: () => ["network"] as const,
  /** The organization's network; the API resolves it from the session. */
  current: () =>
    queryOptions({
      queryKey: networkQueries.all(),
      queryFn: () => parseResponse(api.v1.network.$get()),
    }),
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
    typeof api.v1.network["enrollment-tokens"]["$post"]
  >["json"]["expiresIn"]
>;

export const enrollmentTokenQueries = {
  all: () => ["enrollment-tokens"] as const,
  active: () =>
    queryOptions({
      queryKey: enrollmentTokenQueries.all(),
      queryFn: () =>
        parseResponse(
          api.v1.network["enrollment-tokens"].$get(),
        ),
    }),
};

export const enrollmentTokenMutations = {
  create: (expiresIn: EnrollmentTokenTtl) =>
    parseResponse(
      api.v1.network["enrollment-tokens"].$post({
        json: { expiresIn },
      }),
    ),
  revoke: (id: string) =>
    parseResponse(api.v1["enrollment-tokens"][":id"].$delete({ param: { id } })),
};

export const deviceQueries = {
  all: () => ["devices"] as const,
  list: () =>
    queryOptions({
      queryKey: deviceQueries.all(),
      queryFn: () =>
        parseResponse(api.v1.network.devices.$get()),
    }),
};

export const serviceQueries = {
  all: () => ["services"] as const,
  list: () =>
    queryOptions({
      queryKey: serviceQueries.all(),
      queryFn: () =>
        parseResponse(api.v1.network.services.$get()),
      // Hosts go on and offline from the command line.
      refetchInterval: 5000,
    }),
};

export const connectorQueries = {
  all: () => ["connectors"] as const,
  list: () =>
    queryOptions({
      queryKey: connectorQueries.all(),
      queryFn: () =>
        parseResponse(api.v1.network.connectors.$get()),
      refetchInterval: 5000,
    }),
};

export const connectorMutations = {
  create: (name: string, domains: string[], hostDeviceIds: string[]) =>
    parseResponse(
      api.v1.network.connectors.$post({
        json: { name, domains, hostDeviceIds },
      }),
    ),
  update: (id: string, input: { domains?: string[]; hostDeviceIds?: string[] }) =>
    parseResponse(api.v1.connectors[":id"].$patch({ param: { id }, json: input })),
  remove: (id: string) => parseResponse(api.v1.connectors[":id"].$delete({ param: { id } })),
};

export const serviceMutations = {
  create: (name: string, hostDeviceIds: string[]) =>
    parseResponse(
      api.v1.network.services.$post({
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
  setFunnel: (id: string, enabled: boolean) =>
    parseResponse(api.v1.devices[":id"].funnel.$put({ param: { id }, json: { enabled } })),
  setRoutes: (id: string, approved: string[]) =>
    parseResponse(api.v1.devices[":id"].routes.$put({ param: { id }, json: { approved } })),
};

type AclRoute = typeof api.v1.network["acl"];
export type AclDefaultAction = InferRequestType<AclRoute["$patch"]>["json"]["defaultAction"];
export type CreateAclRuleInput = InferRequestType<AclRoute["rules"]["$post"]>["json"];
export type CheckAccessInput = InferRequestType<AclRoute["check"]["$post"]>["json"];

export const aclQueries = {
  all: () => ["acl"] as const,
  get: () =>
    queryOptions({
      queryKey: aclQueries.all(),
      queryFn: () =>
        parseResponse(api.v1.network.acl.$get()),
    }),
  document: () =>
    queryOptions({
      queryKey: [...aclQueries.all(), "document"],
      queryFn: () =>
        parseResponse(api.v1.network.acl.document.$get()),
    }),
};

export const aclMutations = {
  setDefaultAction: (defaultAction: AclDefaultAction) =>
    parseResponse(
      api.v1.network.acl.$patch({ json: { defaultAction } }),
    ),
  createRule: (rule: CreateAclRuleInput) =>
    parseResponse(
      api.v1.network.acl.rules.$post({ json: rule }),
    ),
  removeRule: (id: string) => parseResponse(api.v1["acl-rules"][":id"].$delete({ param: { id } })),
  check: (input: CheckAccessInput) =>
    parseResponse(
      api.v1.network.acl.check.$post({ json: input }),
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
  approve: (id: string) =>
    parseResponse(
      api.v1["device-logins"][":id"].approve.$post({ param: { id } }),
    ),
  deny: (id: string) => parseResponse(api.v1["device-logins"][":id"].deny.$post({ param: { id } })),
};
