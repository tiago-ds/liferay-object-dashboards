import { lxcConfig } from "@rotty3000/config-node";
import fetch from "node-fetch";

import { MAX_ROWS, PAGE_CONCURRENCY, REQUESTED_PAGE_SIZE } from "./constants.js";

// Resolved lazily, not at import time: reading LXC metadata on module load
// would make this file impossible to import outside a Liferay container — and
// planScan() below is exactly the logic that most needs to be unit-tested.
function dxpOrigin(): string {
  return `${lxcConfig.dxpProtocol()}://${lxcConfig.dxpMainDomain()}`;
}

interface EntryPage {
  items: Record<string, unknown>[];
  // Liferay echoes the EFFECTIVE page size — already clamped to the company's
  // pageSizeLimit — plus the total. Both are authoritative; our request is not.
  pageSize?: number;
  totalCount?: number;
}

export interface ScanResult {
  rows: Record<string, unknown>[];
  /** HTTP requests this scan cost. Surfaced so the price stays visible. */
  requests: number;
  truncated: boolean;
}

async function readPage(
  token: string,
  restContextPath: string,
  page: number,
  opts: { fields?: string[]; filter?: string }
): Promise<EntryPage> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(REQUESTED_PAGE_SIZE),
  });
  if (opts.filter) params.set("filter", opts.filter);
  if (opts.fields?.length) params.set("fields", opts.fields.join(","));

  const res = await fetch(`${dxpOrigin()}${restContextPath}?${params}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Headless read failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as EntryPage;
}

export interface ScanPlan {
  /** Last page number to read, inclusive. 1 means page 1 was enough. */
  lastPage: number;
  /** Rows we expect to end up with, after MAX_ROWS is applied. */
  rowsExpected: number;
  /** True when the Object has more rows than MAX_ROWS lets us read. */
  truncated: boolean;
}

/**
 * Works out how far to page, from what the FIRST RESPONSE actually said.
 *
 * This exists as a pure function because getting it wrong is silent and
 * catastrophic: the original version stopped as soon as a page came back
 * smaller than the page size it had *asked* for. Liferay clamps pageSize
 * against the company's pageSizeLimit (default 500), so a request for 1000
 * always returned 500, which always looked like the last page — every scan
 * quietly stopped after 500 rows and reported success. A server-side chart and
 * a client-side chart of the same data would then simply disagree.
 *
 * The rule: trust the response's effective pageSize and totalCount. Never
 * compare a response against a constant of our own.
 */
export function planScan(
  totalCount: number,
  effectivePageSize: number,
  maxRows: number
): ScanPlan {
  if (effectivePageSize <= 0 || totalCount <= 0) {
    return { lastPage: 1, rowsExpected: Math.max(0, totalCount), truncated: false };
  }

  const rowsExpected = Math.min(totalCount, maxRows);

  return {
    lastPage: Math.ceil(rowsExpected / effectivePageSize),
    rowsExpected,
    truncated: totalCount > maxRows,
  };
}

/** Runs tasks with a bounded number in flight, preserving result order. */
async function pooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Reads an Object's entries server-side, pulling only the fields the chart
 * needs. This is why the server strategy is worth anything: the rows the
 * browser would have downloaded are read next to the database, and only the
 * aggregated points cross the wire.
 *
 * `token` is the CALLER'S token, forwarded verbatim. This service deliberately
 * holds no credential of its own: reading as itself would let any signed-in
 * user chart rows they are not allowed to see, which is a privilege escalation
 * dressed up as a bar chart.
 *
 * Page 1 tells us the truth — the effective page size (Liferay clamps ours)
 * and the total count. Everything after that is derived from those two numbers
 * and fetched concurrently, rather than walked one blocking request at a time.
 */
export async function fetchAllEntries(
  restContextPath: string,
  token: string,
  opts: { fields?: string[]; filter?: string } = {}
): Promise<ScanResult> {
  const first = await readPage(token, restContextPath, 1, opts);
  const rows = [...(first.items ?? [])];

  // Trust the response, never our own REQUESTED_PAGE_SIZE: asking for 500 and
  // being given 100 by a stricter pageSizeLimit must not read as "last page".
  const plan = planScan(
    first.totalCount ?? rows.length,
    first.pageSize || rows.length,
    MAX_ROWS
  );

  const tasks = [];
  for (let page = 2; page <= plan.lastPage; page++) {
    tasks.push(() => readPage(token, restContextPath, page, opts));
  }

  for (const body of await pooled(tasks, PAGE_CONCURRENCY)) {
    rows.push(...(body.items ?? []));
  }

  return {
    requests: plan.lastPage,
    rows: rows.slice(0, MAX_ROWS),
    truncated: plan.truncated,
  };
}
