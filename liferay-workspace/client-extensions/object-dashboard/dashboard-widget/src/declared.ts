import type { Aggregation, ChartConfig, ChartType, DateBucket, Strategy } from "./types";

/**
 * A chart declared on the page rather than configured by hand.
 *
 * Liferay renders a custom element's portlet preferences as ATTRIBUTES on the
 * element, and a page definition can set those preferences:
 *
 *   page-definition.json   widgetConfig: {"properties": "dimension=region\n…"}
 *     -> portlet preferences
 *     -> BaseCETPortlet.getProperties()
 *     -> <object-dashboard dimension="region" …>
 *
 * That makes a dashboard fully declarative: a site initializer ships pages
 * whose charts already work, instead of eight empty widgets waiting for
 * someone to configure them. Every value arrives as a string, so everything
 * here is about turning strings into a ChartConfig and refusing the ones that
 * are not valid rather than rendering something wrong.
 */
const CHART_TYPES: ChartType[] = ["bar", "line", "pie", "area"];
const AGGREGATIONS: Aggregation[] = ["count", "sum", "avg", "wavg"];
const DATE_BUCKETS: DateBucket[] = ["day", "month"];
const STRATEGIES: Strategy[] = ["client", "server"];

function pick<T extends string>(raw: string | null, allowed: T[]): T | undefined {
  return raw && (allowed as string[]).includes(raw) ? (raw as T) : undefined;
}

export function readDeclaredConfig(el: Element): ChartConfig | null {
  const attr = (name: string) => el.getAttribute(name)?.trim() || null;

  const restContextPath = attr("rest-context-path");
  const dimension = attr("dimension");
  const aggregation = pick(attr("aggregation"), AGGREGATIONS);

  // Without these three there is nothing to draw; fall back to the config
  // panel rather than guessing.
  if (!restContextPath || !dimension || !aggregation) return null;

  const measure = attr("measure");
  if (aggregation !== "count" && !measure) return null;

  const weightField = attr("weight-field");
  if (aggregation === "wavg" && !weightField) return null;

  return {
    objectErc: attr("object-erc") ?? "",
    restContextPath,
    dimension,
    measure: aggregation === "count" ? null : measure,
    aggregation,
    chartType: pick(attr("chart-type"), CHART_TYPES) ?? "bar",
    dateBucket: pick(attr("date-bucket"), DATE_BUCKETS),
    weightField: aggregation === "wavg" ? weightField : undefined,
    strategy: pick(attr("strategy"), STRATEGIES) ?? "client",
  };
}
