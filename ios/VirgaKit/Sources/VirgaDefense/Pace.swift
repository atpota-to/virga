// Ports src/defense/pace.js
//
// How fast Virga writes to a list, in one place: the run route paces itself
// by it and the page estimates from it (plan.js). A batch of `batch` list
// items at most every `batchGapMs` per account that holds a list keeps under
// the PDS's 5,000 points an hour (a list item costs 3) with room left for the
// account's own posting.

import Foundation

public enum Pace {
  /// BATCH: list items written in one request.
  public static let batch = 50

  /// BATCH_GAP_MS: the least time between two batches for one holder.
  public static let batchGapMs = 2 * 60_000

  /// RATE_LIMIT_HOLD_MS: how long a job waits after the PDS says the holder is rate limited.
  public static let rateLimitHoldMs = 60 * 60_000

  /// POINTS_PER_CREATE: what a list item costs against the PDS's write limit.
  public static let pointsPerCreate = 3

  /// POINTS_PER_HOUR: the PDS's write limit.
  public static let pointsPerHour = 5000
}
