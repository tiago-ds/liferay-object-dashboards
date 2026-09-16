import type { ChartConfig, DataPoint } from "./types.js";
import { isCountMeasure } from "./classify.js";

const EMPTY_BUCKET = "(none)";

/**
 * The heart of the widget — and the talk. Liferay's Object entry endpoints
 * filter, sort, field-select and paginate, but offer no group-by, so we do it
 * here in the browser: group the fetched rows by the chosen dimension, then
 * count / sum / average the chosen measure per group.
 *
 * Pure and synchronous so it is trivially unit-testable and so the talk can
 * show exactly where the aggregation happens (and honestly name where this
 * client-side approach stops scaling).
 */
export function aggregate(
  rows: Record<string, unknown>[],
  config: ChartConfig
): DataPoint[] {
  const { dimension, measure, aggregation, dateBucket, weightField } = config;

  // group key -> running accumulator
  const groups = new Map<
    string,
    { sum: number; count: number; n: number; weight: number }
  >();

  for (const row of rows) {
    const key = bucketKey(row[dimension], dateBucket);
    const acc = groups.get(key) ?? { sum: 0, count: 0, n: 0, weight: 0 };

    acc.count += 1; // number of records in the group (used by "count")
    if (!isCountMeasure(measure)) {
      const num = toNumber(row[measure as string]);
      if (num !== null) {
        acc.sum += num;
        acc.n += 1; // number of numeric values (used by "avg")
      }
    }
    if (weightField) {
      const w = toNumber(row[weightField]);
      if (w !== null) acc.weight += w; // denominator (used by "wavg")
    }
    groups.set(key, acc);
  }

  const points: DataPoint[] = [];
  for (const [name, acc] of groups) {
    let value: number;
    if (aggregation === "count") value = acc.count;
    else if (aggregation === "sum") value = acc.sum;
    // Weighted average: a ratio of sums, so it stays correct over rows that are
    // themselves already aggregated. Averaging averages would not.
    else if (aggregation === "wavg") value = acc.weight > 0 ? acc.sum / acc.weight : 0;
    else value = acc.n > 0 ? acc.sum / acc.n : 0; // avg
    points.push({ name, value: round(value) });
  }

  return sortPoints(points, Boolean(dateBucket));
}

/** Bucket a raw dimension value into a stable group label. */
function bucketKey(raw: unknown, dateBucket?: "day" | "month"): string {
  if (raw === null || raw === undefined || raw === "") return EMPTY_BUCKET;

  if (dateBucket) {
    const iso = String(raw);
    // Liferay dates come back as "2026-06-20" or "2026-06-20T10:00:00Z".
    // Slice rather than parse to avoid timezone drift shifting the day.
    return dateBucket === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
  }

  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw);
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Dates sort chronologically (ISO buckets sort lexically); else by value desc. */
function sortPoints(points: DataPoint[], isDate: boolean): DataPoint[] {
  if (isDate) {
    return points.sort((a, b) => a.name.localeCompare(b.name));
  }
  return points.sort((a, b) => b.value - a.value);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
