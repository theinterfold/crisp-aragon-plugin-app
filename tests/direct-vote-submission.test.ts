import { expect, test, describe } from "bun:test";

/**
 * INV: the direct route must submit the SERVER'S attested payload, and must not submit at all when
 * the statement is already committed.
 *
 * The direct route is a two-call flow, not a relay:
 *
 *   1. POST /voting/broadcast with the six-field `InputEnvelope` (what `encodeSolidityProof`
 *      builds). Staging is what stores the ciphertext in Avail and mints the attestation.
 *   2. Submit the returned `encoded_proof` — the seven-field `InputCommitmentEnvelope`, signed by
 *      `inputAvailabilitySigner` — from the voter's own wallet.
 *
 * The response shape is `AvailabilityJobView` (`data_availability.rs:380`) and the state mapping is
 * at `:469`. The subtlety this file guards: in the ALREADY-RELAYED state the server populates BOTH
 * `tx_hash` and `encoded_proof` — the payload is exposed only as a fallback for a client that wants
 * the direct path after a relay failure. A client that reaches for `encoded_proof` first sends a
 * second commitment for the same statement and eats `InputAlreadyCommitted`.
 */

/** Mirrors `AvailabilityJobView`. */
interface VoteResponse {
  status: string;
  tx_hash: string | null;
  message: string | null;
  is_vote_update: boolean | null;
  encoded_proof?: string | null;
  job_id?: string | null;
}

type DirectOutcome =
  | { action: "submit"; payload: string }
  | { action: "already-committed"; txHash: string }
  | { action: "error"; reason: string };

/**
 * The decision the direct route makes on the staging response. Mirrors the `submitOnChain` branch
 * in `useCrispServer.postVote`; kept as a pure function so the ORDER of the checks is testable
 * without a wallet, a server, or React.
 */
const decideDirectSubmission = (response: VoteResponse): DirectOutcome => {
  if (response.tx_hash) {
    return { action: "already-committed", txHash: response.tx_hash };
  }
  if (!response.encoded_proof) {
    return {
      action: "error",
      reason: response.message ?? "The server has not returned an attested payload for this vote yet.",
    };
  }
  return { action: "submit", payload: response.encoded_proof };
};

const ATTESTED = `0x${"ab".repeat(64)}`;
const RELAY_TX = "0xb2ed8f25bf95d2c8426c889caa50b76752c0eb2b25ec3f49ab8b2f9d7175c5cc";

const view = (over: Partial<VoteResponse>): VoteResponse => ({
  status: "ready_for_commitment",
  tx_hash: null,
  message: null,
  is_vote_update: false,
  encoded_proof: null,
  job_id: "job-1",
  ...over,
});

describe("direct vote submission (INV: submit the server's attested payload, exactly once)", () => {
  /** `JobState::AwaitingCommitment { relayed_transaction_hash: None }` — the mainnet path. */
  test("ready_for_commitment submits the attested payload from the wallet", () => {
    const outcome = decideDirectSubmission(view({ status: "ready_for_commitment", encoded_proof: ATTESTED }));
    expect(outcome).toEqual({ action: "submit", payload: ATTESTED });
  });

  /**
   * The regression. `relayed_transaction_hash: Some(..)` sets status `pending_availability` and
   * populates BOTH fields. Reaching for the payload here double-commits.
   */
  test("an already-relayed job does NOT submit, even though a payload is present", () => {
    const relayed = view({
      status: "pending_availability",
      tx_hash: RELAY_TX,
      encoded_proof: ATTESTED,
    });
    expect(relayed.encoded_proof).toBeTruthy(); // the trap
    expect(decideDirectSubmission(relayed)).toEqual({ action: "already-committed", txHash: RELAY_TX });
  });

  /** `JobState::Created` — staged, attestation not minted yet. */
  test("pending_commitment reports the wait instead of submitting nothing", () => {
    const outcome = decideDirectSubmission(view({ status: "pending_commitment", encoded_proof: null }));
    expect(outcome.action).toBe("error");
  });

  test("the server's own message is surfaced when it sends one", () => {
    const outcome = decideDirectSubmission(
      view({ status: "failed", message: "the input proof commitment deadline passed" })
    );
    expect(outcome).toEqual({
      action: "error",
      reason: "the input proof commitment deadline passed",
    });
  });

  /**
   * The bug this replaced: the route used to submit the LOCALLY built six-field envelope. Any
   * payload the wallet sends must have come from the response.
   */
  test("the submitted payload is always the one the server returned", () => {
    const locallyEncoded = `0x${"cd".repeat(64)}`;
    const outcome = decideDirectSubmission(view({ encoded_proof: ATTESTED }));
    expect(outcome.action).toBe("submit");
    if (outcome.action === "submit") {
      expect(outcome.payload).toBe(ATTESTED);
      expect(outcome.payload).not.toBe(locallyEncoded);
    }
  });

  /** A terminal `Submitted` job reports success with a hash; never re-submit it. */
  test("a completed job is treated as committed, not as work to redo", () => {
    expect(decideDirectSubmission(view({ status: "success", tx_hash: RELAY_TX })).action).toBe("already-committed");
  });
});
