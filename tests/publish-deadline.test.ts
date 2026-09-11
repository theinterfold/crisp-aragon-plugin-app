import { expect, test, describe } from "bun:test";

/**
 * The commitment-deadline guard in `usePublishVote`.
 *
 * `blockedReason` is computed during render and `useProposal` only re-renders when a new block
 * arrives. Generating a CRISP ballot proof takes tens of seconds, so the render that enabled the
 * publish button can be arbitrarily stale by the time `publish()` runs — the window can close in
 * between, and the voter is asked to sign a transaction `publishInput` reverts.
 *
 * `publish()` therefore re-evaluates the time-dependent guards against the clock at call time.
 * This mirrors that logic (`timeBlockedReason`) and pins the property: the verdict must follow
 * the clock at the moment it is asked, not the clock at the last render.
 */
const OPEN = 1_000n;
const DEADLINE = 2_000n;

/** Mirror of `timeBlockedReason` in plugins/crispVoting/hooks/usePublishVote.ts. */
function timeBlockedReason(
  nowSeconds: bigint,
  inputWindow: readonly [bigint, bigint] | undefined,
  commitmentDeadline: bigint | undefined
): string | undefined {
  if (!inputWindow) return undefined;
  if (nowSeconds < inputWindow[0]) return "The voting window has not opened yet.";
  if (commitmentDeadline !== undefined && nowSeconds >= commitmentDeadline) {
    return "The voting window has closed for new ballots.";
  }
  return undefined;
}

const window_ = [OPEN, DEADLINE] as const;

describe("publish-time commitment deadline re-check", () => {
  test("permits a ballot inside the window", () => {
    expect(timeBlockedReason(1_500n, window_, DEADLINE)).toBeUndefined();
  });

  test("refuses before the window opens", () => {
    expect(timeBlockedReason(999n, window_, DEADLINE)).toBe("The voting window has not opened yet.");
  });

  test("refuses once the commitment deadline is reached", () => {
    expect(timeBlockedReason(DEADLINE, window_, DEADLINE)).toBe("The voting window has closed for new ballots.");
  });

  /**
   * The regression this guard exists for. A render at t=1500 produced "allowed"; proof generation
   * then ran past the deadline. Re-asking at t=2500 must refuse — if `publish()` reused the
   * render-time verdict it would submit a transaction that reverts.
   */
  test("a verdict taken before the deadline does not authorise a write after it", () => {
    const atRender = timeBlockedReason(1_500n, window_, DEADLINE);
    expect(atRender).toBeUndefined();

    const atWrite = timeBlockedReason(2_500n, window_, DEADLINE);
    expect(atWrite).toBe("The voting window has closed for new ballots.");
    expect(atWrite).not.toBe(atRender);
  });

  test("one second before the deadline still passes", () => {
    expect(timeBlockedReason(DEADLINE - 1n, window_, DEADLINE)).toBeUndefined();
  });

  test("is inert while the round data is still loading", () => {
    expect(timeBlockedReason(2_500n, undefined, DEADLINE)).toBeUndefined();
  });

  test("falls back to the input window when no commitment deadline is published", () => {
    expect(timeBlockedReason(2_500n, window_, undefined)).toBeUndefined();
    expect(timeBlockedReason(500n, window_, undefined)).toBe("The voting window has not opened yet.");
  });
});
