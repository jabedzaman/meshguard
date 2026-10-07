import { useEffect, useRef } from "react";

const KEYFRAMES: Keyframe[] = [
  { backgroundColor: "color-mix(in oklch, var(--primary) 20%, transparent)" },
  { backgroundColor: "transparent" },
];

/**
 * Briefly highlights the rows whose `signature` changed since the last data
 * (e.g. a device that just came online). Rows mark themselves with
 * `data-flash-id`; nothing flashes on the first load.
 */
export function useFlash<T>(
  items: T[] | undefined,
  id: (item: T) => string,
  signature: (item: T) => string,
) {
  const container = useRef<HTMLUListElement>(null);
  const previous = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (!items) return;
    const next = new Map(items.map((item) => [id(item), signature(item)]));
    const before = previous.current;
    previous.current = next;
    if (!before || !container.current) return;
    for (const [key, value] of next) {
      if (before.get(key) === value) continue;
      container.current
        .querySelector(`[data-flash-id="${CSS.escape(key)}"]`)
        ?.animate(KEYFRAMES, { duration: 1600, easing: "ease-out" });
    }
  }, [items, id, signature]);

  return container;
}
