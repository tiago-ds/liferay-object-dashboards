# Point It at an Object, Get a Dashboard

A schema-driven data-visualization **Client Extension** for Liferay. Drop it on a page, point it at
any Object, pick a dimension + a measure + a chart type, and it renders a live chart from Headless
data — **no per-chart code**. Compose a dashboard by dropping several on a page; the page builder is
the layout.

DevCon Deep Dive (45 min). Talk material: [`TALK-OUTLINE.md`](TALK-OUTLINE.md) ·
[`CFP-submission.md`](CFP-submission.md) · open work: [`FOLLOW-UPS.md`](FOLLOW-UPS.md)

## What's in here

| Piece | Where | What it is |
|---|---|---|
| **object-dashboard** | `liferay-workspace/client-extensions/object-dashboard/` | The widget. `customElement` CX, React + Clay from the page's importmap, Recharts. Aggregates in the browser. |
| **object-aggregator** | `liferay-workspace/client-extensions/object-aggregator/` | Server-side aggregation. Node/Express CX. Same config in, same `DataPoint[]` out. |
| **demo Objects** | `demo-objects/` | Sales Order + Support Case definitions and a seeder. |

The two extensions share `types.ts`, `classify.ts` and `aggregate.ts` as **byte-identical files**,
enforced by `npm run check:parity`. That's the architectural claim: the group-by doesn't change,
only where it runs.

---

# Setup — clean bundle to composed dashboard

**Read this first:** the widget (step 3) deploys the ordinary way and gets you the whole client-side
demo. The aggregator (step 4) is a *service*, and a local bundle has nothing to run a service
container for you — that step is manual and is the one that will bite you.

Product: `dxp-2026.q2.0` (`liferay-workspace/gradle.properties`).
Prerequisites: JDK, Node 18+, Python 3 (stdlib only).

> **All paths below are relative to `ObjectDashboards/`**, which holds both the talk material and
> the workspace. The Client Extensions live *inside* `liferay-workspace/client-extensions/` — so
> treat that workspace as **not** throwaway, or move the extensions out before recreating it.

## 1. Start the portal

```bash
cd ObjectDashboards/liferay-workspace
blade gw initBundle          # downloads the bundle into bundles/
blade server run             # foreground, logs in the terminal
```

Docker instead: `blade gw createDockerContainer && blade gw startDockerContainer`.

Wait for `Server startup in ... ms`. Sign in at **http://localhost:8080** as
**`test@liferay.com` / `pw`**. The setup wizard is disabled
(`configs/common/portal-setup-wizard.properties`), so you land straight in.

`dxp-2026.q2.0` is a DXP bundle and wants an activation key — there is none in this workspace
(`bundles/` is not initialised yet). Drop yours in `bundles/deploy/` before or just after first
boot. Objects and Client Extensions both need a validly activated DXP.

> Credentials drift between installs — older notes here used `http://localhost:8082` with password
> `a`. This bundle is 8080 / `pw`. Whichever you have, keep it consistent: the seeder and the CX
> `.serviceAddress` both depend on it.

## 2. Create and seed the Objects

```bash
cd demo-objects
BASE_URL=http://localhost:8080 LR_USER=test@liferay.com LR_PASS=pw python3 seed.py
```

Creates and publishes **Sales Order** (`/o/c/salesorders`) and **Support Case**
(`/o/c/supportcases`), then fills them. Idempotent: existing definitions are reused, and an Object
that already has entries is skipped unless `FORCE=1`.

### Starting over

`reset.py` deletes every entry from both Objects and leaves the definitions published, so `seed.py`
can re-seed straight after (it only skips when an Object is non-empty).

```bash
cd demo-objects
BASE_URL=http://localhost:8080 LR_USER=test@liferay.com LR_PASS=pw python3 reset.py
```

It asks for confirmation and prints the counts first; `YES=1` skips the prompt. It pages through ids
with `fields=id`, then uses `DELETE <restContextPath>/batch` with `[{"id": N}, ...]` — the same
asynchronous import-task machinery as seeding, so it is a couple of dozen requests rather than one
per row.

**Do this after any interrupted seed.** A partial run leaves the Objects non-empty, which makes a
plain re-run skip seeding entirely and `FORCE=1` append duplicates on top of the partial data.

### While you're just getting the setup working

Flip `QUICK = True` at the top of `seed.py` (or pass `QUICK=1`). That sends **one request per
Object** with `QUICK_SIZE` rows — seconds instead of minutes — so you can iterate on steps 3–5
without waiting on a full seed each time. It prints a loud banner, because a quick run mistaken for
a real one would leave the server-side demo with nothing to show.

```bash
QUICK=1 BASE_URL=http://localhost:8080 LR_USER=test@liferay.com LR_PASS=pw python3 seed.py
```

### Seed real volume, or the server-side segment has nothing to show

Defaults are 48 and 56 rows — good charts, **useless climax**: the footnote would read "48 rows
scanned over 1 request". For the aggregation demo:

```bash
SO_COUNT=48000 TK_COUNT=8000 FORCE=1 \
BASE_URL=http://localhost:8080 LR_USER=test@liferay.com LR_PASS=pw python3 seed.py
```

Seeding uses the Object entry **batch endpoint** — `POST <restContextPath>/batch` with a JSON array
(it also accepts `{"items": [...]}`). That returns `202` and creates an **asynchronous import task**,
so the seeder polls `/o/headless-batch-engine/v1.0/import-task/{id}` until `executeStatus` is
`COMPLETED`, printing the `/failed-items/report` if one fails. Rows go in chunks of `CHUNK` (2,000),
so 48k rows is a couple of dozen requests, not 48,000.

If a batch import misbehaves on your instance, fall back to one POST per entry across `WORKERS`
threads — much slower, but it uses only the plainest API:

```bash
MODE=single WORKERS=16 SO_COUNT=48000 TK_COUNT=8000 FORCE=1 \
BASE_URL=http://localhost:8080 LR_USER=test@liferay.com LR_PASS=pw python3 seed.py
```

> Object **names** matter downstream: `SalesOrder` and `SupportCase` mean internal names
> `C_SalesOrder` / `C_SupportCase`, which is exactly what the aggregator's OAuth2 scopes name in
> step 4b. Rename an Object and you must update that yaml.

## 3. Deploy the widget

```bash
cd liferay-workspace/client-extensions/object-dashboard/dashboard-widget
npm install
npm run build                # tsc --noEmit && vite build -> dist/
cd ../../..
blade gw deploy
```

Check: in a page's edit mode, **Object Dashboard** appears under the Client Extensions widget
category. Drop it — it opens on its config panel. Sales Order → Region → Amount → Sum → Bar.

**The entire client-side half of the talk works at this point.** If you only want to rehearse up to
minute 23, stop here.

## 4. Deploy the aggregator

Two parts, two different install routes:

| Part | Installed by | Runs |
|---|---|---|
| OAuth2 application (`client-extension.yaml`) | `blade gw deploy` | inside Liferay |
| The Node service (`Dockerfile`, `LCP.json`) | **nothing, locally** | you start it yourself |

On Liferay PaaS/SaaS the platform builds the image, runs the container and mounts the LXC metadata.
A local bundle does none of that. `.serviceAddress: localhost:3002` is the local contract: Liferay
points the browser at port 3002, and putting something there is your job.

### 4a. Register the OAuth2 application

```bash
cd liferay-workspace && blade gw deploy
```

**Control Panel → Security → OAuth2 Administration.** Find the `object-aggregator-oaua`
application and note:

- its **external reference code** — if it isn't literally `object-aggregator-oaua`, update
  `OAUTH_USER_AGENT_ERC` in `object-aggregator/src/constants.ts`
- its **client id**

### 4b. Check the scopes cover your Objects

`client-extension.yaml` declares these statically:

```yaml
scopes:
    - c_salesorder.everything.read
    - c_supportcase.everything.read
```

**Lowercase, and that is not cosmetic.** The Object is stored as `C_SalesOrder`, but its entry API
registers under `ObjectDefinitionImpl.getOSGiJaxRsName()`, which is
`StringUtil.toLowerCase(getName())` → `c_salesorder`. A scope naming an application that does not
exist is **ignored in silence**: no log warning, no `OAUTH2SCOPEGRANT` row, and the first symptom is
a 403 at runtime. Verified here — the capitalised spelling produced zero grants; lowercase produced
two.

**Object entry scopes can't be wildcarded.** Charting a third Object *server-side* needs another
line here and a redeploy. The client-side strategy has no such limit — it rides your session.

### 4c. Run the service

```bash
cd liferay-workspace/client-extensions/object-aggregator
npm install
npm test        # build + parity check + planScan regression tests
```

Configuration normally arrives as LXC metadata that the platform mounts. Locally, source the helper —
it reads the client id live from Liferay, so nothing is copied by hand:

```bash
. ./local-env.sh     # source it, don't run it
npm start
curl -s localhost:3002/ready      # {"groups":["liveness","readiness"],"status":"UP"}
```

> ⚠️ **Re-source after EVERY `blade gw deploy`.** A redeploy does not update the existing OAuth2
> application — it creates a **new** one, with a new client id, and moves the scope grants to it.
> A stale id makes `auth.ts` reject every call with 401 "Invalid authorization", which looks like a
> token bug and is not. Observed twice on this install.

Wrong ERC fails at startup with a message **listing the ERCs Liferay actually injected** — paste the
right one into `constants.ts`.

> ✅ **Verified against a live portal (2026-09-16).** The service starts, `/ready` is UP, the auth
> middleware rejects missing and junk tokens with 401, `fields` is honoured, and the entry response
> carries `totalCount`, `pageSize` and `lastPage`.

## 5. Build the page

1. Create a Content Page, enter edit mode.
2. Drop **Object Dashboard**: Sales Order → Region → Amount → Sum → Bar → **Aggregate: In the
   browser**. Save.
3. Drop a second: Support Case → Priority → Resolution Hours → Average → Bar.
4. Publish and reload — both persist (`localStorage`, per widget instance).
5. Edit chart 1 → **Aggregate: On the server**. The chart must **not move**; a footnote appears.
   Reload: the footnote becomes `Served from your cache`.

## 6. Verification checklist

Every line here is something that has actually broken.

- [ ] `curl -u test@liferay.com:pw 'http://localhost:8080/o/c/salesorders?pageSize=1'` returns a
      `totalCount` matching what you seeded
- [ ] Widget appears in the editor and opens on the config panel
- [ ] Switching the Object repopulates the dimension/measure dropdowns *(the 11:00 reveal)*
- [ ] A bar chart renders with sensible values
- [ ] `curl localhost:3002/ready` → `UP`
- [x] Switching a chart to **On the server** renders **identical bars** *(verified 2026-09-16, at
      single-page volume)*
- [ ] The footnote's row and request counts match your seed (48,000 rows ⇒ ~96 requests at the
      default 500 page-size cap)
- [ ] Reloading shows `Served from your cache`
- [ ] Two widgets on one page both persist across a reload

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Widget missing from the editor | `npm run build` not run, or `dist/` empty — `blade gw deploy` ships `dashboard-widget/dist` |
| Dropdowns empty, "Could not list Objects" | Not signed in, or `/o/object-admin/v1.0/object-definitions` returned 403 |
| Chart says "No data" | Object published but unseeded — re-run `seed.py` |
| Seed reports `FAILED` with a per-item report | A field name or type mismatch; the report names the offending rows. `MODE=single` gives a per-entry error instead |
| Seed hangs on "batch N" | The import task never left `STARTED` — check the portal log; `MODE=single` sidesteps the batch engine entirely |
| `/ready` refuses connection | Service not running, or it died at startup — read the console; the ERC error is explicit |
| `TypeError` at startup | Should not happen any more; if it does, the LXC metadata env vars aren't set at all |
| Server-side chart 403s | That Object isn't in the aggregator's `scopes` (step 4b) |
| **Server bars differ from client bars** | **Stop.** This is the pagination bug class — the scan silently stopped early. `planScan()` has tests for it; check `totalCount` is present in the entry response |
| Footnote says 500 rows when you seeded 48,000 | Same cause: no `totalCount` in the response, so the scan stopped after page 1 |
| Footnote always says `cached` | Expected within the 60s TTL; the cache is per user |

## Development

```bash
# widget
cd liferay-workspace/client-extensions/object-dashboard/dashboard-widget
npm run dev            # standalone Vite harness with mock Objects, no portal needed
npm test               # 12 tests incl. the avg-vs-wavg trap

# aggregator
cd liferay-workspace/client-extensions/object-aggregator
npm run check:parity   # are the three shared files still identical to the widget's?
npm test               # build + parity + planScan regressions
```

**If you edit `aggregate.ts`, `classify.ts` or `types.ts`, copy them to the aggregator** — the build
fails otherwise, on purpose:

```bash
cd liferay-workspace/client-extensions
cp object-dashboard/dashboard-widget/src/{types,classify,aggregate}.ts object-aggregator/src/
```
