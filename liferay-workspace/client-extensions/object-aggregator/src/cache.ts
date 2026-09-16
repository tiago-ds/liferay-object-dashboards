import { CACHE_TTL_MS } from "./constants.js";
import type { DataPoint } from "./types.js";

export interface ScanCost {
  /** Rows read from Liferay for this scan. */
  rowsScanned: number;
  /** HTTP requests the scan cost. */
  requests: number;
  /** Wall-clock of the scan + aggregation. */
  elapsedMs: number;
  /** True when MAX_ROWS cut the scan short — the chart is then a partial view. */
  truncated: boolean;
}

interface Entry {
  points: DataPoint[];
  cost: ScanCost;
  storedAt: number;
}

const entries = new Map<string, Entry>();

/**
 * The scan is expensive — up to hundreds of HTTP requests for a wide Object —
 * but a dashboard is read-heavy and re-read constantly: every reload, every
 * widget on the page. Caching the finished DataPoint[] is what makes the cost
 * defensible: it is paid once per TTL instead of once per render.
 *
 * Keys are partitioned by user (see server.ts) because reads now run with the
 * caller's permissions, so identical config can legitimately yield different
 * results. That costs cross-user sharing — the correct trade.
 *
 * Deliberately in-process: a cache entry is a handful of points, and there are
 * as many keys as there are distinct configured charts per viewer. More than
 * one replica wants a shared cache.
 */
export function readCache(key: string): { points: DataPoint[]; cost: ScanCost; ageMs: number } | null {
  const entry = entries.get(key);
  if (!entry) return null;

  const ageMs = Date.now() - entry.storedAt;
  if (ageMs > CACHE_TTL_MS) {
    entries.delete(key);
    return null;
  }

  return { ageMs, cost: entry.cost, points: entry.points };
}

export function writeCache(key: string, points: DataPoint[], cost: ScanCost): void {
  entries.set(key, { cost, points, storedAt: Date.now() });
}
