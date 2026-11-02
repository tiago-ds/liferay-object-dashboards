#!/usr/bin/env python3
"""Create + publish the demo Objects and seed well-distributed entries.

Skips creating a definition whose externalReferenceCode already exists, and
skips seeding an Object that already holds entries (unless FORCE=1).

    BASE_URL   (default http://localhost:8080)
    LR_USER    (default test@liferay.com)
    LR_PASS    (default pw)
    SO_COUNT   Sales Order rows     (default 48)
    TK_COUNT   Support Case rows    (default 56)
    MODE       batch (default) | single
    CHUNK      entries per batch request (default 2000)
    WORKERS    concurrent POSTs, MODE=single only (default 16)
    FORCE      1 = seed even if the Object already has entries

VOLUME MATTERS FOR THE TALK. The defaults are demo-sized and make a pretty
chart, but they make the server-side segment pointless: a footnote reading
"48 rows scanned over 1 request" proves nothing. For the aggregation demo seed
tens of thousands, so the footnote reads like a real scan:

    SO_COUNT=48000 TK_COUNT=8000 python3 seed.py

Seeding uses the Object entry BATCH endpoint by default:

    POST <restContextPath>/batch      body: a JSON array of entries

It returns 202 and creates an asynchronous import task, which this script polls
via /o/headless-batch-engine/v1.0/import-task/{id} until COMPLETED or FAILED.
Entries are sent in chunks of CHUNK so one request never carries 48k rows.

MODE=single falls back to one POST per entry across WORKERS threads. It is much
slower but uses only the plainest API, so it is the thing to try if a batch
import misbehaves on your instance.

QUICK (the constant below, or QUICK=1) seeds a tiny slice in a single request
per Object — seconds instead of minutes — for when you are iterating on setup
rather than preparing the demo.
"""
import base64
import concurrent.futures
import json
import os
import random
import threading
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
USER = os.environ.get("LR_USER", "test@liferay.com")
PASS = os.environ.get("LR_PASS", "pw")
SO_COUNT = int(os.environ.get("SO_COUNT", "48"))
TK_COUNT = int(os.environ.get("TK_COUNT", "56"))
MODE = os.environ.get("MODE", "batch")
CHUNK = int(os.environ.get("CHUNK", "2000"))
WORKERS = int(os.environ.get("WORKERS", "16"))
FORCE = os.environ.get("FORCE") == "1"

# ---------------------------------------------------------------------------
# Quick mode — flip this while iterating on setup.
#
# True  => ONE request per Object carrying QUICK_SIZE rows. Seconds.
# False => the full SO_COUNT / TK_COUNT, chunked. Minutes at demo volume.
#
# Defaults to False on purpose: a quick run that is mistaken for a full one
# would leave the talk's server-side segment with nothing to show, so this
# announces itself loudly instead of failing quietly. Override with QUICK=1.
# ---------------------------------------------------------------------------
QUICK = False
QUICK_SIZE = 200

if os.environ.get("QUICK") == "1":
    QUICK = True
HERE = os.path.dirname(os.path.abspath(__file__))

_AUTH = "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()
random.seed(42)  # deterministic data so re-runs / screenshots are reproducible


def call(method, path, body=None):
    url = path if path.startswith("http") else BASE_URL + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", _AUTH)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read().decode()
            return res.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:500]}


def find_definition(erc):
    status, body = call(
        "GET",
        f"/o/object-admin/v1.0/object-definitions/by-external-reference-code/{erc}",
    )
    return body if status == 200 else None


def ensure_definition(filename):
    with open(os.path.join(HERE, filename)) as f:
        payload = json.load(f)
    payload.pop("_comment", None)
    erc = payload["externalReferenceCode"]

    existing = find_definition(erc)
    if existing:
        print(f"  [{erc}] already exists (id={existing.get('id')}, "
              f"status={existing.get('status', {}).get('label')})")
        definition = existing
    else:
        status, definition = call(
            "POST", "/o/object-admin/v1.0/object-definitions", payload
        )
        if status not in (200, 201):
            raise SystemExit(f"  [{erc}] create FAILED ({status}): {definition}")
        print(f"  [{erc}] created (id={definition['id']})")

    # Publish if still a draft (idempotent — publishing a published def is a no-op error we ignore).
    state = (definition.get("status") or {}).get("label", "")
    if state != "approved":
        status, pub = call(
            "POST",
            f"/o/object-admin/v1.0/object-definitions/{definition['id']}/publish",
        )
        print(f"  [{erc}] publish -> {status}")

    # Re-fetch to get the live restContextPath after publish.
    fresh = find_definition(erc)
    rest = fresh.get("restContextPath")
    print(f"  [{erc}] restContextPath = {rest}")
    return rest


def _poll_import_task(task_id, label):
    """Wait for an import task to finish. Returns True when it completed.

    Note for Ctrl-C: interrupting only stops the POLLING. The import task was
    already accepted by Liferay and keeps running server-side, so entries may
    continue to appear after you interrupt. Re-check the count before deciding
    what state you are in.
    """
    for _ in range(600):  # ~10 minutes at 1s
        status, body = call(
            "GET", f"/o/headless-batch-engine/v1.0/import-task/{task_id}"
        )
        state = body.get("executeStatus") if status == 200 else None
        if state == "COMPLETED":
            return True
        if state == "FAILED":
            print(f"    {label} FAILED: {body.get('errorMessage')}")
            # The batch engine keeps a per-item report — far more useful than the
            # summary message when only some rows were rejected.
            _, report = call(
                "GET",
                f"/o/headless-batch-engine/v1.0/import-task/{task_id}"
                "/failed-items/report",
            )
            if report:
                print(f"    failed items: {str(report)[:400]}")
            return False
        time.sleep(1)
    print(f"    {label} timed out waiting for the import task.")
    return False


def _seed_batch(rest_path, entries):
    """POST chunks to <rest_path>/batch and wait for each import task."""
    total = len(entries)
    chunk_size = total if QUICK else CHUNK
    ok = 0
    for start in range(0, total, chunk_size):
        chunk = entries[start:start + chunk_size]
        label = f"batch {start // chunk_size + 1} ({len(chunk)} rows)"
        # The endpoint accepts a bare array or {"items": [...]} — either is fine.
        status, body = call("POST", f"{rest_path}/batch", chunk)
        if status not in (200, 201, 202):
            print(f"    {label} rejected ({status}): {body}")
            return ok
        task_id = body.get("id") or body.get("importTaskId")
        if task_id is None:
            print(f"    {label} accepted but returned no task id: {body}")
            return ok
        if _poll_import_task(task_id, label):
            ok += len(chunk)
            print(f"    {ok}/{total}", flush=True)
        else:
            return ok
    return ok


def _seed_single(rest_path, entries):
    """One POST per entry, across WORKERS threads. Slow but maximally plain.

    Ctrl-C must actually work here. The obvious `with pool: pool.map(...)`
    does NOT: map() queues every entry up front and the context manager exits
    via shutdown(wait=True), so an interrupt waits for all 48k queued POSTs to
    drain. Instead we submit explicitly, and on interrupt set a flag that makes
    queued tasks no-ops and cancel whatever has not started.
    """
    total = len(entries)
    counters = {"ok": 0, "fail": 0}
    first_error = []
    lock = threading.Lock()
    stop = threading.Event()

    def post(entry):
        if stop.is_set():
            return
        status, body = call("POST", rest_path, entry)
        with lock:
            if status in (200, 201):
                counters["ok"] += 1
            else:
                counters["fail"] += 1
                if not first_error:
                    first_error.append(f"({status}) {body}")
            done = counters["ok"] + counters["fail"]
            if done % 500 == 0 or done == total:
                print(f"    {done}/{total} ({counters['fail']} failed)", flush=True)

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS)
    try:
        futures = [pool.submit(post, e) for e in entries]
        for future in concurrent.futures.as_completed(futures):
            future.result()
        pool.shutdown(wait=True)
    except KeyboardInterrupt:
        stop.set()
        print(f"\n  interrupted — cancelling queued POSTs "
              f"(~{counters['ok']} already written).", flush=True)
        pool.shutdown(wait=False, cancel_futures=True)
        raise

    if first_error:
        print(f"  first failure was: {first_error[0]}")
    return counters["ok"]


def seed(rest_path, entries):
    # Quick mode: one request, a handful of rows.
    if QUICK:
        entries = entries[:QUICK_SIZE]

    # Idempotent: if the Object already holds entries, don't pile on duplicates.
    status, body = call("GET", f"{rest_path}?page=1&pageSize=1")
    existing = body.get("totalCount", 0) if status == 200 else 0
    if existing > 0 and not FORCE:
        print(f"  {rest_path} already has {existing} entries — skipping seed (FORCE=1 to add more).")
        return

    ok = _seed_single(rest_path, entries) if MODE == "single" else _seed_batch(rest_path, entries)
    print(f"  seeded {ok}/{len(entries)} entries into {rest_path}")


# ---------------------------------------------------------------------------
# Data generation — balanced distributions, realistic ranges, no wild outliers.
# ---------------------------------------------------------------------------
MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]


def a_date():
    return f"{random.choice(MONTHS)}-{random.randint(1, 28):02d}"


def weighted(pairs):
    vals, wts = zip(*pairs)
    return random.choices(vals, weights=wts, k=1)[0]


def sales_orders(n=SO_COUNT):
    cat_amount = {
        "Hardware": (8000, 24000),
        "Software": (3000, 14000),
        "Services": (5000, 19000),
        "Training": (1500, 6000),
    }
    out = []
    for i in range(n):
        category = weighted([("Hardware", 3), ("Software", 4), ("Services", 3), ("Training", 2)])
        lo, hi = cat_amount[category]
        out.append({
            "orderNumber": f"SO-{1000 + i}",
            "region": weighted([("North America", 5), ("EMEA", 4), ("APAC", 3), ("LATAM", 2)]),
            "productCategory": category,
            "channel": weighted([("Direct", 4), ("Partner", 3), ("Online", 3)]),
            "orderStatus": weighted([("Won", 6), ("Pending", 3), ("Lost", 2)]),
            "amount": round(random.uniform(lo, hi), 2),
            "quantity": random.randint(1, 40),
            "orderDate": a_date(),
        })
    return out


def support_tickets(n=TK_COUNT):
    res_hours = {
        "Low": (1, 8), "Medium": (2, 16), "High": (4, 28), "Critical": (8, 44),
    }
    out = []
    for i in range(n):
        priority = weighted([("Low", 4), ("Medium", 5), ("High", 3), ("Critical", 2)])
        lo, hi = res_hours[priority]
        out.append({
            "ticketNumber": f"TK-{2000 + i}",
            "priority": priority,
            "ticketStatus": weighted([("Open", 3), ("In Progress", 3), ("Resolved", 4), ("Closed", 4)]),
            "channel": weighted([("Email", 4), ("Chat", 3), ("Phone", 2), ("Portal", 3)]),
            "category": weighted([("Bug", 4), ("Question", 4), ("Feature Request", 2), ("Billing", 2)]),
            "resolutionHours": round(random.uniform(lo, hi), 1),
            "satisfactionScore": weighted([(1, 1), (2, 2), (3, 3), (4, 5), (5, 4)]),
            "createdDate": a_date(),
        })
    return out


def _report_partial_state():
    """After an interrupt, the counts are the only thing that matters."""
    print("\nInterrupted. Current state:")
    for path in ("/o/c/salesorders", "/o/c/supportcases"):
        status, body = call("GET", f"{path}?page=1&pageSize=1")
        n = body.get("totalCount", "?") if status == 200 else f"unreachable ({status})"
        print(f"  {path}: {n} entries")
    print(
        "\nA plain re-run will now SKIP seeding (the Objects are non-empty).\n"
        "  - to top up anyway:  FORCE=1 ...   (this appends, it does not replace)\n"
        "  - for a clean slate: delete the entries, or delete and recreate the\n"
        "    Object definitions, then re-run.\n"
        "  - to iterate fast:   QUICK=1 ...   (one request per Object)"
    )


if __name__ == "__main__":
    print(f"Target: {BASE_URL} as {USER}")
    if QUICK:
        print("=" * 66)
        print(f"  QUICK MODE — {QUICK_SIZE} rows per Object, one request each.")
        print("  NOT a demo seed. Set QUICK = False for real volume.")
        print("=" * 66)
    else:
        detail = f"{WORKERS} workers" if MODE == "single" else f"chunks of {CHUNK}"
        print(f"Volume: {SO_COUNT} sales orders, {TK_COUNT} support cases, mode={MODE}, {detail}")
    try:
        print("Sales Order:")
        so_path = ensure_definition("sales-order-object.json")
        seed(so_path, sales_orders())
        print("Support Ticket:")
        tk_path = ensure_definition("support-ticket-object.json")
        seed(tk_path, support_tickets())
        print("Done.")
    except KeyboardInterrupt:
        _report_partial_state()
        raise SystemExit(130)
