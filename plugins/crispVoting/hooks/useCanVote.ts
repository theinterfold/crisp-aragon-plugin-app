import { useAccount, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { PUB_CHAIN, PUB_TOKEN_ADDRESS } from "@/constants";
import { useCensusSnapshot } from "./useCensusSnapshot";

const erc20Votes = parseAbi(["function getPastVotes(address account, uint256 timepoint) view returns (uint256)"]);

/**
 * Whether the connected account could cast a ballot in this round.
 *
 * Eligibility is the voting token's delegated power at the round's census snapshot — the same
 * figure the CRISP census is built from. It is deliberately NOT a plugin call: `CrispVoting` has
 * no `canVote`, and the ballot itself is submitted to the CRISP server rather than the contract.
 *
 * The snapshot comes from `useCensusSnapshot` rather than `parameters.snapshotBlock` directly:
 * against a timestamp-clocked token the on-chain value is in the wrong units and reads 0 for
 * every holder, which would report the whole DAO as ineligible. See `useCensusSnapshot`.
 *
 * Returns `undefined` until the snapshot read resolves, so callers must distinguish "not yet
 * known" from `false` rather than treating both as ineligible.
 */
export function useCanVote(e3Id: bigint | undefined, chainSnapshot: bigint | undefined): boolean | undefined {
  const { address } = useAccount();
  const snapshot = useCensusSnapshot(e3Id, chainSnapshot);

  const enabled = Boolean(address) && snapshot !== undefined;

  const { data: pastVotes } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_TOKEN_ADDRESS,
    abi: erc20Votes,
    functionName: "getPastVotes",
    args: [address as `0x${string}`, snapshot ?? 0n],
    query: { enabled },
  });

  if (!enabled || pastVotes === undefined) return undefined;

  return pastVotes > 0n;
}
