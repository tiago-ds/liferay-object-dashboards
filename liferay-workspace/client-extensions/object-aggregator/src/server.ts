import express from "express";

import { aggregate } from "./aggregate.js";
import { corsWithReady, liferayJWT } from "./auth.js";
import { readCache, writeCache } from "./cache.js";
import { isCountMeasure, requiredFields } from "./classify.js";
import { CACHE_TTL_MS } from "./constants.js";
import { fetchAllEntries } from "./headless.js";
import type { Aggregation, ChartConfig, DateBucket } from "./types.js";

const PORT = 3002;

const app = express();

app.use(express.json());
app.use(corsWithReady);
app.use(liferayJWT);

app.get("/ready", (_req, res) => {
  res.send({ groups: ["liveness", "readiness"], status: "UP" });
});

/**
 * Server-side aggregation for the dashboard widget.
 *
 * Takes the SAME ChartConfig the widget already has, reads the Object's
 * entries next to the database, runs the SAME pure group-by (src/aggregate.ts
 * is a byte-identical copy of the widget's — `npm run check:parity` enforces
 * it), and returns the SAME DataPoint[] the browser would have computed.
 *
 * Nothing about the chart changes. Only where the group-by ran — and, thanks
 * to the cache, how often it has to run at all.
 */
app.get("/aggregate", async (req, res) => {
  const startedAt = Date.now();

  try {
    const filter = typeof req.query.filter === "string" ? req.query.filter : undefined;
    const config = parseConfig(req.query);

    // Results are user-specific now that reads run as the caller, so the cache
    // MUST be partitioned by identity. With no identity we cannot prove two
    // callers may share a result, so we simply do not cache.
    const key = req.liferayUserId
      ? cacheKey(req.liferayUserId, config, filter)
      : null;

    const hit = key ? readCache(key) : null;
    if (hit) {
      res.send({
        items: hit.points,
        meta: { ...hit.cost, cacheAgeMs: hit.ageMs, cacheTtlMs: CACHE_TTL_MS, cached: true },
      });
      return;
    }

    const scan = await fetchAllEntries(config.restContextPath, req.liferayToken as string, {
      // Shared with the widget, so the two paths can never project differently.
      fields: requiredFields(config),
      filter,
    });
    const items = aggregate(scan.rows, config);

    const cost = {
      elapsedMs: Date.now() - startedAt,
      requests: scan.requests,
      rowsScanned: scan.rows.length,
      truncated: scan.truncated,
    };
    if (key) writeCache(key, items, cost);

    res.send({
      items,
      meta: { ...cost, cacheAgeMs: 0, cacheTtlMs: CACHE_TTL_MS, cached: false },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aggregation failed.";
    res.status(400).send({ message });
  }
});

/**
 * Two charts with the same config, viewed by the same user, share one scan.
 * The user id leads the key: since the scan runs with the caller's permissions,
 * two users can legitimately get different results for identical config.
 */
function cacheKey(userId: string, config: ChartConfig, filter?: string): string {
  return [
    userId,
    config.restContextPath,
    config.dimension,
    config.measure ?? "",
    config.aggregation,
    config.weightField ?? "",
    config.dateBucket ?? "",
    filter ?? "",
  ].join("|");
}

const AGGREGATIONS: Aggregation[] = ["count", "sum", "avg", "wavg"];
const DATE_BUCKETS: DateBucket[] = ["day", "month"];

/** Reads a ChartConfig off the query string, rejecting anything malformed. */
function parseConfig(query: Record<string, unknown>): ChartConfig {
  const str = (key: string): string | undefined =>
    typeof query[key] === "string" && query[key] ? (query[key] as string) : undefined;

  const restContextPath = str("restContextPath");
  const dimension = str("dimension");
  const aggregation = str("aggregation") as Aggregation | undefined;

  if (!restContextPath?.startsWith("/o/")) {
    throw new Error("restContextPath must be a Headless path such as /o/c/salesorders.");
  }
  if (!dimension) {
    throw new Error("dimension is required.");
  }
  if (!aggregation || !AGGREGATIONS.includes(aggregation)) {
    throw new Error(`aggregation must be one of ${AGGREGATIONS.join(", ")}.`);
  }

  const measure = str("measure") ?? null;
  if (aggregation !== "count" && isCountMeasure(measure)) {
    throw new Error(`aggregation "${aggregation}" needs a numeric measure.`);
  }

  const weightField = str("weightField") ?? null;
  if (aggregation === "wavg" && !weightField) {
    throw new Error('aggregation "wavg" needs a weightField to divide by.');
  }

  const dateBucket = str("dateBucket") as DateBucket | undefined;
  if (dateBucket && !DATE_BUCKETS.includes(dateBucket)) {
    throw new Error(`dateBucket must be one of ${DATE_BUCKETS.join(", ")}.`);
  }

  return {
    aggregation,
    // Not used server-side, but ChartConfig is the shared shape — keep it whole.
    chartType: "bar",
    dateBucket,
    dimension,
    measure,
    objectErc: str("objectErc") ?? "",
    restContextPath,
    strategy: "server",
    weightField,
  };
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Object Aggregator listening on ${PORT}`);
});

export default app;
