import type { ChartConfig, DataPoint, FieldDef, FieldType, ObjectTarget } from "./types";
import { aggregate } from "./aggregate";
import { isCountMeasure } from "./classify";
import { MOCK_ENTRIES, MOCK_TARGETS } from "./mock";

// The ERC of the object-aggregator CX's user-agent OAuth2 application. Liferay
// mints a token for it so this widget can call the microservice as the
// signed-in user — see object-aggregator/client-extension.yaml.
const AGGREGATOR_AGENT_ERC = "object-aggregator-oaua";

// The OAuth2 client comes from the page's import map, exactly like React and
// Clay do. Do NOT use window.Liferay.OAuth2Client: that global is deprecated
// and is only injected when the LPD-48862 feature flag is on, so on a default
// install it simply is not there. The import-map module needs no flag — it
// resolves the application through /o/oauth2/application.
const OAUTH2_CLIENT_MODULE = "@liferay/oauth2-provider-web/client";

interface OAuth2ClientModule {
  // Async, and it THROWS when no user-agent application matches the ERC.
  FromUserAgentApplication: (erc: string) => Promise<{
    // Resolves to the parsed body, not a Response, and rejects WITH the
    // Response on a non-2xx.
    fetch: (url: string, options?: RequestInit) => Promise<unknown>;
  }>;
}

// Liferay's default pageSizeLimit. Asking for more is silently clamped, so ask
// for what we can actually get and describe the ceiling honestly in the UI.
export const CLIENT_PAGE_SIZE = 500;

// Minimal shape of the Liferay global we rely on. Present when the widget runs
// inside a Liferay page; absent in standalone dev.
interface LiferayGlobal {
  authToken: string;
  ThemeDisplay?: { getPathContext?: () => string };
}
declare global {
  interface Window {
    Liferay?: LiferayGlobal;
  }
}

function liferay(): LiferayGlobal | undefined {
  return typeof window !== "undefined" ? window.Liferay : undefined;
}

export function isInsideLiferay(): boolean {
  return Boolean(liferay());
}

function pathContext(): string {
  return liferay()?.ThemeDisplay?.getPathContext?.() ?? "";
}

// Carry the CSRF/auth token so Liferay authenticates the call as the logged-in
// user. Without it the REST request is treated as Guest → 403.
function authToken(): string {
  return liferay()?.authToken ?? "";
}

function pickLabel(label: unknown, fallback: string): string {
  if (typeof label === "string") return label;
  if (label && typeof label === "object") {
    const values = Object.values(label as Record<string, string>);
    if (values.length) return values[0];
  }
  return fallback;
}

// Map Liferay's businessType onto the coarse kind the config UI groups by.
function mapBusinessType(bt: string): FieldType {
  switch (bt) {
    case "Integer":
    case "LongInteger":
    case "Double":
    case "BigDecimal":
    case "PrecisionDecimal":
      return "number";
    case "Date":
    case "DateTime":
      return "date";
    case "Boolean":
      return "boolean";
    case "Picklist":
    case "MultiselectPicklist":
      return "picklist";
    default:
      return "text";
  }
}

interface ObjectFieldDTO {
  name: string;
  label?: unknown;
  businessType: string;
  system?: boolean;
}
interface ObjectDefinitionDTO {
  externalReferenceCode: string;
  name: string;
  label?: unknown;
  active?: boolean;
  system?: boolean;
  restContextPath: string;
  objectFields: ObjectFieldDTO[];
}

function definitionToTarget(def: ObjectDefinitionDTO): ObjectTarget {
  const fields: FieldDef[] = (def.objectFields ?? [])
    .filter((f) => !f.system)
    .map((f) => ({
      name: f.name,
      label: pickLabel(f.label, f.name),
      type: mapBusinessType(f.businessType),
      businessType: f.businessType,
    }));

  return {
    externalReferenceCode: def.externalReferenceCode,
    objectName: pickLabel(def.label, def.name),
    fields,
    restContextPath: def.restContextPath,
  };
}

/**
 * Lists every published, non-system Object as an ObjectTarget. This is what
 * makes the widget work for ANY Object: pick one and its fields drive the
 * available dimensions/measures — no code change per Object.
 *
 * Standalone (outside Liferay) it returns mock Objects so the dev harness and
 * screenshots work without a portal.
 */
export async function listObjectTargets(): Promise<ObjectTarget[]> {
  if (!isInsideLiferay()) return MOCK_TARGETS;

  const token = authToken();
  const url =
    `${pathContext()}/o/object-admin/v1.0/object-definitions` +
    `?page=1&pageSize=200&p_auth=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "x-csrf-token": token },
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Could not list Objects (${res.status}). Are you logged in?`);
  }
  const body = (await res.json()) as { items?: ObjectDefinitionDTO[] };
  return (body.items ?? [])
    .filter((d) => d.active !== false && !d.system && d.restContextPath)
    .map(definitionToTarget)
    .sort((a, b) => a.objectName.localeCompare(b.objectName));
}

/**
 * Fetches Object entries via Headless, as the logged-in user. The widget then
 * aggregates these client-side (see aggregate.ts).
 *
 * ONE page, deliberately — this is the honest ceiling of the client-side
 * strategy. And the ceiling is not ours to choose: Liferay clamps pageSize
 * against HeadlessAPICompanyConfiguration.pageSizeLimit (default 500) in
 * PaginationProviderImpl, so asking for more just gets you the limit. Whatever
 * the browser gets in one page is what it can chart.
 *
 * Standalone it returns mock entries keyed by restContextPath.
 */
export async function fetchEntries(
  restContextPath: string,
  opts: { pageSize?: number; filter?: string; fields?: string[] } = {}
): Promise<EntryPage> {
  if (!isInsideLiferay()) {
    const rows = MOCK_ENTRIES[restContextPath] ?? [];
    return { rows, totalCount: rows.length };
  }

  const { pageSize = CLIENT_PAGE_SIZE, filter, fields } = opts;
  const token = authToken();
  // restContextPath is already the full path (e.g. "/o/c/expenses") — do NOT
  // prepend another "/o/c".
  const params = new URLSearchParams({
    page: "1",
    pageSize: String(pageSize),
    p_auth: token,
  });
  if (filter) params.set("filter", filter);
  if (fields?.length) params.set("fields", fields.join(","));

  const url = `${pathContext()}${restContextPath}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "x-csrf-token": token },
    credentials: "include",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Could not fetch entries (${res.status}): ${detail}`);
  }
  const body = (await res.json()) as {
    items?: Record<string, unknown>[];
    totalCount?: number;
  };
  const rows = body.items ?? [];
  // totalCount is the whole point: it is how the browser learns that it is
  // charting a fraction. Throwing it away is how a chart lies quietly.
  return { rows, totalCount: body.totalCount ?? rows.length };
}

/**
 * One page of entries, plus how many there actually are.
 *
 * The browser can only ever read one page (Liferay clamps pageSize), so for any
 * Object bigger than that the rows here are a PREFIX of the data — not a random
 * sample, since no sort is sent and the endpoint returns insertion order. The
 * caller must surface the gap; see describeMeta() in ChartView.
 */
export interface EntryPage {
  rows: Record<string, unknown>[];
  totalCount: number;
}

/** What the server strategy returns alongside the points — surfaced in the UI. */
export interface AggregateMeta {
  elapsedMs: number;
  /** HTTP requests the scan cost. Visible so the price is never hidden. */
  requests: number;
  rowsScanned: number;
  truncated: boolean;
  cached: boolean;
  cacheAgeMs: number;
  cacheTtlMs: number;
}

/**
 * The server-side end of the aggregation spectrum: hand the whole ChartConfig
 * to the object-aggregator microservice and get back the finished DataPoint[].
 *
 * Note what does NOT happen here — no entries are fetched, and aggregate() is
 * never called. The rows stay on the server; only the points cross the wire.
 * The chart cannot tell the difference, which is exactly the point.
 *
 * Standalone it aggregates the mock rows locally so the dev harness still works
 * without a deployed microservice.
 */
export async function fetchAggregate(
  config: ChartConfig
): Promise<{ items: DataPoint[]; meta: AggregateMeta | null }> {
  if (!isInsideLiferay()) {
    const rows = MOCK_ENTRIES[config.restContextPath] ?? [];
    return { items: aggregate(rows, config), meta: null };
  }

  const params = new URLSearchParams({
    aggregation: config.aggregation,
    dimension: config.dimension,
    objectErc: config.objectErc,
    restContextPath: config.restContextPath,
  });
  if (!isCountMeasure(config.measure)) params.set("measure", config.measure as string);
  if (config.weightField) params.set("weightField", config.weightField);
  if (config.dateBucket) params.set("dateBucket", config.dateBucket);

  // NOTE: the token this mints carries only the scopes declared in the
  // aggregator's client-extension.yaml, and Object entry scopes are per Object
  // and LOWERCASE ("c_salesorder.everything.read"). An Object that is chartable
  // in the browser will 403 here until it is added there — the honest cost of
  // aggregating through a microservice rather than the user's session.
  let client: Awaited<ReturnType<OAuth2ClientModule["FromUserAgentApplication"]>>;
  try {
    const mod = (await import(/* @vite-ignore */ OAUTH2_CLIENT_MODULE)) as OAuth2ClientModule;
    client = await mod.FromUserAgentApplication(AGGREGATOR_AGENT_ERC);
  } catch {
    throw new Error(
      `Could not reach the object-aggregator's OAuth2 application ("${AGGREGATOR_AGENT_ERC}"). ` +
        "Is the Client Extension deployed? Otherwise switch this chart back to browser aggregation."
    );
  }

  let body: { items?: DataPoint[]; meta?: AggregateMeta };
  try {
    body = (await client.fetch(`/aggregate?${params.toString()}`)) as typeof body;
  } catch (rejected) {
    // OAuth2Client rejects with the Response itself, not an Error.
    if (rejected instanceof Response) {
      const detail = await rejected.text().catch(() => "");
      throw new Error(`Server aggregation failed (${rejected.status}): ${detail}`);
    }
    throw rejected;
  }

  return { items: body.items ?? [], meta: body.meta ?? null };
}
