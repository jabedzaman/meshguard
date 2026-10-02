"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { DetailedError } from "@meshguard/api-client";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retrying a 4xx (unauthorized, not found, validation) won't change the outcome.
        retry: (failureCount, error) => {
          const status = error instanceof DetailedError ? Number(error.statusCode) : 0;
          return !(status >= 400 && status < 500) && failureCount < 3;
        },
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools />
    </QueryClientProvider>
  );
}
