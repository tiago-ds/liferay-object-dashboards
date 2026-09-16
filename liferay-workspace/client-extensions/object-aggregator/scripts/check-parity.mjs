/**
 * The talk's central claim, enforced in the build.
 *
 * The group-by does not change when it moves from the browser to this service —
 * these files are byte-identical copies of the widget's. If they ever drift,
 * the "same contract, different engine" story is no longer true, so the build
 * fails here rather than silently shipping two different aggregations.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mine = join(here, "..", "src");
const theirs = join(here, "..", "..", "object-dashboard", "dashboard-widget", "src");

const SHARED = ["types.ts", "classify.ts", "aggregate.ts"];

const drifted = SHARED.filter((file) => {
  try {
    return !readFileSync(join(mine, file)).equals(readFileSync(join(theirs, file)));
  } catch (error) {
    console.error(`check:parity — could not read ${file}: ${error.message}`);
    process.exit(1);
  }
});

if (drifted.length) {
  console.error(
    `check:parity FAILED — these differ from the widget: ${drifted.join(", ")}\n` +
      `Copy them across so both sides aggregate identically:\n` +
      drifted.map((f) => `  cp ${join(theirs, f)} ${join(mine, f)}`).join("\n")
  );
  process.exit(1);
}

console.log(`check:parity OK — ${SHARED.join(", ")} identical to the widget.`);
