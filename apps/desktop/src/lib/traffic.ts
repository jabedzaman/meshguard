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
  const previous = useRef<{ at: number; rx: number; tx: number } | null>(null);
  const [points, setPoints] = useState<TrafficPoint[]>(() =>
    Array.from({ length: KEEP }, (_, i) => ({ at: Date.now() - (KEEP - i) * TICK_MS, rx: 0, tx: 0 })),
  );

  // The shell only pushes a status when something changed, so a fixed timer can land before the
  // update and read zero. Sample when a status arrives, and fall back to a timer for quiet periods.
  const latest = useRef(status);
  latest.current = status;
  const sample = useRef(() => {});
  sample.current = () => {
    const now = Date.now();
    const cur = totals(latest.current);
    const prev = previous.current;
    if (prev && now - prev.at < 500) return;
    previous.current = { at: now, ...cur };
    if (!prev) return;
    const seconds = (now - prev.at) / 1000;
    // A counter that went down means the interface restarted.
    const rate = (a: number, b: number) => (a >= b ? (a - b) / seconds : 0);
    setPoints((all) => [...all.slice(-(KEEP - 1)), { at: now, rx: rate(cur.rx, prev.rx), tx: rate(cur.tx, prev.tx) }]);
  };

  useEffect(() => {
    sample.current();
  }, [status]);

  useEffect(() => {
    const id = setInterval(() => {
      const prev = previous.current;
      if (!prev || Date.now() - prev.at >= TICK_MS) sample.current();
    }, TICK_MS);
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
