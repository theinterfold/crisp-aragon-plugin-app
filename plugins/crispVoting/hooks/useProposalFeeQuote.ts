import { useReadContract } from "wagmi";
import type { Hex } from "viem";
import { CrispVotingAbi } from "../artifacts/CrispVoting";
import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS } from "@/constants";

export type ProposalFeeQuote = {
  /** The E3 fee this proposal would cost, in fee-token units. */
  fee?: bigint;
  isLoading: boolean;
  /** The plugin rejected these parameters — same reverts `createProposal` would give. */
  error?: Error | null;
};

/**
 * Quotes the E3 fee for a proposal before creating it.
 *
 * The quote uses the same fixed voting dates as `createProposal`. The plugin adds the Avail
 * finalization window to the Interfold request without changing the displayed vote end.
 *
 * The read checks plugin dates and the Interfold quote. CRISP's request-time checks still run
 * during proposal creation, so the form also checks the live voting minimum and simulates the
 * write before submitting it.
 */
export function useProposalFeeQuote(startAt: number, endAt: number, data: Hex | undefined): ProposalFeeQuote {
  const validDates = Number.isSafeInteger(startAt) && Number.isSafeInteger(endAt) && startAt > 0 && endAt > startAt;
  const enabled = Boolean(data) && validDates;

  const {
    data: fee,
    isLoading,
    error,
  } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: CrispVotingAbi,
    functionName: "quoteFee",
    args: [BigInt(validDates ? startAt : 0), BigInt(validDates ? endAt : 0), data as Hex],
    query: { enabled },
  });

  return {
    fee: fee as bigint | undefined,
    isLoading: enabled && isLoading,
    error,
  };
}
