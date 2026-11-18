// How fast Virga writes to a list, in one place: the run route paces itself by
// it and the page estimates from it (plan.js). A batch of BATCH list items at
// most every BATCH_GAP_MS per account that holds a list keeps under the PDS's
// 5,000 points an hour (a list item costs 3) with room left for the account's
// own posting. No imports, so the server and the browser both load it as is.

/** List items written in one request. */
export const BATCH = 50;

/** The least time between two batches for one holder. */
export const BATCH_GAP_MS = 2 * 60_000;

/** How long a job waits after the PDS says the holder is rate limited. */
export const RATE_LIMIT_HOLD_MS = 60 * 60_000;

/** What a list item costs against the PDS's write limit, and that limit. */
export const POINTS_PER_CREATE = 3;
export const POINTS_PER_HOUR = 5000;
