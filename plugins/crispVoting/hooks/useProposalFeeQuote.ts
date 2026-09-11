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
 * `quoteFeeForDuration` and `createProposalWithDuration` both derive their dates from the current
 * block timestamp. The duration and fee therefore do not drift while the wallet transaction waits
 * to be mined.
 *
 * The read also doubles as validation: invalid dates or option counts revert here with the same
 * errors creation would raise, which is why `error` is surfaced rather than swallowed.
 */
export function useProposalFeeQuote(duration: number, data: Hex | undefined): ProposalFeeQuote {
  // `args` is evaluated even when the query is disabled. Avoid `BigInt(NaN)` while the duration
  // field is empty.
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? BigInt(Math.trunc(duration)) : 0n;
  const enabled = Boolean(data) && durationSeconds > 0n;

  const {
    data: fee,
    isLoading,
    error,
  } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: CrispVotingAbi,
    functionName: "quoteFeeForDuration",
    args: [durationSeconds, data as Hex],
    query: { enabled },
  });

  return {
    fee: fee as bigint | undefined,
    isLoading: enabled && isLoading,
    error,
  };
}
