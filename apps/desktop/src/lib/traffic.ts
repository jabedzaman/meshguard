import { useEffect, useRef, useState } from "react";
import type { Status } from "~/lib/agent";

export type TrafficPoint = { at: number; rx: number; tx: number };

const TICK_MS = 2000;
/** About two minutes of history. */
const KEEP = 60;

export const totals = (status: Status) =>
  (status.peers ?? []).reduce(
    (sum, p) => ({ rx: sum.rx + (p.rxBytes ?? 0), tx: sum.tx + (p.txBytes ?? 0) }),
    { rx: 0, tx: 0 },
  );

/**
 * Bytes per second across all peers, sampled from the agent's per-peer byte counters.
 * The agent reports totals, so each rate is the change since the previous sample.
 */
export function useTraffic(status: Status): TrafficPoint[] {
  const latest = useRef(status);
  latest.current = status;
  const previous = useRef<{ at: number; rx: number; tx: number } | null>(null);
  const [points, setPoints] = useState<TrafficPoint[]>(() =>
    Array.from({ length: KEEP }, (_, i) => ({ at: Date.now() - (KEEP - i) * TICK_MS, rx: 0, tx: 0 })),
  );

  useEffect(() => {
    const sample = () => {
      const now = Date.now();
      const cur = totals(latest.current);
      const prev = previous.current;
      previous.current = { at: now, ...cur };
      if (!prev) return;
      const seconds = (now - prev.at) / 1000;
      // A counter that went down means the interface restarted.
      const rate = (a: number, b: number) => (a >= b ? (a - b) / seconds : 0);
      setPoints((all) => [...all.slice(-(KEEP - 1)), { at: now, rx: rate(cur.rx, prev.rx), tx: rate(cur.tx, prev.tx) }]);
    };
    sample();
    const id = setInterval(sample, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return points;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export const formatRate = (n: number) => `${formatBytes(n)}/s`;
