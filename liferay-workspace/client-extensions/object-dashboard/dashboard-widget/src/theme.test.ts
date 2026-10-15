import { describe, expect, it } from "vitest";
import { resolveColors } from "./theme";

/** A stand-in for getComputedStyle: unlisted tokens read as "", like a real one. */
function reader(tokens: Record<string, string>) {
  return (name: string) => tokens[name] ?? "";
}

const chartTokens = (values: string[]) =>
  Object.fromEntries(values.map((v, i) => [`--color-chart-${i}`, v]));

const EIGHT = ["#111111", "#222222", "#333333", "#444444",
               "#555555", "#666666", "#777777", "#888888"];

const HUES = {
  "--primary": "#0b5fff",
  "--pink": "#e50082",
  "--green": "#458613",
  "--purple": "#a3f",
  "--orange": "#cc4e00",
  "--cyan": "#0077b3",
  "--red": "#e60000",
  "--indigo": "#4d5fff",
};

describe("resolveColors", () => {
  it("takes the theme's own chart palette when it declares one", () => {
    expect(resolveColors(reader(chartTokens(EIGHT)))).toEqual(EIGHT);
  });

  it("prefers the chart palette over the hue families", () => {
    // Dialect publishes both shapes of token in principle; the explicit chart
    // palette is the theme speaking about charts, so it wins.
    expect(resolveColors(reader({ ...HUES, ...chartTokens(EIGHT) }))).toEqual(EIGHT);
  });

  it("infers from the hue families when there is no chart palette", () => {
    expect(resolveColors(reader(HUES))).toEqual(Object.values(HUES));
  });

  it("falls through a chart palette that stops short rather than repeating", () => {
    // Three tokens and silence is the realistic failure: a theme author sets
    // the colours they had and leaves the rest. Five series must not come out
    // sharing one colour, so the whole rung is refused.
    const partial = chartTokens(EIGHT.slice(0, 3));
    expect(resolveColors(reader({ ...partial, ...HUES }))).toEqual(Object.values(HUES));
  });

  it("refuses a set where two slots carry the same colour", () => {
    const duplicated = chartTokens([...EIGHT.slice(0, 7), EIGHT[0]]);
    const colors = resolveColors(reader(duplicated));
    expect(colors).not.toEqual(Object.values(duplicated));
    expect(new Set(colors).size).toBe(8);
  });

  it("compares values case-insensitively when looking for duplicates", () => {
    const duplicated = chartTokens([...EIGHT.slice(0, 7), "#111111".toUpperCase()]);
    expect(new Set(resolveColors(reader(duplicated))).size).toBe(8);
  });

  it("ignores surrounding whitespace, which getPropertyValue keeps", () => {
    const padded = Object.fromEntries(
      EIGHT.map((v, i) => [`--color-chart-${i}`, ` ${v} `]));
    expect(resolveColors(reader(padded))).toEqual(EIGHT);
  });

  it("falls back to the validated palette with no theme at all", () => {
    const colors = resolveColors(reader({}));
    expect(colors).toHaveLength(8);
    expect(new Set(colors).size).toBe(8);
  });
});
