import { describe, expect, it } from "vitest";
import { readDeclaredConfig, readDeclaredTitle } from "./declared";

/** A stand-in for the element Liferay renders, with attributes as strings. */
function el(attrs: Record<string, string>): Element {
  return { getAttribute: (n: string) => (n in attrs ? attrs[n] : null) } as Element;
}

const base = {
  "object-erc": "SALESORDER",
  "rest-context-path": "/o/c/salesorders",
  dimension: "region",
  measure: "amount",
  aggregation: "sum",
};

describe("readDeclaredConfig", () => {
  it("builds a config from the attributes a page definition sets", () => {
    expect(readDeclaredConfig(el({ ...base, "chart-type": "bar", strategy: "server" }))).toEqual({
      objectErc: "SALESORDER",
      restContextPath: "/o/c/salesorders",
      dimension: "region",
      measure: "amount",
      aggregation: "sum",
      chartType: "bar",
      dateBucket: undefined,
      weightField: undefined,
      strategy: "server",
    });
  });

  it("returns null when the element declares nothing", () => {
    expect(readDeclaredConfig(el({}))).toBeNull();
  });

  it("refuses a partial declaration rather than guessing", () => {
    // No dimension: there is nothing to group by, so fall back to the panel.
    expect(readDeclaredConfig(el({ ...base, dimension: "" }))).toBeNull();
  });

  it("requires a measure unless the aggregation is count", () => {
    expect(readDeclaredConfig(el({ ...base, measure: "" }))).toBeNull();
    const counted = readDeclaredConfig(el({ ...base, measure: "", aggregation: "count" }));
    expect(counted?.measure).toBeNull();
  });

  it("requires a weight field for a weighted average", () => {
    expect(readDeclaredConfig(el({ ...base, aggregation: "wavg" }))).toBeNull();
    const weighted = readDeclaredConfig(
      el({ ...base, aggregation: "wavg", "weight-field": "quantity" })
    );
    expect(weighted?.weightField).toBe("quantity");
  });

  it("ignores values outside the allowed set instead of trusting them", () => {
    const c = readDeclaredConfig(
      el({ ...base, "chart-type": "donut", strategy: "magic", "date-bucket": "fortnight" })
    );
    expect(c?.chartType).toBe("bar");       // the default, not "donut"
    expect(c?.strategy).toBe("client");     // the default, not "magic"
    expect(c?.dateBucket).toBeUndefined();
  });
});

describe("readDeclaredTitle", () => {
  it("takes the heading a page author set", () => {
    expect(readDeclaredTitle(el({ "chart-title": "Revenue by depot" }))).toBe("Revenue by depot");
  });

  it("ignores a blank or whitespace-only heading", () => {
    expect(readDeclaredTitle(el({ "chart-title": "   " }))).toBeNull();
    expect(readDeclaredTitle(el({ "chart-title": "" }))).toBeNull();
  });

  it("is null when the page declared none, so the widget keeps its fallback", () => {
    expect(readDeclaredTitle(el({}))).toBeNull();
  });

  it("does not read the native title attribute", () => {
    // `title` would also render as a browser tooltip over the whole widget.
    expect(readDeclaredTitle(el({ title: "tooltip" }))).toBeNull();
  });
});
