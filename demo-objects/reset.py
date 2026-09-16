#!/usr/bin/env python3
"""Delete every entry from the demo Objects, leaving the definitions in place.

    BASE_URL  (default http://localhost:8080)
    LR_USER   (default test@liferay.com)
    LR_PASS   (default pw)
    YES=1     skip the confirmation prompt
    ERCS      comma-separated Objects to wipe (default: both)

Usage:  python3 reset.py

Uses the Object entry batch endpoint:

    DELETE <restContextPath>/batch    body: [{"id": 123}, {"id": 124}, ...]

which returns 202 and creates an asynchronous import task, polled here until
COMPLETED. Verified against a live 2026.q2 portal.

The Object DEFINITIONS are left alone, so seed.py can re-seed straight after —
it only skips seeding when an Object is non-empty, and after this it is empty.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
USER = os.environ.get("LR_USER", "test@liferay.com")
PASS = os.environ.get("LR_PASS", "pw")
ASSUME_YES = os.environ.get("YES") == "1"

# Ids are listed this many at a time (Liferay clamps pageSize at 500 by default)
# and deleted this many at a time.
PAGE_SIZE = 500
DELETE_CHUNK = 500

# Targeting one Object matters: the demo wants Sales Order large (to show the
# client-side ceiling) and Support Case small (to show client/server parity), so
# they get reseeded independently.
ERCS = [e.strip() for e in os.environ.get("ERCS", "SALESORDER,SUPPORTTICKET").split(",") if e.strip()]

_AUTH = "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()


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
        return e.code, {"error": e.read().decode()[:400]}


def rest_path(erc):
    status, body = call(
        "GET", f"/o/object-admin/v1.0/object-definitions/by-external-reference-code/{erc}"
    )
    if status != 200:
        return None
    return body.get("restContextPath")


def count(path):
    status, body = call("GET", f"{path}?page=1&pageSize=1")
    return body.get("totalCount", 0) if status == 200 else 0


def all_ids(path):
    """Page through ids only — `fields=id` keeps the payload tiny."""
    ids = []
    page = 1
    while True:
        status, body = call("GET", f"{path}?page={page}&pageSize={PAGE_SIZE}&fields=id")
        if status != 200:
            print(f"  listing failed ({status}): {body}")
            break
        items = body.get("items", [])
        ids.extend(i["id"] for i in items if "id" in i)
        # Trust the response's own page size, never our request (Liferay clamps).
        effective = body.get("pageSize") or len(items)
        total = body.get("totalCount", len(ids))
        if not items or len(ids) >= total or effective <= 0:
            break
        page += 1
    return ids


def poll(task_id):
    for _ in range(600):
        status, body = call("GET", f"/o/headless-batch-engine/v1.0/import-task/{task_id}")
        state = body.get("executeStatus") if status == 200 else None
        if state == "COMPLETED":
            return True
        if state == "FAILED":
            print(f"    task FAILED: {body.get('errorMessage')}")
            return False
        time.sleep(1)
    print("    task timed out.")
    return False


def wipe(path):
    ids = all_ids(path)
    if not ids:
        print(f"  {path} is already empty.")
        return
    print(f"  deleting {len(ids)} entries from {path}")
    for start in range(0, len(ids), DELETE_CHUNK):
        chunk = ids[start:start + DELETE_CHUNK]
        status, body = call("DELETE", f"{path}/batch", [{"id": i} for i in chunk])
        if status not in (200, 201, 202):
            print(f"    delete batch rejected ({status}): {body}")
            return
        if not poll(body.get("id")):
            return
        print(f"    {min(start + DELETE_CHUNK, len(ids))}/{len(ids)}", flush=True)


if __name__ == "__main__":
    print(f"Target: {BASE_URL} as {USER}")

    targets = []
    for erc in ERCS:
        path = rest_path(erc)
        if not path:
            print(f"  [{erc}] not found — skipping.")
            continue
        targets.append((erc, path, count(path)))

    if not targets:
        raise SystemExit("Nothing to do.")

    print("\nWill DELETE ALL ENTRIES from:")
    for erc, path, n in targets:
        print(f"  {erc:<14} {path:<22} {n} entries")
    print("Object definitions are kept, so seed.py can re-seed immediately.")

    if not ASSUME_YES:
        if input("\nType 'yes' to continue: ").strip().lower() != "yes":
            raise SystemExit("Aborted.")

    for erc, path, _ in targets:
        print(f"\n{erc}:")
        wipe(path)

    print("\nFinal counts:")
    for erc, path, _ in targets:
        print(f"  {path}: {count(path)}")
