import { expect, test, describe } from "bun:test";
import { isRefundQueryStale, type RefundQueryState } from "../plugins/crispVoting/utils/refundQuery";

/**
 * The refund card asks "was this proposal's fee already refunded?" by scanning `RefundClaimed`
 * logs. Those scans are async and the hook can move to a different proposal while one is in flight,
 * so every finished scan is checked against `isRefundQueryStale` before it writes state.
 *
 * These tests drive that rule directly. `useClaimRefund` is a React hook and the repo has no
 * renderer, so the rule lives in a pure function rather than being untestable inside the hook.
 */

const A = 1n;
const B = 2n;

/** Mirrors the hook's two refs. */
function makeHook() {
  const state: RefundQueryState = { latestId: 0, activeProposalId: undefined };

  return {
    state,
    /** What the effect does when the hook lands on a proposal. */
    focus(proposalId: bigint) {
      state.activeProposalId = proposalId;
      state.latestId += 1;
    },
    /** What `checkClaimed` does when it starts a scan. */
    startQuery(proposalId: bigint) {
      return { id: ++state.latestId, proposalId };
    },
  };
}

describe("refund status query staleness", () => {
  test("a scan that completes while its own proposal is still current is applied", () => {
    const hook = makeHook();
    hook.focus(A);
    const query = hook.startQuery(A);

    expect(isRefundQueryStale(query, hook.state)).toBe(false);
  });

  test("an older scan cannot overwrite a newer one for the same proposal", () => {
    const hook = makeHook();
    hook.focus(A);
    const first = hook.startQuery(A);
    const second = hook.startQuery(A);

    expect(isRefundQueryStale(first, hook.state)).toBe(true);
    expect(isRefundQueryStale(second, hook.state)).toBe(false);
  });

  test("a scan in flight when the hook moves to another proposal is discarded", () => {
    const hook = makeHook();
    hook.focus(A);
    const queryForA = hook.startQuery(A);

    hook.focus(B); // navigated away before A's logs came back

    expect(isRefundQueryStale(queryForA, hook.state)).toBe(true);
  });

  /**
   * The case the id counter alone gets wrong, and the reason `proposalId` is checked too.
   *
   * `claim()` closes over the proposal that was current when it was called. If its receipt lands
   * after the hook has moved on, that stale closure starts a BRAND NEW scan — which claims the
   * newest id and would therefore pass an id-only check, painting proposal A's answer onto B.
   */
  test("a claim for A that resolves after moving to B cannot write B's state", () => {
    const hook = makeHook();
    hook.focus(A);

    // claim(A) sent; receipt still pending.
    hook.focus(B); // hook moves to proposal B, which runs its own scan
    const queryForB = hook.startQuery(B);

    // A's receipt finally lands and the stale closure kicks off its refresh — for A.
    const lateQueryForA = hook.startQuery(A);

    // It holds the newest id, so an id-only check would accept it.
    expect(lateQueryForA.id).toBe(hook.state.latestId);
    expect(lateQueryForA.id !== hook.state.latestId).toBe(false);

    // The proposal check is what rejects it.
    expect(isRefundQueryStale(lateQueryForA, hook.state)).toBe(true);

    // ...and B's own scan is superseded by that late request's id bump, so it is dropped too:
    // neither writes state, leaving `isClaimed` undefined, which the card treats as claimable.
    expect(isRefundQueryStale(queryForB, hook.state)).toBe(true);
  });
});
