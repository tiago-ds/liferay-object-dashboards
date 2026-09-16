// ERC of the OAuth2 application declared in client-extension.yaml. By
// default Liferay uses the CX entry key itself as the ERC. VERIFY ON FIRST
// DEPLOY: Control Panel -> Security -> OAuth2 Administration lists the real
// ERCs; auth.ts fails at startup with the injected list if this is wrong.
export const OAUTH_USER_AGENT_ERC = "object-aggregator-oaua";

/**
 * What we ASK for per page. Liferay clamps this against the company's
 * HeadlessAPICompanyConfiguration.pageSizeLimit (default 500) in
 * PaginationProviderImpl:
 *
 *     Pagination.of(requestPage, Math.min(requestPageSize, pageSizeLimit))
 *
 * So asking for more than the limit silently gets you the limit, and asking
 * for 0/-1 ("unlimited") gets you the limit too. NEVER infer "last page" by
 * comparing a response to this constant — read the effective pageSize and
 * totalCount off the response instead (see headless.ts).
 */
export const REQUESTED_PAGE_SIZE = 500;

// How many page requests may be in flight at once. The scan is the expensive
// part of this service; serialising it would make a wide Object take seconds.
export const PAGE_CONCURRENCY = 8;

/**
 * Upper bound on rows one scan will read. This is a REAL cost, not a
 * formality: at a 500-row page size, 100,000 rows is 200 HTTP requests to
 * Liferay. That is only defensible because the result is cached (cache.ts) and
 * therefore paid once per TTL rather than once per page view.
 *
 * If you need a higher ceiling than this, you have outgrown scanning: move to
 * a precomputed cube Object maintained by an Object Action on write, and
 * point the dashboard widget at THAT Object instead.
 */
export const MAX_ROWS = 100_000;

// How long an aggregated result stays fresh. Dashboards are read-heavy and
// tolerate slightly stale numbers; this is what turns a 200-request scan into
// a once-a-minute cost. Note the cache is per user (reads run as the caller),
// so it is not shared across a team.
export const CACHE_TTL_MS = 60_000;
