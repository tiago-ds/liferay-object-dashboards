#!/usr/bin/env python3
"""Create, publish and seed the outfitter demo Objects.

    python3 objects.py

Two Objects, deliberately — not four. The site needs one Object that reads as
catalogue content and one that reads as transactions for the dashboards; depot,
category and activity are fields rather than separate Objects, which keeps the
model honest without inventing joins that Liferay Objects are not for.

Kept in the OUTFITTER object folder, apart from SALESORDER and SUPPORTTICKET,
which the talk's climax demo and the deck screenshot depend on and which this
script never touches.

    BASE_URL  (default http://localhost:8080)
    LR_USER   (default test@liferay.com)
    LR_PASS   (default pw)
    GEAR      catalogue rows   (default 48)
    RENTALS   transaction rows (default 9000)
"""
import base64
import json
import os
import random
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
USER = os.environ.get("LR_USER", "test@liferay.com")
PASS = os.environ.get("LR_PASS", "pw")
GEAR = int(os.environ.get("GEAR", "48"))
RENTALS = int(os.environ.get("RENTALS", "9000"))
FOLDER = "OUTFITTER"
SITE = os.environ.get("SITE", "/outfitter")   # where site-scoped entries go
CHUNK = 2000

_AUTH = "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()
random.seed(11)  # deterministic, so re-runs and screenshots match


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Authorization", _AUTH)
    r.add_header("Accept", "application/json")
    if data is not None:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r) as x:
            raw = x.read().decode()
            return x.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:400]}


def text(name, label, required=False):
    return {"name": name, "label": {"en_US": label}, "businessType": "Text",
            "DBType": "String", "required": required}


def number(name, label, dbtype="BigDecimal", business="PrecisionDecimal"):
    return {"name": name, "label": {"en_US": label}, "businessType": business,
            "DBType": dbtype, "required": False}


def date(name, label):
    return {"name": name, "label": {"en_US": label}, "businessType": "Date",
            "DBType": "Date", "required": False}


# An Object's friendly URL is the value of its TITLE field, not its name:
# ObjectEntryLocalServiceImpl._getUrlTitle falls back to the ERC and then to the
# UUID when that field is empty. The default title field is externalReferenceCode,
# which batch import leaves blank, so every entry would get a UUID URL and the
# display page would read /c_outfittergear/9c1c007b-baae-…  Setting it here is
# what makes the catalogue URLs /gear/aurora-2p-tent.
EQUIPMENT = {
    "externalReferenceCode": "OUTFITTERGEAR",
    "label": {"en_US": "Gear"},
    "pluralLabel": {"en_US": "Gear"},
    "name": "OutfitterGear",
    # SITE scope, not company, and this is the difference between a catalogue
    # that works and one that is permanently empty. A Collection, a Display Page
    # Template and the asset framework all look inside a site; a company-scoped
    # Object's entries land in the company group, so a Collection on a site page
    # finds nothing and says "No Results Found" with no error anywhere.
    #
    # Hires stay company-scoped: nothing renders them as site content, the
    # dashboard widget reads them straight over REST, and that keeps the
    # operations charts working from any site.
    "scope": "site",
    "active": True,
    "titleObjectFieldName": "gearName",
    "friendlyURLSeparator": "gear",
    "panelCategoryKey": "control_panel.object",
    "objectFolderExternalReferenceCode": FOLDER,
    "objectFields": [
        text("gearName", "Name", True),
        text("sku", "SKU", True),
        text("category", "Category", True),
        text("activity", "Activity", True),
        text("depot", "Depot", True),
        text("gearCondition", "Condition", True),
        text("summary", "Summary"),
        text("imageUrl", "Image"),
        number("dailyRate", "Daily rate"),
        number("replacementValue", "Replacement value"),
        number("utilisationDays", "Days on hire", "Integer", "Integer"),
        number("downtimeDays", "Days out of service", "Integer", "Integer"),
        date("acquiredDate", "Acquired"),
    ],
}

RENTAL = {
    "externalReferenceCode": "OUTFITTERRENTAL",
    "label": {"en_US": "Hire"},
    "pluralLabel": {"en_US": "Hires"},
    "name": "OutfitterHire",
    "scope": "company",
    "active": True,
    "titleObjectFieldName": "reference",
    "panelCategoryKey": "control_panel.object",
    "objectFolderExternalReferenceCode": FOLDER,
    "objectFields": [
        text("reference", "Reference", True),
        text("sku", "SKU", True),
        text("category", "Category", True),
        text("activity", "Activity", True),
        text("depot", "Depot", True),
        text("hireStatus", "Status", True),
        text("channel", "Channel", True),
        number("revenue", "Revenue"),
        number("days", "Days", "Integer", "Integer"),
        number("partySize", "Party size", "Integer", "Integer"),
        date("startDate", "Start date"),
    ],
}


def site_group_id(friendly_url):
    """The group a site-scoped Object writes into. Its REST path is
    <restContextPath>/scopes/<groupId>, and without it entries are rejected."""
    st, b = call("GET", "/o/headless-admin-site/v1.0/sites?page=1&pageSize=100")
    if st != 200:
        raise SystemExit(f"  cannot list sites ({st}): {b}")
    for s in b.get("items", []):
        if s.get("friendlyUrlPath") == friendly_url:
            return s["id"]
    raise SystemExit(
        f"  no site at {friendly_url} — deploy outfitter-site first, then re-run")


def ensure(definition):
    erc = definition["externalReferenceCode"]
    st, existing = call(
        "GET", f"/o/object-admin/v1.0/object-definitions/by-external-reference-code/{erc}")
    if st == 200:
        print(f"  [{erc}] exists (id={existing.get('id')})")
        d = existing
    else:
        st, d = call("POST", "/o/object-admin/v1.0/object-definitions", definition)
        if st not in (200, 201):
            raise SystemExit(f"  [{erc}] create FAILED ({st}): {d}")
        print(f"  [{erc}] created (id={d['id']})")

    # Repair an Object made by an older run of this script: the title field is
    # what the friendly URL is built from, and it can only be fixed before the
    # entries are written.
    settings = {k: definition[k] for k in
                ("titleObjectFieldName", "friendlyURLSeparator", "panelCategoryKey")
                if k in definition and definition[k] != d.get(k)}
    if settings:
        st, _ = call("PATCH", f"/o/object-admin/v1.0/object-definitions/{d['id']}", settings)
        print(f"  [{erc}] settings {sorted(settings)} -> {st}")

    if (d.get("status") or {}).get("label") != "approved":
        st, _ = call("POST", f"/o/object-admin/v1.0/object-definitions/{d['id']}/publish")
        print(f"  [{erc}] publish -> {st}")

    st, fresh = call(
        "GET", f"/o/object-admin/v1.0/object-definitions/by-external-reference-code/{erc}")
    path = fresh["restContextPath"]
    if fresh.get("scope") == "site":
        path = f"{path}/scopes/{site_group_id(SITE)}"
    return path


def poll(task_id, label):
    for _ in range(600):
        st, b = call("GET", f"/o/headless-batch-engine/v1.0/import-task/{task_id}")
        state = b.get("executeStatus") if st == 200 else None
        if state == "COMPLETED":
            return True
        if state == "FAILED":
            print(f"    {label} FAILED: {b.get('errorMessage')}")
            return False
        time.sleep(1)
    print(f"    {label} timed out")
    return False


def seed(path, rows):
    st, b = call("GET", f"{path}?page=1&pageSize=1")
    if st == 200 and b.get("totalCount", 0) > 0:
        print(f"  {path} already holds {b['totalCount']} rows — skipping")
        return
    for start in range(0, len(rows), CHUNK):
        chunk = rows[start:start + CHUNK]
        st, b = call("POST", f"{path}/batch", chunk)
        if st in (405, 409):
            # A site-scoped Object has no batch endpoint under its scopes path,
            # and the unscoped one refuses the write. One POST per row is fine
            # here: the catalogue is dozens of rows, not thousands.
            print(f"    no batch endpoint at this scope — posting {len(rows)} rows singly")
            return seed_singly(path, rows)
        if st not in (200, 201, 202):
            print(f"    batch rejected ({st}): {b}")
            return
        if not poll(b.get("id"), f"batch {start // CHUNK + 1}"):
            return
        print(f"    {min(start + CHUNK, len(rows))}/{len(rows)}", flush=True)
    print(f"  seeded {len(rows)} rows into {path}")


def seed_singly(path, rows):
    written = 0
    for row in rows:
        st, b = call("POST", path, row)
        if st not in (200, 201):
            print(f"    row rejected ({st}): {str(b)[:160]}")
            return
        written += 1
    print(f"  seeded {written} rows into {path}")


# ---------------------------------------------------------------------------
# The catalogue. Real-sounding kit, balanced across dimensions so every chart
# has something to say — and no single category swamps a pie.
# ---------------------------------------------------------------------------
CATALOGUE = {
    "Shelter": [("Aurora 2P Tent", "Two-person alpine shell, 3.1 kg"),
                ("Ridgeline 4P Tent", "Four berths, storm-rated to 90 km/h"),
                ("Basecamp Tarp", "Fast shade for a staging area"),
                ("Bivy Shell", "Single-night emergency cover")],
    "Paddle": [("Fjord Sea Kayak", "Composite hull, 5.2 m, skeg-equipped"),
               ("Estuary Touring Kayak", "Stable double for calm water"),
               ("Packraft 120", "Rolls into a 28-litre pack"),
               ("Dry Deck Paddle", "Carbon shaft, 220 cm")],
    "Climb": [("Granite Rack", "Full trad set, cams 0.3 to 4"),
              ("Ice Axe Pair", "Technical picks, leashless"),
              ("Alpine Rope 60 m", "Dry-treated half rope"),
              ("Harness Kit", "Harness, belay device, four screwgates")],
    "Navigation": [("Satellite Messenger", "Two-way text, SOS, 100 h battery"),
                   ("Marine VHF", "Floating handheld, IPX7"),
                   ("Expedition GPS", "Topo maps preloaded"),
                   ("Compass & Chart Set", "Baseplate compass, laminated charts")],
    "Sleep": [("Down Bag -10", "850 fill, 1.1 kg"),
              ("Summer Quilt", "Three-season, packs to 2 litres"),
              ("Insulated Mat", "R-value 5.4"),
              ("Camp Stove Kit", "Stove, pot set, windscreen")],
    "Pack": [("Haul Pack 75", "Expedition load carrier"),
             ("Summit Pack 32", "Stripped-down day pack"),
             ("Dry Barrel 60", "Watertight, portage harness"),
             ("Gear Duffel 90", "Airline-legal haul bag")],
}
ACTIVITIES = ["Alpine", "Coastal", "Trail", "Expedition"]
DEPOTS = ["Fjordside", "Highland", "Lakehead", "Coast Road"]
CONDITIONS = ["New", "Good", "Good", "Good", "Worn"]
CHANNELS = ["Web", "Walk-in", "Partner", "Phone"]
STATUSES = ["Returned", "Returned", "Returned", "On hire", "Overdue", "Cancelled"]
MONTHS = [f"2026-{m:02d}" for m in range(1, 10)]


def a_date(months=MONTHS):
    return f"{random.choice(months)}-{random.randint(1, 28):02d}"


def weighted(pairs):
    v, w = zip(*pairs)
    return random.choices(v, weights=w, k=1)[0]


def gear_rows(n):
    flat = [(c, name, blurb) for c, items in CATALOGUE.items() for name, blurb in items]
    out = []
    for i in range(n):
        category, name, blurb = flat[i % len(flat)]
        rate = {"Shelter": 24, "Paddle": 46, "Climb": 32,
                "Navigation": 18, "Sleep": 14, "Pack": 12}[category]
        out.append({
            "gearName": name if i < len(flat) else f"{name} #{i // len(flat) + 1}",
            "sku": f"{category[:2].upper()}-{1000 + i}",
            "category": category,
            "activity": weighted([("Alpine", 3), ("Coastal", 3), ("Trail", 3), ("Expedition", 2)]),
            "depot": random.choice(DEPOTS),
            "gearCondition": random.choice(CONDITIONS),
            "summary": blurb,
            "imageUrl": "",
            "dailyRate": round(rate * random.uniform(0.85, 1.3), 2),
            "replacementValue": round(rate * random.uniform(22, 38), 2),
            "utilisationDays": random.randint(40, 260),
            "downtimeDays": random.randint(0, 26),
            "acquiredDate": a_date([f"202{y}-{m:02d}" for y in (3, 4, 5) for m in range(1, 13)]),
        })
    return out


def hire_rows(n, gear):
    out = []
    for i in range(n):
        g = random.choice(gear)
        days = weighted([(2, 5), (3, 5), (4, 4), (5, 3), (7, 3), (10, 2), (14, 1)])
        out.append({
            "reference": f"HIRE-{10000 + i}",
            "sku": g["sku"],
            "category": g["category"],
            "activity": g["activity"],
            "depot": g["depot"],
            "hireStatus": random.choice(STATUSES),
            "channel": weighted([("Web", 5), ("Walk-in", 3), ("Partner", 2), ("Phone", 2)]),
            "revenue": round(float(g["dailyRate"]) * days * random.uniform(0.9, 1.15), 2),
            "days": days,
            "partySize": weighted([(1, 2), (2, 5), (3, 3), (4, 3), (6, 1)]),
            "startDate": a_date(),
        })
    return out


if __name__ == "__main__":
    print(f"Target: {BASE} as {USER}")
    print(f"Volume: {GEAR} gear, {RENTALS} hires\n")
    print("Gear:")
    gear_path = ensure(EQUIPMENT)
    gear = gear_rows(GEAR)
    seed(gear_path, gear)
    print("Hires:")
    hire_path = ensure(RENTAL)
    seed(hire_path, hire_rows(RENTALS, gear))
    print("\nDone.")
