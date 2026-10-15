import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Builds the widget as ONE ES module for Liferay's customElement CX loader.
 *
 * The externals are the whole point of the talk's bundle beat: React, ReactDOM
 * and Clay are already on every Liferay page via its importmap, so shipping our
 * own copies would be pure waste. Externalising them means the bundle contains
 * essentially only Recharts + d3 — which is the number quoted on stage.
 * Do not "fix" a bare-import warning by bundling these back in.
 *
 * REWRITTEN after the original was lost. Verified: react, react-dom/client and
 * @clayui/* really are external in the output. NOT reproduced: the original
 * build was 448 kB / 121 kB gzip and this one is ~656 kB / 150 kB, all of the
 * difference being Recharts and its d3 vendor code. Pinning recharts to the
 * original 2.12.7 and aggressive treeshaking each moved it by <5 kB, so the
 * original config did something else. Re-measure before quoting a number.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "object-dashboard.js",
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        /^@clayui\//,
        // Liferay's OAuth2 client, used by the server-aggregation strategy.
        "@liferay/oauth2-provider-web/client",
      ],
    },
    // A custom element has no separate stylesheet to load — styles.css is
    // imported by main.tsx and inlined into the bundle.
    cssCodeSplit: false,
  },
  // Recharts and its d3 vendor code read process.env.NODE_ENV. Vite's library
  // mode does not substitute it, so the bundle reaches the browser with 23 live
  // references to `process` and the widget dies on its first line with
  // "ReferenceError: process is not defined" — every chart on the page stays an
  // empty custom element. Nothing in the page's importmap provides a shim.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
