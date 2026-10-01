import { queryOptions } from "@tanstack/react-query";
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
