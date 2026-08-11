/** Identifies one in-flight refund-status query: which proposal it asked about, and when. */
export type RefundQuery = {
  /** Monotonic id claimed when the query started. */
  id: number;
  /** The proposal the query asked about. */
  proposalId: bigint;
};

/** The hook's current position: the newest query id, and the proposal now on screen. */
export type RefundQueryState = {
  latestId: number;
  activeProposalId: bigint | undefined;
};

/**
 * Whether a completed refund-status query may still write its result.
 *
 * BOTH conditions are load-bearing, and each catches a case the other misses:
 *
 * - `id` orders concurrent queries for the SAME proposal, so a slow earlier one cannot overwrite
 *   a newer answer.
 * - `proposalId` catches a stale closure that starts a query AFTER the hook has moved on. The
 *   refresh at the end of `claim` is captured when the hook was on proposal A; if the claim's
 *   receipt lands once the hook is showing proposal B, that closure queries A's logs and claims a
 *   brand-new (therefore newest) id. The id check alone would wave it through and paint A's
 *   answer onto B's UI.
 */
export function isRefundQueryStale(query: RefundQuery, state: RefundQueryState): boolean {
  return query.id !== state.latestId || query.proposalId !== state.activeProposalId;
}
