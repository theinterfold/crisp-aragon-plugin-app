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
 * `quoteFee` runs the given dates and encoded data through the same request construction
 * `createProposal` uses, so the number shown is the number that will be charged — as long as the
 * dates are explicit. A `0` date normalises to `block.timestamp` on-chain, so the window (and
 * therefore the fee) drifts between this read and the transaction; the create flow keeps a
 * simulate-and-top-up step for exactly that case.
 *
 * The read also doubles as validation: invalid dates or option counts revert here with the same
 * errors creation would raise, which is why `error` is surfaced rather than swallowed.
 */
export function useProposalFeeQuote(startDate: number, endDate: number, data: Hex | undefined): ProposalFeeQuote {
  // `args` is evaluated on every render, including when the query is disabled, so the conversion
  // has to be total: a date from a half-filled form is NaN, and `BigInt(NaN)` throws a RangeError
  // that unmounts the page instead of simply skipping the quote.
  const toTimestamp = (value: number) => (Number.isFinite(value) && value > 0 ? BigInt(Math.trunc(value)) : 0n);

  const start = toTimestamp(startDate);
  const end = toTimestamp(endDate);
  const enabled = Boolean(data) && end > 0n;

  const {
    data: fee,
    isLoading,
    error,
  } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: CrispVotingAbi,
    functionName: "quoteFee",
    args: [start, end, data as Hex],
    query: { enabled },
  });

  return {
    fee: fee as bigint | undefined,
    isLoading: enabled && isLoading,
    error,
  };
}
