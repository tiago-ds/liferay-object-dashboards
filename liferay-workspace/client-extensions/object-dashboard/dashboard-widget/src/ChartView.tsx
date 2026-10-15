import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ClayAlert from "@clayui/alert";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { aggregate } from "./aggregate";
import { requiredFields } from "./classify";
import { fetchAggregate, fetchEntries } from "./liferay";
import type { AggregateMeta } from "./liferay";
import { CHART_THEME_FALLBACK, readChartTheme, type ChartTheme } from "./theme";
import type { ChartConfig, DataPoint } from "./types";

// Thousands separators + at most 2 decimals, so 71521.5 reads as "71,521.5".
const NUMBER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const fmt = (value: number | string): string =>
  typeof value === "number" ? NUMBER_FORMAT.format(value) : value;

// Below this share of the pie, a slice's label is dropped — tiny slices would
// otherwise stack their labels on top of each other (the skewed-data problem).
const PIE_LABEL_MIN_SHARE = 0.04;

interface Props {
  config: ChartConfig;
}

/**
 * Where the group-by ran, and what it saw. Both strategies report; the client
 * one especially, because it is the one that can silently chart 1% of an Object
 * and present the result as the answer.
 */
type ChartMeta =
  | { where: "client"; rowsRead: number; totalCount: number }
  | ({ where: "server" } & AggregateMeta);

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DataPoint[]; meta: ChartMeta };

/**
 * Produce the points for a config. The two branches are the talk's whole
 * argument: either we pull rows and group them here, or the microservice
 * groups them next to the database — and both return DataPoint[], so
 * everything below this function is identical.
 */
function loadPoints(
  config: ChartConfig
): Promise<{ items: DataPoint[]; meta: ChartMeta }> {
  if (config.strategy === "server") {
    return fetchAggregate(config).then(({ items, meta }) => ({
      items,
      meta: { where: "server" as const, ...(meta as AggregateMeta) },
    }));
  }

  // Ask for only the columns this chart needs — the SAME projection the
  // microservice uses, from the same shared function. Cheapest possible win: a
  // 20-field Object is read with 2.
  return fetchEntries(config.restContextPath, { fields: requiredFields(config) }).then(
    ({ rows, totalCount }) => ({
      items: aggregate(rows, config),
      meta: { where: "client" as const, rowsRead: rows.length, totalCount },
    })
  );
}

export function ChartView({ config }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Custom properties inherit, so the palette depends on where this widget
  // sits — which is the whole point. It can only be computed once the element
  // is in the document, and a theme change reloads the page, so once is enough.
  const frame = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ChartTheme>(CHART_THEME_FALLBACK);
  useLayoutEffect(() => {
    setTheme(readChartTheme(frame.current));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    loadPoints(config)
      .then(({ items, meta }) => {
        if (cancelled) return;
        setState({ status: "ready", data: items, meta });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load data.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  if (state.status === "loading") {
    return <div className="od-state" ref={frame}>Loading…</div>;
  }
  if (state.status === "error") {
    return (
      <ClayAlert displayType="danger" title="Error">
        {state.message}
      </ClayAlert>
    );
  }
  if (state.data.length === 0) {
    return <div className="od-state">No data to chart yet for this Object.</div>;
  }
  // A pie needs a positive total: every slice is a share of the sum, so an
  // all-zero series draws literally nothing. Say so instead of going blank.
  if (config.chartType === "pie" && state.data.every((p) => p.value === 0)) {
    return (
      <div className="od-state">
        Every group totals zero, so there are no slices to draw. Try a bar chart, or check that the
        measure has values.
      </div>
    );
  }

  return (
    <>
      <div className="od-chart" ref={frame}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(config.chartType, state.data, theme)}
        </ResponsiveContainer>
      </div>
      {(() => {
        const { tone, text } = describeCoverage(state.meta, config, state.data.length);
        return tone === "warn" ? (
          <ClayAlert displayType="warning" spritemap="" className="od-coverage">
            {text}
          </ClayAlert>
        ) : (
          <p className="od-meta">{text}</p>
        );
      })()}
    </>
  );
}

/**
 * Aggregations whose value is a RATIO, and therefore survives being computed
 * over a sample: an average of 1% of the rows lands within a few percent of the
 * average of all of them. "count" and "sum" are totals — over 1% of the rows
 * they come out at roughly 1% of the truth. The warning has to say which.
 */
const RATIO_AGGREGATIONS = ["avg", "wavg"];

/**
 * What this chart actually saw. Rendered for BOTH strategies, because the one
 * that can mislead you is the quiet one: the browser reads a single page
 * (Liferay clamps pageSize) and, left to itself, draws those rows as though
 * they were the whole Object.
 *
 * And the page it reads is not a random sample — no sort is sent, so the
 * endpoint returns rows in insertion order, i.e. the OLDEST ones. On real data,
 * where insertion order tracks time, a date-bucketed chart of page 1 shows the
 * early buckets and implies the recent ones are empty. That is the failure
 * nobody catches by looking, so the widget has to say it out loud.
 */
function describeCoverage(meta: ChartMeta, config: ChartConfig, pointCount: number) {
  const points = `${fmt(pointCount)} points`;

  if (meta.where === "server") {
    if (meta.cached) {
      const age = Math.round(meta.cacheAgeMs / 1000);
      const ttl = Math.round(meta.cacheTtlMs / 1000);
      return {
        tone: "quiet" as const,
        text: `Served from your cache — ${age}s old, refreshes every ${ttl}s. ${points}, no rows read.`,
      };
    }
    const scan =
      `Aggregated on the server as you — ${fmt(meta.rowsScanned)} rows over ` +
      `${fmt(meta.requests)} requests in ${fmt(meta.elapsedMs)} ms. ${points}.`;
    return {
      tone: meta.truncated ? ("warn" as const) : ("quiet" as const),
      text: meta.truncated
        ? `${scan} Row limit reached — this is a partial scan.`
        : scan,
    };
  }

  if (meta.rowsRead >= meta.totalCount) {
    return {
      tone: "quiet" as const,
      text: `Aggregated in your browser — all ${fmt(meta.totalCount)} rows. ${points}.`,
    };
  }

  // The chart is built on a prefix of the Object. Say so, and say what it costs.
  const share = meta.rowsRead / meta.totalCount;
  const pct = share < 0.01 ? "<1" : String(Math.round(share * 100));
  const ratio = RATIO_AGGREGATIONS.includes(config.aggregation);

  return {
    tone: "warn" as const,
    text:
      `Showing the first ${fmt(meta.rowsRead)} of ${fmt(meta.totalCount)} rows (${pct}%) — ` +
      `the browser can only read one page. ` +
      (ratio
        ? `An average over a sample stays close, but this is the oldest ${pct}% of the data, not a random sample. `
        : `These totals are therefore about ${pct}% of the real figures. `) +
      `Switch Aggregate to "On the server" for the whole Object.`,
  };
}

function renderChart(type: ChartConfig["chartType"], data: DataPoint[], theme: ChartTheme) {
  const axisTick = { fontSize: 12, fill: theme.axis };
  switch (type) {
    case "line":
      return (
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
          <XAxis dataKey="name" tick={axisTick} stroke={theme.grid} />
          <YAxis tick={axisTick} stroke={theme.grid} tickFormatter={fmt} width={64} />
          <Tooltip formatter={(v) => fmt(v as number)} />
          <Line type="monotone" dataKey="value" stroke={theme.accent} strokeWidth={2} dot={false} />
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
          <XAxis dataKey="name" tick={axisTick} stroke={theme.grid} />
          <YAxis tick={axisTick} stroke={theme.grid} tickFormatter={fmt} width={64} />
          <Tooltip formatter={(v) => fmt(v as number)} />
          <Area type="monotone" dataKey="value" stroke={theme.accent} fill={theme.accent} fillOpacity={0.2} />
        </AreaChart>
      );
    case "pie":
      return (
        <PieChart>
          <Tooltip formatter={(v) => fmt(v as number)} />
          <Legend />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            outerRadius="75%"
            minAngle={2}
            label={(props: PieLabelProps) => renderPieLabel(props, theme.axis)}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={theme.colors[i % theme.colors.length]} />
            ))}
          </Pie>
        </PieChart>
      );
    case "bar":
    default:
      return (
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
          <XAxis dataKey="name" tick={axisTick} stroke={theme.grid} />
          <YAxis tick={axisTick} stroke={theme.grid} tickFormatter={fmt} width={64} />
          <Tooltip formatter={(v) => fmt(v as number)} />
          <Bar dataKey="value" fill={theme.accent} radius={[4, 4, 0, 0]} />
        </BarChart>
      );
  }
}

interface PieLabelProps {
  name?: string;
  value?: number;
  percent?: number;
  x?: number;
  y?: number;
  textAnchor?: "start" | "middle" | "end" | "inherit";
}

/**
 * Label only slices big enough to read — suppressing tiny ones is what stops
 * their labels colliding on skewed data — and draw the text in the theme's ink,
 * never in the slice colour.
 *
 * Recharts tints pie labels with their slice fill by default. That reads as
 * decoration and it is wrong: colour is how a reader identifies a slice, so
 * spending it on the number too means the value and the swatch compete. Text
 * wears text colour; the slice beside it carries the identity.
 */
function renderPieLabel(props: PieLabelProps, fill: string) {
  const { name, value, percent, x, y, textAnchor } = props;
  if (percent === undefined || percent < PIE_LABEL_MIN_SHARE) return <g />;
  return (
    <text x={x} y={y} fill={fill} textAnchor={textAnchor} dominantBaseline="central" fontSize={12}>
      {`${name}: ${fmt(value ?? 0)}`}
    </text>
  );
}
