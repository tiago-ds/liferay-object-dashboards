# The Outfitter demo site

A complete, reproducible Liferay site for an invented outdoor-equipment hire
company, built to show Liferay best practice around the talk's widget — and to
give the Operations page a second, independent Object to point the dashboards
at.

Everything here is additive. The talk's own material — the `SALESORDER` and
`SUPPORTTICKET` Objects, the Object Dashboards site, the deck — is untouched by
these scripts, with one deliberate exception noted under *What changed outside
this folder*.

## Rebuilding it from nothing

```bash
# 1. The site: fragments, style books, master page, display page template,
#    collections, navigation, documents and six pages.
cd liferay-workspace && ./gradlew :client-extensions:outfitter-site:deploy

# 2. The Objects and their data. MUST run after step 1: Gear is site-scoped,
#    so the seeder needs the site to exist before it can write entries into it.
python3 outfitter/objects.py

# 3. Only if a chart points at a NEW Object: add its scope to
#    object-aggregator/client-extension.yaml, redeploy, and restart the
#    aggregator (see below).
```

Order matters in one direction only. If `objects.py` runs first it stops with
*"no site at /outfitter — deploy outfitter-site first, then re-run"* rather than
writing entries somewhere wrong.

The site initializer re-runs on every redeploy, so iterating is just
`./gradlew :client-extensions:outfitter-site:deploy`.

### Regenerating the authored parts

| Script | Writes |
|---|---|
| `outfitter/mkpages.py` | every `page-definition.json`, the master page, the display page template |
| `outfitter/mkstylebook.mjs` | both brands' `frontend-tokens-values.json` |
| `outfitter/mkpalette.mjs` | searches OKLCH space for a chart palette that passes the colour checks |
| `outfitter/objects.py` | creates, publishes and seeds the two Objects |

`mkpages.py` exists because page definitions are deep JSON where a Row needs
three viewport entries whether or not you care about tablets. Edit the builder,
not the generated files — a run overwrites them.

## What is in the site

**Pages** — `/home`, `/catalogue`, `/how-it-works`, `/depots`, `/operations`,
`/contact`, all on a master page with a header and footer and the site's
navigation menu.

**Objects** — `OutfitterGear` (48 catalogue rows, **site-scoped**) and
`OutfitterHire` (9,000 transaction rows, company-scoped), both in the
`OUTFITTER` object folder, separate from the talk's Objects in `Default`.

**Two brands** — `Alpine Ridge` and `Coastal Drift`, as style books on the
Dialect theme. Switching the site's default style book (Design → Style Books →
⋮ → Mark as Default) changes the brand colour, the buttons, the links **and
every chart**, because the widget reads `--color-chart-0..7` from the theme.
That is the whole demo: no rebuild, no widget change.

**Operations** — seven charts over the Hire Object, server-aggregated. Measured:
9,000 rows over 18 requests in about 3 s.

## Known gaps

- **The gear detail page 404s.** A display page template exists, is bound to the
  Gear Object and is marked `defaultTemplate`. `/web/outfitter/gear/356236`
  (by id) resolves and 302s to `/web/outfitter/gear/aurora-2p-tent`, and that
  URL then 404s — so the route is registered and the friendly-URL lookup is what
  fails. Re-saving an entry to regenerate its FriendlyURLEntry did not fix it.
  Nothing links to a detail page, so the site is coherent without it.
- **Chart titles read `OUTFITTERRENTAL`.** The widget titles a chart with the
  Object's external reference code. Fine on a developer dashboard, less so on a
  site page; it wants a `title` attribute in `declared.ts`.
- **A second brand is not wired to anything but the style book.** Switching
  brands does not swap the photographs or the wordmark, both of which are
  authored content rather than tokens.

## Things that fail silently

Every one of these cost real time, and none of them logs anything. If a page
comes out empty, start here.

| Symptom | Cause |
|---|---|
| A column renders empty | Fragment key wrong. The key is the fragment's **folder name**, and a fragment living in a site also needs `siteKey: "[$GROUP_KEY$]"`. |
| A fragment's drop zone renders `<div></div>` | Children must be wrapped in a `FragmentDropZone` element, not hung off the Fragment. |
| A collection says "No Results Found" | The `ASSET_LIST_ENTRY_ID` placeholder takes the collection's **key** upper-cased — the title lower-cased with spaces turned into dashes — not the title. An unresolved placeholder is left in the page as a literal string. |
| A card loses its image and caption | An element with `data-lfr-editable-type="link"` has its whole content replaced by the editable's text. Use a `div` and a `fragmentLink`. |
| Initialization aborts on a FreeMarker error | A config key a page definition does not set is null even though `configuration.json` declares a default. Write `(configuration.x)!default`. |
| A button says "Go Somewhere" | `BASIC_COMPONENT-button`'s editable is `link`, not `element-link`. |
| A page is "No Results Found" with no content at all | The whole page definition failed to import. Check the fragment keys first. |
| An Object's entries are invisible to a Collection or a Display Page Template | The Object is company-scoped. Those are site-level features; a company-scoped Object's entries live in the company group. |
| A page URL is rejected with `LayoutFriendlyURLException` | An Object's friendly URL separator reserves that path. `/gear` belongs to the Gear Object, so the catalogue page is `/catalogue`. |
| Every chart says "Headless read failed (403)" | The aggregator's OAuth2 application has no scope for that Object. Add `c_<objectname>.everything.read` — lowercase — and redeploy. |
| Every chart says "Invalid authorization" (401) | The aggregator is running with a stale OAuth2 client id. Deploying the aggregator mints a new one, and the value can still be in flux moments after the deploy finishes. Restart it (below) **after** the portal settles, and check the id it prints against `/o/oauth2/application?externalReferenceCode=object-aggregator-oaua`. |

## Restarting the aggregator

```bash
ss -lptnH 'sport = :3002'          # find the pid; never pkill -f on a pattern
kill <pid>                          #   that matches your own shell
cd liferay-workspace/client-extensions/object-aggregator
set -a && . ./local-env.sh && set +a && node dist/server.js
```

It prints the client id it resolved. If that does not match the portal's, the
charts will 401 — wait and run it again.

## What changed outside this folder

The talk's dark palette used to be a `globalCSS` client extension at
`scope: company`. That scope is the only one Liferay injects automatically, and
it injects into **every site on the company** — so the moment this site existed,
it was dark too. The palette is now a style book on the Object Dashboards site
(`object-dashboard-site/site-initializer/style-books/dashboards-dark`), which is
correctly scoped and a better demo besides: the site is restyled by the
platform's own theming rather than by CSS loaded over the top of it. The
extension is kept at `scope: layout` so it can still be picked per page under
Look and Feel.

Two smaller ones:

- `theme.ts` now prefers a theme's own `--color-chart-0..7` over inferring a
  palette from its hue families. Dialect publishes thirteen of them; Classic
  publishes none, so the talk's site is unaffected.
- The widget's Vite config now defines `process.env.NODE_ENV`. Without it the
  bundle shipped 23 live references to `process` and died on its first line in
  the browser. **The bundle size quoted in the talk changed: 613 kB raw,
  140 kB gzip, down from ~656 kB / ~151 kB**, because the dev-only branches are
  now eliminated. Re-measure before quoting it on stage.
