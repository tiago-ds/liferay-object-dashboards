# Demo Objects for the Object Dashboard CX

Two dashboard-friendly Liferay Objects (clean low-cardinality dimensions, a date
dimension, well-distributed numeric measures — no skew/outliers) plus a seeder
that creates, publishes, and fills them via the object-admin REST API.

| Object | ERC | REST path | Dimensions | Measures |
|--------|-----|-----------|------------|----------|
| **Sales Order** | `SALESORDER` | `/o/c/salesorders` | region, productCategory, channel, status, orderDate | amount, quantity, *Count* |
| **Support Case** | `SUPPORTTICKET` | `/o/c/supportcases` | priority, status, channel, category, createdDate | resolutionHours, satisfactionScore, *Count* |

> Named **Support Case** (not "Support Ticket") on purpose: a weaker `SupportTicket`
> Object already exists in this instance from the *Talk to Your Forms* demo, and
> `name` must be unique. The label shown in the widget is "Support Case".
>
> `status` is a reserved Object field name in Liferay, so the field is `orderStatus`
> / `ticketStatus` with the display label "Status".

## Recreate / reseed

```bash
cd ObjectDashboards/demo-objects
BASE_URL=http://localhost:8082 LR_USER=test@liferay.com LR_PASS=a python3 seed.py
```

The seeder is **idempotent**: it skips creating a definition whose ERC already
exists and skips seeding an Object that already has entries (`FORCE=1` overrides).
Data is generated with a fixed random seed, so re-runs on a fresh instance are
identical.

**Volume.** Defaults are 48 / 56 rows — fine for chart shape, useless for the
server-side aggregation demo. Use `SO_COUNT=48000 TK_COUNT=8000 FORCE=1`.

**How entries are written.** By default via the Object entry batch endpoint,
`POST <restContextPath>/batch` with a JSON array (it also accepts
`{"items": [...]}`). That returns `202` and creates an asynchronous import task,
which the seeder polls at `/o/headless-batch-engine/v1.0/import-task/{id}` until
`executeStatus` is `COMPLETED`; on `FAILED` it prints the per-item
`/failed-items/report`. Rows are chunked (`CHUNK`, default 2000) so no single
request carries the whole dataset. `MODE=single` falls back to one POST per entry
across `WORKERS` threads.

> Connection defaults are `http://localhost:8082`, `test@liferay.com` / `a` from
> an older local setup. A clean bundle is `http://localhost:8080` with password
> `test` — pass `BASE_URL` / `LR_PASS` explicitly.

## Good demo charts these produce

- **Sum of `amount` by `region`** (bar) — clean descending, no dominating slice.
- **Count by `orderDate` (month)** (line) — a real time-series across H1 2026.
- **Count of records by `productCategory`** (pie) — balanced slices.
- **Avg `resolutionHours` by `priority`** (bar) — monotonic Low → Critical, a
  genuine pattern to point at on stage.
- **Count by `ticketStatus`** (pie) — Open / In Progress / Resolved / Closed.
