# Runbook — bringing the demo environment up

It takes the machine from cold to a state where every demo page renders and
every chart has data. Everything below is relative to the repo root.

---

## 0. What "working" means

Five things, and the verification block in step 4 checks all of them.

| | |
|---|---|
| Portal | `http://localhost:8080`, signed in as `test@liferay.com` / `pw` |
| Aggregator | listening on 3002, holding a client id the portal agrees with |
| Sales Order | 48,048 rows · Support Case 400 |
| Outfitter Gear | 48 rows (site-scoped) · Outfitter Hire 9,000 |
| Pages | `/web/object-dashboards/analytics` and `/build`, plus the six Outfitter pages |

Site ids, which several REST calls need: **Outfitter 354702**, **Object
Dashboards 317661**.

---

## 1. Check you have the memory for it

```bash
free -h | sed -n 2p
```

Tomcat reserves a 2.5 GiB heap, so **start with at least 6 GiB available**.
Under memory pressure, long-running background processes like the aggregator
are the first to be killed. If the number is low, close something before
starting rather than debugging a process that vanishes an hour later.

---

## 2. Start the portal

```bash
liferay-workspace/bundles/tomcat/bin/startup.sh
```

It returns immediately and the portal takes one to three minutes. Wait for it
properly rather than sleeping a fixed amount:

```bash
until curl -s -o /dev/null -m 3 http://localhost:8080/web/object-dashboards/analytics; do sleep 5; done
echo "portal up"
```

**That loop returns early.** The page answers `200` about 20 seconds after
startup, while modules and themes are still deploying. Don't wait for Tomcat's
`Server startup in` line either: it goes to `catalina.out`, so `liferay.*.log`
never shows it and a loop grepping for it never ends. The real signal that the
portal is ready is the step 4 verification passing.

The log is `liferay-workspace/bundles/logs/liferay.YYYY-MM-DD.log`, **dated in
UTC**: on a local evening it carries tomorrow's date, so `$(date +%F)` finds
nothing. Use `ls -t liferay-workspace/bundles/logs | head -1`.
`catalina.out` is empty — do not look there.

> **Never `pkill -f` with a pattern that also matches your own shell command.**
> It kills the shell running it and the call comes back as exit 144. To stop
> something, find the pid by port: `ss -lptnH 'sport = :3002'`.

---

## 3. Start the aggregator

```bash
cd liferay-workspace/client-extensions/object-aggregator
set -a && . ./local-env.sh && set +a && node dist/server.js
```

Run it in the background; it stays in the foreground otherwise. It prints the
OAuth2 client id it resolved, and `local-env.sh` reads that live from the portal
rather than from a file, so there is nothing to copy by hand.

**Check the two ids match**, because this is the single most common failure:

```bash
curl -s -u test@liferay.com:pw \
  "http://localhost:8080/o/oauth2/application?externalReferenceCode=object-aggregator-oaua" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['client_id'])"
```

If it differs from what the aggregator printed, every chart on the server
strategy answers **401 "Invalid authorization"** — which looks like a token bug
and is not. Deploying the aggregator mints a new id, and the value is still in
flux for a few seconds after the deploy reports success, so restart the
aggregator *after* the portal settles, not immediately.

---

## 4. Verify, before trusting anything

```bash
for p in /web/object-dashboards/analytics /web/object-dashboards/build \
         /web/outfitter/home /web/outfitter/catalogue /web/outfitter/how-it-works \
         /web/outfitter/depots /web/outfitter/operations /web/outfitter/contact \
         /web/outfitter/gear/aurora-2p-tent; do
  printf "%-44s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8080$p"
done

count() {   # prints the row count, or says plainly that nothing answered
  curl -s -u test@liferay.com:pw "http://localhost:8080$1" \
    | python3 -c "import sys,json
try: print(json.load(sys.stdin)['totalCount'])
except Exception: print('no answer — is the portal up?')"
}
for o in salesorders supportcases outfitterhires; do
  printf "%-16s " "$o"; count "/o/c/$o?pageSize=1"
done
printf "%-16s " outfittergears
count "/o/c/outfittergears/scopes/354702?pageSize=1"

curl -s -o /dev/null -w "aggregator: %{http_code}\n" http://localhost:3002/ready
```

Want: nine `200`s, then **48048 · 400 · 9000 · 48**, then `200`.

**Gear is site-scoped**, which is why it alone needs `/scopes/354702`. Asking
for `/o/c/outfittergears` without a scope returns **409 "Conflict with
getObjectEntriesPage"** — not an empty list, not a 403.

---

## 5. Resetting the demo

None of this needs the environment rebuilt.

**The pages.** Adding or moving widgets changes the pages, and the site
initializer re-imports them over whatever is there:

```bash
cd liferay-workspace && ./gradlew :client-extensions:object-dashboard-site:deploy --rerun-tasks
```

Wait for `Initialized Object Dashboards` in today's log before testing. The
same works for the Outfitter site:
`:client-extensions:outfitter-site:deploy --rerun-tasks`.

**Saved chart edits.** A chart you edit and save is stored in your browser, and
it silently overrides the chart the page declares. To go back to the pages as
shipped, run this in the browser console on the portal:

```js
Object.keys(localStorage).filter(k => k.startsWith('object-dashboard:')).forEach(k => { localStorage.removeItem(k); console.log('removed', k) })
```

**The Outfitter brand.** Switching brands changes the site's default style
book, and it stays switched. Put it back with:

```bash
python3 outfitter/brand.py "Alpine Ridge"      # --show lists them
```

---

## 6. If the data or the sites are gone

Only needed after a database reset. Order matters in one direction: Gear is
site-scoped, so the site has to exist before entries can be written into it.

```bash
cd liferay-workspace && ./gradlew :client-extensions:outfitter-site:deploy
cd .. && python3 outfitter/objects.py          # creates, publishes and seeds both Objects
```

`objects.py` stops with a clear message if the site is missing rather than
writing entries somewhere wrong.

> **Run the `outfitter/` scripts as `python3 outfitter/x.py` from the repo
> root.** `python3 -I` breaks them: isolated mode drops the script's own
> directory from `sys.path`, so `import cdp` fails.

**One thing does not come back this way.** The Outfitter site's display page
template is **made by hand** — the site initializer silently refuses to import
display page templates, which is proven in `outfitter/README.md`. After a
database reset, `/web/outfitter/gear/<slug>` returns 404 until you recreate it:
Site Builder → Page Templates → Display Page Templates → New → Outfitter master
→ name it, content type **Gear** → Publish → ⋮ → **Mark as Default**. That last
step is not optional; without it the template exists, is published, and every
detail URL still 404s.

---

## 7. Deploying a change

Deploy **one** extension, never `blade gw deploy`:

```bash
cd liferay-workspace && ./gradlew :client-extensions:<name>:deploy --rerun-tasks
```

`blade gw deploy` redeploys everything, which re-mints the aggregator's OAuth2
client id and breaks the server-side charts until you restart it.

Gradle sometimes skips the widget's npm build. If `dist/` looks stale, run
`npm run build` in `object-dashboard/dashboard-widget/` first.

---

## Where the rest is written down

| | |
|---|---|
| `outfitter/README.md` | the demo site, and a table of platform behaviours that fail **silently** — start there when something is empty with no error |
