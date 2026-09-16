import assert from "node:assert/strict";
import { test } from "node:test";

import { planScan } from "./headless.js";

const MAX = 100_000;

test("pages through everything when the Object is larger than one page", () => {
  // The regression: we ASK for 500 and Liferay may give us 500. 48,000 rows is
  // 96 pages — the old code stopped at page 1 and called it a complete scan.
  const plan = planScan(48_000, 500, MAX);
  assert.equal(plan.lastPage, 96);
  assert.equal(plan.rowsExpected, 48_000);
  assert.equal(plan.truncated, false);
});

test("trusts the response page size, not what we asked for", () => {
  // A company with a stricter pageSizeLimit of 100 clamps us silently.
  const plan = planScan(48_000, 100, MAX);
  assert.equal(plan.lastPage, 480);
});

test("one page is enough when the Object fits in it", () => {
  const plan = planScan(120, 500, MAX);
  assert.equal(plan.lastPage, 1);
  assert.equal(plan.truncated, false);
});

test("a full single page is not mistaken for a partial one", () => {
  const plan = planScan(500, 500, MAX);
  assert.equal(plan.lastPage, 1);
  assert.equal(plan.rowsExpected, 500);
});

test("stops at MAX_ROWS and says so", () => {
  const plan = planScan(250_000, 500, MAX);
  assert.equal(plan.rowsExpected, MAX);
  assert.equal(plan.lastPage, 200);
  assert.equal(plan.truncated, true);
});

test("an empty Object costs one request, not an infinite loop", () => {
  const plan = planScan(0, 500, MAX);
  assert.equal(plan.lastPage, 1);
  assert.equal(plan.rowsExpected, 0);
});

test("a nonsense page size degrades to a single page", () => {
  const plan = planScan(48_000, 0, MAX);
  assert.equal(plan.lastPage, 1);
});
