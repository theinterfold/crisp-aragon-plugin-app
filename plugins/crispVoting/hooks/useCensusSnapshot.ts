import { useQuery } from "@tanstack/react-query";
import { crispSdk } from "../utils/crispSdk";

/**
 * The timepoint the CRISP server built this round's census from, in the voting token's
 * clock units.
 *
 * Prefer this over `proposal.parameters.snapshotBlock` for any token read whose result is
 * compared against the census (eligibility, ballot weight). `CrispVoting` records
 * `block.number - 1` at proposal creation, but the token may be EIP-6372
 * `CLOCK_MODE=timestamp` — in which case a block number is a timepoint decades before the
 * token existed and `getPastVotes` returns 0 for everyone rather than reverting. The
 * server reports its snapshot in whatever units the token actually uses, so asking it
 * sidesteps the mismatch entirely.
 *
 * Falls back to the on-chain value when the server cannot be reached or does not report a
 * snapshot, which is correct for a block-clocked token and no worse than the status quo
 * for a timestamp-clocked one.
 */
export function useCensusSnapshot(e3Id: bigint | undefined, chainSnapshot: bigint | undefined) {
  const { data } = useQuery({
    queryKey: ["crisp-census-snapshot", e3Id?.toString()],
    // The snapshot is pinned when the round starts and never moves afterwards.
    staleTime: Infinity,
    enabled: e3Id !== undefined,
    queryFn: async () => {
      const details = await crispSdk.getRoundTokenDetails(Number(e3Id));
      return details.snapshotBlock > 0n ? details.snapshotBlock : null;
    },
    // A round the server has not indexed yet is not an error worth retrying hard.
    retry: 1,
  });

  return data ?? chainSnapshot;
}
