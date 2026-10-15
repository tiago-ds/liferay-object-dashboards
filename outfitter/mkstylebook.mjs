/**
 * Writes the two brands' style books.
 *
 *   node outfitter/mkstylebook.mjs
 *
 * A brand is declared here as three things — a primary, a secondary and a
 * validated chart palette — and every one of the ~40 tokens Dialect needs is
 * derived from them in OKLCH. Hand-picking a dozen darken/lighten steps per
 * brand is how ramps end up with a muddy step five and a hue that drifts.
 *
 * The chart palettes are NOT derived: they come from mkpalette.mjs, which
 * searches for sets that pass the colour-vision and contrast checks. Re-run
 * that, not your eye, if you change a brand.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "liferay-workspace", "client-extensions",
                 "outfitter-site", "site-initializer", "style-books");

const s2lin = c => c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
const lin2s = c => { c = Math.max(0,Math.min(1,c)); return c <= 0.0031308 ? 12.92*c : 1.055*c**(1/2.4) - 0.055; };

function toOklch(hex) {
  const [r,g,b] = [0,2,4].map(i => s2lin(parseInt(hex.slice(1+i,3+i),16)/255));
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  const L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s;
  const A = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s;
  const B = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s;
  return [L, Math.hypot(A,B), (Math.atan2(B,A)*180/Math.PI + 360) % 360];
}

function toHex(L, C, hDeg) {
  const h = hDeg*Math.PI/180, a = C*Math.cos(h), b = C*Math.sin(h);
  const l = (L+0.3963377774*a+0.2158037573*b)**3;
  const m = (L-0.1055613458*a-0.0638541728*b)**3;
  const s = (L-0.0894841775*a-1.2914855480*b)**3;
  const rgb = [ 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
               -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
               -0.0041960863*l - 0.7034186147*m + 1.7076147010*s].map(lin2s);
  return "#" + rgb.map(v => Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,"0")).join("");
}

/** Keeps a step inside sRGB by giving up chroma, never lightness. */
function inGamut(L, C, h) {
  for (let c = C; c > 0.004; c -= 0.004) {
    const hex = toHex(L, c, h);
    const back = toOklch(hex);
    if (Math.abs(back[0] - L) < 0.012) return hex;    // lightness survived the clip
  }
  return toHex(L, 0, h);
}

/**
 * Dialect's ramp is base + 5 darker + 6 lighter. Chroma tapers toward both ends
 * so the darkest step does not read as a saturated bruise and the lightest stays
 * a tint rather than a wash of grey.
 */
function ramp(hex) {
  const [L, C, h] = toOklch(hex);
  const darker  = [0.82, 0.64, 0.46, 0.28, 0.10];
  const lighter = [1.16, 1.32, 1.48, 1.63, 1.78, 1.92];
  const clampL = v => Math.max(0.04, Math.min(0.99, v));
  return {
    base: hex,
    darken: darker.map((f, i) => inGamut(clampL(L*f), C*(1 - 0.10*i), h)),
    lighten: lighter.map((f, i) => inGamut(clampL(L*f), C*(1 - 0.13*i), h)),
  };
}

const token = (cssVariableMapping, value) => ({ cssVariableMapping, value });

function tokensFor(brand) {
  const p = ramp(brand.primary), s = ramp(brand.secondary);
  const t = {};

  t.colorBrandPrimary = token("color-brand-primary", p.base);
  p.darken.forEach((v,i) => t[`colorBrandPrimaryDarken${i+1}`] = token(`color-brand-primary-darken-${i+1}`, v));
  p.lighten.forEach((v,i) => t[`colorBrandPrimaryLighten${i+1}`] = token(`color-brand-primary-lighten-${i+1}`, v));

  t.colorBrandSecondary = token("color-brand-secondary", s.base);
  s.darken.forEach((v,i) => t[`colorBrandSecondaryDarken${i+1}`] = token(`color-brand-secondary-darken-${i+1}`, v));
  s.lighten.forEach((v,i) => t[`colorBrandSecondaryLighten${i+1}`] = token(`color-brand-secondary-lighten-${i+1}`, v));

  // Buttons and links read the action tokens, not the brand ramp, so a brand
  // that sets only the ramp ships Dialect's stock purple buttons.
  t.colorActionPrimaryDefault = token("color-action-primary-default", p.base);
  t.colorActionPrimaryHover = token("color-action-primary-hover", p.darken[0]);
  t.colorActionPrimaryActive = token("color-action-primary-active", p.darken[1]);
  t.colorActionPrimaryDisabled = token("color-action-primary-disabled", p.lighten[2]);
  t.colorActionPrimaryHoverLighten = token("color-action-primary-hover-lighten", p.lighten[5]);
  t.colorActionPrimaryActiveLighten = token("color-action-primary-active-lighten", p.lighten[4]);

  t.colorActionSecondaryDefault = token("color-action-secondary-default", s.base);
  t.colorActionSecondaryHover = token("color-action-secondary-hover", s.darken[0]);
  t.colorActionSecondaryActive = token("color-action-secondary-active", s.darken[1]);
  t.colorActionSecondaryDisabled = token("color-action-secondary-disabled", s.lighten[2]);
  t.colorActionSecondaryHoverLighten = token("color-action-secondary-hover-lighten", s.lighten[5]);
  t.colorActionSecondaryActiveLighten = token("color-action-secondary-active-lighten", s.lighten[4]);

  t.linkVisitedColor = token("link-visited-color", p.darken[1]);

  // The whole point of the two-brand demo: the charts are not told what to use,
  // they read these. See theme.ts.
  brand.chart.forEach((v,i) => t[`colorChart${i}`] = token(`color-chart-${i}`, v));

  t.fontFamilyBase = token("font-family-base", brand.bodyFont);
  t.fontFamilySansSerif = token("font-family-sans-serif", brand.bodyFont);

  return t;
}

const BRANDS = [
  {
    key: "alpine-ridge",
    name: "Alpine Ridge",
    primary: "#2460b7",     // glacier blue
    secondary: "#c28914",   // last light on rock
    chart: ["#2460b7","#c28914","#8b291d","#758fe8","#bc5365","#796a00","#008e9b","#6a377a"],
    bodyFont: "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    default: true,
  },
  {
    key: "coastal-drift",
    name: "Coastal Drift",
    primary: "#0079a0",     // deep water
    secondary: "#c48800",   // wet sand at low sun
    chart: ["#0079a0","#c48800","#902300","#4f3a9e","#9283ee","#00a786","#b34378","#7c6900"],
    bodyFont: "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    default: false,
  },
];

for (const brand of BRANDS) {
  const dir = join(OUT, brand.key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "style-book.json"), JSON.stringify({
    defaultStyleBookEntry: brand.default,
    frontendTokensValuesPath: "frontend-tokens-values.json",
    name: brand.name,
    themeId: "dialect_WAR_dialecttheme",
  }, null, "\t") + "\n");
  const tokens = tokensFor(brand);
  writeFileSync(join(dir, "frontend-tokens-values.json"),
                JSON.stringify(tokens, null, "\t") + "\n");
  console.log(`${brand.name}: ${Object.keys(tokens).length} tokens -> ${brand.key}/`);
  console.log(`  primary ramp  ${ramp(brand.primary).darken.slice(0,3).join(" ")} | ${brand.primary} | ${ramp(brand.primary).lighten.slice(0,3).join(" ")}`);
}
