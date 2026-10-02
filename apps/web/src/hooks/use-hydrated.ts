import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during server rendering and before hydration, true after. Use it to
 * disable server-rendered buttons until their click handlers are attached, so
 * early clicks aren't silently lost.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
