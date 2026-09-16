// The three "weighted average over a pre-aggregated cube" tests at the bottom
// are the originals. Everything above them is REWRITTEN: the original nine
// tests were lost and are reconstructed from aggregate.ts's actual behaviour.
import { describe, expect, it } from "vitest";
import { aggregate } from "./aggregate";
import { requiredFields } from "./classify";
import type { ChartConfig } from "./types";

const base = {
  objectErc: "SALESORDER",
  restContextPath: "/o/c/salesorders",
  chartType: "bar",
} satisfies Pick<ChartConfig, "objectErc" | "restContextPath" | "chartType">;

const ROWS = [
  { region: "NA", amount: 100, orderDate: "2026-01-15" },
  { region: "NA", amount: 144, orderDate: "2026-01-20" },
  { region: "EMEA", amount: 90, orderDate: "2026-02-03" },
  { region: "LATAM", amount: 76, orderDate: "2026-02-11" },
];

describe("count", () => {
  it("counts records per group and sorts descending", () => {
    expect(
      aggregate(ROWS, { ...base, dimension: "region", measure: null, aggregation: "count" })
    ).toEqual([
      { name: "NA", value: 2 },
      { name: "EMEA", value: 1 },
      { name: "LATAM", value: 1 },
    ]);
  });

  it("counts rows even where the measure is missing", () => {
    const rows = [{ region: "NA" }, { region: "NA", amount: 5 }];
    expect(
      aggregate(rows, { ...base, dimension: "region", measure: null, aggregation: "count" })
    ).toEqual([{ name: "NA", value: 2 }]);
  });
});

describe("sum and avg", () => {
  it("sums the measure per group", () => {
    expect(
      aggregate(ROWS, { ...base, dimension: "region", measure: "amount", aggregation: "sum" })
    ).toEqual([
      { name: "NA", value: 244 },
      { name: "EMEA", value: 90 },
      { name: "LATAM", value: 76 },
    ]);
  });

  it("averages over numeric values only, not over all rows", () => {
    const rows = [
      { region: "NA", amount: 100 },
      { region: "NA", amount: 200 },
      { region: "NA" }, // no amount — must not drag the average to 100
    ];
    expect(
      aggregate(rows, { ...base, dimension: "region", measure: "amount", aggregation: "avg" })
    ).toEqual([{ name: "NA", value: 150 }]);
  });

  it("parses numeric strings, as Liferay returns BigDecimal fields", () => {
    const rows = [{ region: "NA", amount: "10.5" }, { region: "NA", amount: "4.5" }];
    expect(
      aggregate(rows, { ...base, dimension: "region", measure: "amount", aggregation: "sum" })
    ).toEqual([{ name: "NA", value: 15 }]);
  });

  it("yields 0 rather than NaN for a group with no numeric values", () => {
    expect(
      aggregate([{ region: "NA" }], {
        ...base,
        dimension: "region",
        measure: "amount",
        aggregation: "avg",
      })
    ).toEqual([{ name: "NA", value: 0 }]);
  });
});

describe("dimension bucketing", () => {
  it("buckets dates by month and sorts chronologically, not by value", () => {
    expect(
      aggregate(ROWS, {
        ...base,
        dimension: "orderDate",
        measure: null,
        aggregation: "count",
        dateBucket: "month",
      })
    ).toEqual([
      { name: "2026-01", value: 2 },
      { name: "2026-02", value: 2 },
    ]);
  });

  it("buckets by day without timezone drift (slices the ISO string)", () => {
    const rows = [{ d: "2026-06-20T23:30:00Z" }, { d: "2026-06-20" }];
    expect(
      aggregate(rows, {
        ...base,
        dimension: "d",
        measure: null,
        aggregation: "count",
        dateBucket: "day",
      })
    ).toEqual([{ name: "2026-06-20", value: 2 }]);
  });

  it("groups null, undefined and empty-string into one labelled bucket", () => {
    const rows = [{ region: null }, { region: undefined }, { region: "" }, { region: "NA" }];
    expect(
      aggregate(rows, { ...base, dimension: "region", measure: null, aggregation: "count" })
    ).toEqual([
      { name: "(none)", value: 3 },
      { name: "NA", value: 1 },
    ]);
  });

  it("renders booleans as stable labels", () => {
    const rows = [{ paid: true }, { paid: true }, { paid: false }];
    expect(
      aggregate(rows, { ...base, dimension: "paid", measure: null, aggregation: "count" })
    ).toEqual([
      { name: "true", value: 2 },
      { name: "false", value: 1 },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(
      aggregate([], { ...base, dimension: "region", measure: null, aggregation: "count" })
    ).toEqual([]);
  });
});

describe("weighted average over a pre-aggregated cube", () => {
  // A cube row is already a group: 400 NA/Hardware orders totalling 80,000, and
  // 100 NA/Services orders totalling 5,000. The true average order value for NA
  // is 85,000 / 500 = 170 — NOT the average of 200 and 50, which is 125.
  const cube = [
    { region: "NA", category: "Hardware", amountSum: 80_000, orderCount: 400 },
    { region: "NA", category: "Services", amountSum: 5_000, orderCount: 100 },
    { region: "EMEA", category: "Hardware", amountSum: 9_000, orderCount: 30 },
  ];

  it("rolls up correctly as a ratio of sums", () => {
    const points = aggregate(cube, {
      objectErc: "cube",
      restContextPath: "/o/c/salescube",
      dimension: "region",
      measure: "amountSum",
      weightField: "orderCount",
      aggregation: "wavg",
      chartType: "bar",
    });

    expect(points).toEqual([
      { name: "EMEA", value: 300 },
      { name: "NA", value: 170 },
    ]);
  });

  it("plain avg over the same cube is wrong — this is the trap", () => {
    const points = aggregate(cube, {
      objectErc: "cube",
      restContextPath: "/o/c/salescube",
      dimension: "region",
      measure: "amountSum",
      aggregation: "avg",
      chartType: "bar",
    });

    // Averages the two group TOTALS (80,000 and 5,000) rather than weighting by
    // how many orders each represents. Not 170, and not meaningful.
    const na = points.find((p) => p.name === "NA");
    expect(na?.value).toBe(42_500);
    expect(na?.value).not.toBe(170);
  });

  it("returns 0 rather than NaN when the weight column is empty", () => {
    const points = aggregate([{ region: "NA", amountSum: 10, orderCount: 0 }], {
      objectErc: "cube",
      restContextPath: "/o/c/salescube",
      dimension: "region",
      measure: "amountSum",
      weightField: "orderCount",
      aggregation: "wavg",
      chartType: "bar",
    });

    expect(points).toEqual([{ name: "NA", value: 0 }]);
  });
});

describe("requiredFields — the projection both paths share", () => {
  // Regression: the browser used to request the dimension and measure but NOT
  // the weight field, so sum(weight) was 0 and every weighted average came out
  // 0. On a pie that renders blank, which reads as "no data" rather than a bug
  // — and the server, which did request it, returned different numbers for the
  // same config. Both paths now call this one function.
  it("includes the weight field for a weighted average", () => {
    expect(
      requiredFields({
        ...base,
        dimension: "priority",
        measure: "resolutionHours",
        weightField: "satisfactionScore",
        aggregation: "wavg",
      })
    ).toEqual(["priority", "resolutionHours", "satisfactionScore"]);
  });

  it("asks only for the dimension when counting records", () => {
    expect(
      requiredFields({ ...base, dimension: "priority", measure: null, aggregation: "count" })
    ).toEqual(["priority"]);
  });

  it("asks for dimension and measure for a plain sum", () => {
    expect(
      requiredFields({ ...base, dimension: "region", measure: "amount", aggregation: "sum" })
    ).toEqual(["region", "amount"]);
  });

  it("does not repeat a field used as both measure and weight", () => {
    expect(
      requiredFields({
        ...base,
        dimension: "region",
        measure: "amount",
        weightField: "amount",
        aggregation: "wavg",
      })
    ).toEqual(["region", "amount"]);
  });
});
