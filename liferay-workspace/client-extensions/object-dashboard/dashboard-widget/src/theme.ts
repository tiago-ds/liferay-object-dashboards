/**
 * Chart colours, taken from the page's theme rather than chosen by this widget.
 *
 * The talk claims these charts are theme-native. Until now that was only true of
 * the Clay controls — the chart itself carried a hardcoded hex palette, so
 * changing the theme restyled the selects and left the bars untouched. This
 * module is what makes the claim true: every colour is read from the Liferay
 * theme's CSS custom properties at mount, with a validated fallback for the
 * standalone harness and for themes that do not define them.
 *
 * There are three rungs, tried in order, because themes differ in how much they
 * are willing to say about charts:
 *
 *   1. --color-chart-0..7   the theme publishes an explicit categorical chart
 *                           palette. Dialect does, as thirteen frontend tokens.
 *                           Nothing to infer: this is the theme's own answer.
 *   2. the hue families     --primary, --pink, --green … Classic publishes these
 *                           and no chart palette, so the palette is inferred
 *                           from the theme's colour system.
 *   3. FALLBACK_COLORS      no theme at all (the standalone harness).
 *
 * A rung is only taken when EVERY slot on it resolves to a distinct value, so a
 * theme that defines three chart tokens and stops does not produce a chart with
 * five invisible series.
 */

/**
 * Rung 1. A theme that declares these has told us exactly what it wants, and the
 * widget does not second-guess it — including when the values are poor. Dialect's
 * stock thirteen fail the lightness band and leave five series under 3:1 against
 * the page, which is a reason to set them in a style book, not a reason for this
 * module to override the theme's stated intent.
 */
const CHART_TOKENS = [
  "--color-chart-0",
  "--color-chart-1",
  "--color-chart-2",
  "--color-chart-3",
  "--color-chart-4",
  "--color-chart-5",
  "--color-chart-6",
  "--color-chart-7",
];

/**
 * Rung 2. Categorical slots drawn from the theme's HUE families.
 *
 * Status tokens (--success, --danger, --warning) are deliberately absent. They
 * mean "state", and spending them as "series 4" makes a neutral category read
 * as a failure. --primary leads so a single-series chart wears the brand colour.
 *
 * The ORDER is load-bearing: it decides which colours end up adjacent, and
 * adjacency is what the CVD checks measure. Liferay's Classic theme fails two
 * checks in the obvious hue order (its orange and green are deutan-confusable at
 * ΔE 4.8) and passes cleanly in this one. Re-run the validator if you touch it;
 * do not eyeball it.
 */
const HUE_TOKENS = [
  "--primary",
  "--pink",
  "--green",
  "--purple",
  "--orange",
  "--cyan",
  "--red",
  "--indigo",
];

/**
 * Rung 3. Used outside Liferay, and when neither token set is complete.
 *
 * Not hand-picked: this sequence is the output of the palette validator and
 * passes every check — lightness band, chroma floor, CVD separation,
 * normal-vision floor and 3:1 contrast — against BOTH a light and a dark chart
 * surface.
 */
const FALLBACK_COLORS = [
  "#3b82f6",
  "#db2777",
  "#15803d",
  "#9333ea",
  "#c2410c",
  "#0d9488",
  "#dc2626",
  "#4f46e5",
];

const FALLBACK_INK = "#10131a";
const FALLBACK_MUTED = "#6b6c7e";
const FALLBACK_RULE = "#e7e7ed";

export interface ChartTheme {
  /** Categorical series colours, in fixed order. Never cycled. */
  colors: string[];
  /** Single-series colour: bars, lines, areas. */
  accent: string;
  /** Grid lines and axis rules — recessive by design. */
  grid: string;
  /** Axis tick labels. */
  axis: string;
}

/** Reads one custom property. Separated so the slot logic can be tested. */
export type TokenReader = (name: string) => string;

/**
 * Every slot of `names`, or null if the set is incomplete.
 *
 * "Incomplete" covers both an unset token and two slots sharing a value: a theme
 * that leaves two families on the same colour would silently give two series the
 * same paint, which is worse than falling through to a palette that is merely
 * not this theme's.
 */
function completeSet(read: TokenReader, names: string[]): string[] | null {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const name of names) {
    const value = read(name).trim();
    if (!value) return null;
    const key = value.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    values.push(value);
  }

  return values;
}

/** The three rungs, in order. Exported for the tests. */
export function resolveColors(read: TokenReader): string[] {
  return (
    completeSet(read, CHART_TOKENS) ??
    completeSet(read, HUE_TOKENS) ??
    FALLBACK_COLORS
  );
}

/**
 * Reads the theme off an element already in the document — custom properties
 * inherit, so the value depends on where the widget sits, which is the point.
 * Call this after mount; before that there is nothing to compute a style from.
 */
export function readChartTheme(element: Element | null): ChartTheme {
  if (!element || typeof window === "undefined") {
    return {
      colors: FALLBACK_COLORS,
      accent: FALLBACK_COLORS[0],
      grid: FALLBACK_RULE,
      axis: FALLBACK_MUTED,
    };
  }

  const style = window.getComputedStyle(element);
  const read: TokenReader = (name) => style.getPropertyValue(name);
  const colors = resolveColors(read);

  return {
    colors,
    accent: colors[0],
    // Neither stock theme defines --border-color; --gray-300 is the rule colour
    // the widget used to hardcode (#e7e7ed). Verified on a running portal.
    grid:
      read("--border-color").trim() ||
      read("--color-neutral-3").trim() ||
      read("--gray-300").trim() ||
      FALLBACK_RULE,
    axis:
      read("--secondary").trim() ||
      read("--color-neutral-6").trim() ||
      read("--body-color").trim() ||
      FALLBACK_MUTED,
  };
}

export const CHART_THEME_FALLBACK: ChartTheme = {
  colors: FALLBACK_COLORS,
  accent: FALLBACK_COLORS[0],
  grid: FALLBACK_RULE,
  axis: FALLBACK_INK,
};
