import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "@mesh/api-client";
import { parseResponse } from "@mesh/api-client";
import { api } from "~/lib/api";

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
