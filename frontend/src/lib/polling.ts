/** Polling cadence (BRD §4.1 "real-time via polling"). Exported so tests and docs share one source. */
export const POLL_CLASSES_MS = 3_000
export const POLL_HOLDS_MS = 4_000
/** While a poll keeps failing (server down) slow down instead of hammering it. */
export const POLL_BACKOFF_MS = 10_000
