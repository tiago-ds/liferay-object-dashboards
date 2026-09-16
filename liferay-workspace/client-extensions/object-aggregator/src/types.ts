// Coarse field kind used by the config UI to split fields into dimensions and
// measures. `businessType` keeps the raw Liferay type for finer decisions (e.g.
// Date vs DateTime bucketing).
export type FieldType = "text" | "number" | "date" | "boolean" | "picklist";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  businessType: string;
}

export interface ObjectTarget {
  externalReferenceCode: string;
  objectName: string;
  fields: FieldDef[];
  // Already the full Headless path, e.g. "/o/c/expenses". Null when the Object
  // exposes no REST endpoint (filtered out before reaching the UI).
  restContextPath: string;
}

export type ChartType = "bar" | "line" | "pie" | "area";

// WHERE the group-by runs. The chart is identical either way — this is the
// whole point of the talk's aggregation spectrum: the widget's contract is
// DataPoint[], so swapping the engine costs the rendering layer nothing.
//   "client" — fetch rows, aggregate in the browser (see aggregate.ts).
//   "server" — ask the object-aggregator microservice for the DataPoint[].
export type Strategy = "client" | "server";

// "wavg" is a weighted average: sum(measure) / sum(weightField).
//
// It exists because an average cannot be rolled up. Given a pre-aggregated
// table (a cube: one row per region x category x month, carrying amountSum and
// orderCount), plain "avg" would average the group averages — which is only
// correct when every group is the same size, and silently wrong otherwise.
// The correct roll-up is a ratio of two sums, which is what this is.
export type Aggregation = "count" | "sum" | "avg" | "wavg";
export type DateBucket = "day" | "month";

// One configured chart. Persisted per widget instance (localStorage in the
// demo). `measure` is null when aggregation === "count".
export interface ChartConfig {
  objectErc: string;
  restContextPath: string;
  dimension: string;
  measure: string | null;
  aggregation: Aggregation;
  chartType: ChartType;
  dateBucket?: DateBucket;
  // Denominator for aggregation === "wavg" (e.g. the cube's orderCount field).
  weightField?: string | null;
  // Absent on configs saved before the server strategy existed — treat as "client".
  strategy?: Strategy;
}

// Output row of the aggregation step — what the chart renders.
export interface DataPoint {
  name: string;
  value: number;
}
