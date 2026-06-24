import { useState, useEffect } from "react";
import { ProposalStatus } from "@aragon/ods";
import { useToken } from "./useToken";
import { usePastSupply } from "./usePastSupply";
import { computeQuorum, isSignalingOnly } from "../utils/quorum";

import type { Proposal } from "../utils/types";

/** Sum all counts in the tally array. */
function getTotalVotes(tally: bigint[]): bigint {
  let sum = 0n;

  for (let i = 0; i < tally.length; i += 1) {
    sum += tally[i] ?? 0n;
  }

  return sum;
}

/**
 * Mirrors the contract's _canExecute logic:
 * - 2-3 options: quorum + counts[0] > counts[1]
 * - 4+ options: quorum only
 */
function hasPassed(tally: bigint[], numOptions: number): boolean {
  const totalVotes = getTotalVotes(tally);
  if (totalVotes === 0n) return false;

  if (numOptions <= 3) {
    return (tally[0] ?? BigInt(0)) > (tally[1] ?? BigInt(0));
  }
  return true;
}

/**
 * For 2-3 options, the proposal is rejected when no >= yes.
 * For 4+ options, there's no concept of "rejected" — it either
 * meets quorum or has low turnout.
 */
function isRejected(tally: bigint[], numOptions: number): boolean {
  if (numOptions <= 3) {
    return (tally[1] ?? BigInt(0)) >= (tally[0] ?? BigInt(0));
  }
  return false;
}

export const useProposalStatus = (proposal: Proposal, e3Failed = false) => {
  const [status, setStatus] = useState<ProposalStatus>(ProposalStatus.PENDING);

  const { decimals } = useToken();
  // Quorum uses the total voting power at the snapshot block, mirroring the
  // contract's `totalVotingPower(snapshotBlock)` (= getPastTotalSupply).
  const pastSupply = usePastSupply(proposal?.parameters?.snapshotBlock);

  useEffect(() => {
    if (!proposal || !proposal?.parameters) return;

    const tally = proposal.tally ?? [];
    const numOptions = proposal.numOptions ?? tally.length;
    const totalVotes = getTotalVotes(tally);

    // Signaling-only proposals (polls) have no quorum / pass-fail concept; their
    // tally is informational only. Quorum gating applies to executable proposals.
    const signaling = isSignalingOnly(numOptions, proposal.parameters.creditMode);
    const quorum = signaling
      ? null
      : computeQuorum(
          totalVotes,
          pastSupply,
          Number(proposal.parameters.minParticipation ?? 0n),
          proposal.parameters.creditMode,
          Number(decimals ?? 18)
        );

    if (proposal?.active) {
      setStatus(ProposalStatus.ACTIVE);
    } else if (proposal?.executed) {
      setStatus(ProposalStatus.EXECUTED);
    } else if (e3Failed) {
      // The encrypted vote round failed on-chain (e.g. committee/DKG failure):
      // it can never be tallied or executed.
      setStatus(ProposalStatus.FAILED);
    } else if (!proposal?.isTallied) {
      setStatus(ProposalStatus.PENDING);
    } else if (totalVotes === 0n) {
      setStatus(ProposalStatus.FAILED);
    } else if (quorum && !quorum.reached) {
      setStatus(ProposalStatus.FAILED);
    } else if (hasPassed(tally, numOptions) && proposal.actions.length > 0) {
      setStatus(ProposalStatus.EXECUTABLE);
    } else if (hasPassed(tally, numOptions) && proposal.actions.length === 0) {
      setStatus(ProposalStatus.ACCEPTED);
    } else if (isRejected(tally, numOptions)) {
      setStatus(ProposalStatus.REJECTED);
    } else {
      setStatus(ProposalStatus.PENDING);
    }
  }, [proposal, pastSupply, decimals, e3Failed]);

  return status;
};
