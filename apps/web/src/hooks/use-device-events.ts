"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "~/lib/api";
import { deviceQueries, enrollmentTokenQueries } from "~/lib/queries";

/** Wait before reopening a stream the browser gave up on (e.g. the API restarted with an error). */
const RETRY_MS = 5_000;

/**
 * Keeps the network's device list live: the API streams device events
 * (enrolled, connected, updated, disconnected, removed) and each one re-reads
 * the list. `ready` fires on every (re)connect, so changes missed while
 * disconnected are picked up too.
 */
export function useDeviceEvents(networkId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const url = api.v1.networks[":networkId"].devices.events.$url({ param: { networkId } });
    const refreshDevices = () =>
      queryClient.invalidateQueries({ queryKey: deviceQueries.list(networkId).queryKey });

    let source: EventSource;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      source = new EventSource(url, { withCredentials: true });
      source.addEventListener("ready", () => void refreshDevices());
      source.addEventListener("device", (message) => {
        void refreshDevices();
        // A new device used up a token; refresh the active tokens list too.
        const { type } = JSON.parse(message.data) as { type: string };
        if (type === "enrolled") {
          void queryClient.invalidateQueries({
            queryKey: enrollmentTokenQueries.active(networkId).queryKey,
          });
        }
      });
      // The browser retries dropped streams itself, but not failed responses.
      source.addEventListener("error", () => {
        if (source.readyState === EventSource.CLOSED) retry = setTimeout(open, RETRY_MS);
      });
    };
    open();

    return () => {
      clearTimeout(retry);
      source.close();
    };
  }, [networkId, queryClient]);
}
