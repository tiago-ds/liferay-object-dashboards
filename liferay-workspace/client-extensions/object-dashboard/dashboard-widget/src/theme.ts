/**
 * Chart colours, taken from the page's theme rather than chosen by this widget.
 *
 * The talk claims these charts are theme-native. Until now that was only true of
 * the Clay controls — the chart itself carried a hardcoded hex palette, so
 * changing the theme restyled the selects and left the bars untouched. This
 * module is what makes the claim true: every colour is read from the Liferay
 * theme's CSS custom properties at mount, with a validated fallback for the
 * standalone harness and for themes that do not define them.
 */

/**
 * Categorical slots, in fixed order, drawn from the theme's HUE families.
 *
 * Status tokens (--success, --danger, --warning) are deliberately absent. They
 * mean "state", and spending them as "series 4" makes a neutral category read
 * as a failure. --primary leads so a single-series chart wears the brand colour.
 */
const COLOR_TOKENS = [
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
 * Used when a token is missing, and as the whole palette outside Liferay.
 *
 * Not hand-picked: this sequence is the output of the palette validator and
 * passes every check — lightness band, chroma floor, CVD separation,
 * normal-vision floor and 3:1 contrast — against BOTH a light and a dark chart
 * surface.
 *
 * The SLOT ORDER above was chosen the same way, and it is load-bearing: the
 * order decides which colours end up adjacent, and adjacency is what the CVD
 * checks measure. Liferay's own default theme fails two checks in the obvious
 * hue order (its orange and green are deutan-confusable at dE 4.8) and passes
 * cleanly in this one. Re-run the validator if you touch either; do not
 * eyeball it.
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

function token(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
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
  const seen = new Set<string>();

  const colors = COLOR_TOKENS.map((name, index) => {
    const value = token(style, name);
    // A theme that leaves two families on the same value would silently give
    // two series the same colour, so fall back rather than repeat.
    if (!value || seen.has(value.toLowerCase())) return FALLBACK_COLORS[index];
    seen.add(value.toLowerCase());
    return value;
  });

  return {
    colors,
    accent: colors[0],
    // The stock theme defines no --border-color; --gray-300 is the rule colour
    // the widget used to hardcode (#e7e7ed). Verified on a running portal.
    grid: token(style, "--border-color") || token(style, "--gray-300") || FALLBACK_RULE,
    axis: token(style, "--secondary") || token(style, "--body-color") || FALLBACK_MUTED,
  };
}

export const CHART_THEME_FALLBACK: ChartTheme = {
  colors: FALLBACK_COLORS,
  accent: FALLBACK_COLORS[0],
  grid: FALLBACK_RULE,
  axis: FALLBACK_INK,
};
