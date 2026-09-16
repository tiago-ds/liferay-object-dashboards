import type { ChartConfig, FieldDef, ObjectTarget } from "./types.js";

// The synthetic measure every Object supports: count of records. Selecting it
// means aggregation === "count" and no numeric field is needed.
export const COUNT_MEASURE = "__count__";

/**
 * Fields you can group by. Numbers are excluded — grouping by a raw numeric
 * field (e.g. amount) yields one bucket per distinct value, which is rarely a
 * useful chart. Text, picklist, date and boolean fields make sensible buckets.
 */
export function dimensions(target: ObjectTarget): FieldDef[] {
  return target.fields.filter((f) => f.type !== "number");
}

/**
 * Numeric fields you can sum/average, plus the universal "Count of records".
 * Count is always first so an Object with no numeric field is still chartable.
 */
export function measures(target: ObjectTarget): FieldDef[] {
  const countField: FieldDef = {
    name: COUNT_MEASURE,
    label: "Count of records",
    type: "number",
    businessType: "Count",
  };
  return [countField, ...target.fields.filter((f) => f.type === "number")];
}

export function isCountMeasure(measure: string | null): boolean {
  return measure === null || measure === COUNT_MEASURE;
}

export function isDateField(target: ObjectTarget, fieldName: string): boolean {
  return target.fields.some((f) => f.name === fieldName && f.type === "date");
}

/**
 * The columns a chart actually needs — so both aggregation paths can ask
 * Headless for exactly those and nothing else.
 *
 * This lives here, beside the group-by it feeds, because the two paths MUST
 * project identically. They once did not: the browser asked for the dimension
 * and the measure but forgot the weight field, so every weighted average came
 * out 0 (sum/0 -> 0) while the server, which did request it, produced real
 * numbers. Same config, two different charts — and a pie of zeroes just
 * renders blank, so it looked like "no data" rather than a bug.
 *
 * Being a parity file, check:parity now makes that divergence impossible.
 */
export function requiredFields(config: ChartConfig): string[] {
  const fields = [config.dimension];
  if (!isCountMeasure(config.measure)) fields.push(config.measure as string);
  if (config.weightField) fields.push(config.weightField);
  // A field could legitimately be named twice (measure === weightField).
  return [...new Set(fields)];
}
