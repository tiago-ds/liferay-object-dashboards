# Object Aggregator — server-side aggregation Client Extension

Rung 3 of the talk's aggregation spectrum: **portable aggregation with an amortized scan.**

```
client-side  →  filter-then-aggregate  →  THIS (server-side scan + cache)  →  precomputed cube Object
     ▲                                                                                  │
     └──────────── the cube is small, so it is read client-side again ──────────────────┘
```

Note what it is *not*: this is not "the scale answer". It scans. The scale answer is rung 4 — a
**cube** Object (the cross-product of the dimensions you care about, with count + sum) kept current
on write by an Object Action. Because aggregates compose, a cube freezes only the *grain*, not the
question — and because a cube is just another Object, the widget reads it with the client-side
strategy and rolls it up with `aggregate()` unchanged. The spectrum is a loop, not a ladder.

This service earns its place *before* that point: it keeps aggregation **ad-hoc over the raw
Object** at sizes the browser cannot take — which is what you need while you are still working out
which dimensions matter, i.e. before you know what grain to precompute.

## What it does

`GET /aggregate` takes the **same `ChartConfig`** the widget already has, reads the Object's
entries server-side, runs the **same pure group-by**, and returns the **same `DataPoint[]`**.

```
GET /aggregate
  ?restContextPath=/o/c/salesorders
  &dimension=region
  &measure=amount
  &aggregation=sum
  [&weightField=orderCount]   # required when aggregation=wavg
  [&dateBucket=month]
  [&filter=<OData>]

→ { "items": [ { "name": "North America", "value": 244000 }, ... ],
    "meta":  { "rowsScanned": 48000, "requests": 96, "elapsedMs": 780,
               "truncated": false, "cached": false, "cacheAgeMs": 0, "cacheTtlMs": 60000 } }
```

## The claim, enforced by the build

`src/types.ts`, `src/classify.ts` and `src/aggregate.ts` are **byte-identical copies** of the
widget's. `npm run check:parity` fails the build if they drift; it runs as `prebuild`.

**The group-by does not change. Only where it runs.** The client ships the rows to the function;
the server ships the function to the rows.

## The scan is expensive, and the cache is why that is OK

Liferay clamps `pageSize` against `HeadlessAPICompanyConfiguration.pageSizeLimit` — **default 500** —
in `PaginationProviderImpl`:

```java
Pagination.of(requestPage, Math.min(requestPageSize, pageSizeLimit))
```

Asking for more gets you the limit. Asking for `0`/`-1` ("unlimited") also gets you the limit.
So a 48,000-row Object is **96 HTTP requests**, and `MAX_ROWS` (100,000) is 200.

Two things make that defensible, and neither is optional:

1. **The result is cached** (`cache.ts`, 60s TTL), keyed by config **and user**.
2. **Pages are fetched concurrently** (`PAGE_CONCURRENCY = 8`).

`meta.requests` is returned and rendered so the price is never hidden.

> **Regression to never reintroduce.** The first version stopped paging as soon as a page came back
> smaller than the size it had *asked for*. With the clamp, every page looked short, so every scan
> silently stopped at 500 rows and reported `truncated: false`. The server chart and the client
> chart of the same data would then disagree — on stage, at the climax. `planScan()` is a pure
> function with tests (`headless.test.ts`) precisely because of this.

## Permissions: this service holds no credential of its own

`auth.ts` verifies the caller's JWT, then keeps the bearer token and **forwards it verbatim** to
Liferay. Every read runs as the calling user, so Liferay applies their permissions.

There is deliberately **no `client_credentials` application**. Reading as the service would let any
signed-in user chart rows they are not allowed to see. An unused privileged credential is itself a
liability, so it is not declared at all.

Two consequences, both real:

1. **The cache is partitioned by user**, because two users can legitimately get different results
   from identical config. Cross-team cache sharing is lost — the correct trade. No usable identity
   claim in the JWT ⇒ the request is **not cached**, rather than risking a cross-user leak.
2. **Scopes are per Object, static, and lowercase.** A custom Object is stored as `C_<Name>`, but
   its entry API registers under `ObjectDefinitionImpl.getOSGiJaxRsName()` =
   `StringUtil.toLowerCase(getName())` → **`c_salesorder`**. A scope naming a non-existent
   application is ignored in silence — no warning, no grant row, just a 403 later. Verified against
   a live portal: capitalised produced zero `OAUTH2SCOPEGRANT` rows, lowercase produced two
   (`'c_salesorder','com.liferay.object.rest.impl','GET','c_salesorder.everything.read'`).
   `client-extension.yaml` must name every chartable Object at build time.
   **This is the sharpest limit on the server strategy** — the client-side strategy rides the user's
   session and works on *any* Object, including ones created after deploy. It is also another
   argument for rung 4: a cube is one Object you built, so one scope line covers it forever.

## One OAuth2 application

| Application | Direction | Purpose |
|---|---|---|
| `object-aggregator-oaua` | browser → service | the token the widget mints via `FromUserAgentApplication()`, forwarded on to Liferay |

**Verify on first deploy:** the ERC in `src/constants.ts` assumes Liferay uses the CX entry key as
the ERC. `lxcConfig.oauthApplication()` returns `undefined` for an unknown ERC rather than throwing,
so `auth.ts` checks explicitly and fails at startup with a message listing the ERCs Liferay actually
injected — that error tells you the right value to paste.

## Local development

Outside a container, `. ./local-env.sh` builds the environment by reading the client id live from
Liferay. **Re-source it after every `blade gw deploy`** — a redeploy mints a new OAuth2 application
and client id.

```bash
npm install
npm run check:parity   # are the shared files still identical to the widget's?
npm test               # build + parity + planScan regressions
npm start              # needs the LXC metadata; see README step 4c
```

`src/aggregate.ts` is pure and has no Liferay dependency, so it runs standalone:

```bash
node --input-type=module -e "
import { aggregate } from './dist/aggregate.js';
console.log(aggregate([{region:'NA',amount:100},{region:'NA',amount:144}],
  {dimension:'region',measure:'amount',aggregation:'sum'}));"
```

## Talk notes

- The demo switch is **Aggregate: In the browser / On the server** in the widget's config panel.
  Flip it on a chart already on screen — the chart does not move, the footnote appears.
- Reload once and the footnote changes to `Served from your cache — 8s old`. That second beat is
  what earns the design; do not skip it.
- If the container misbehaves, `npm test` + `npm run check:parity` + the standalone `node` snippet
  make the whole argument on a bare terminal.
