import { useAccount, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { PUB_CHAIN, PUB_TOKEN_ADDRESS } from "@/constants";

const erc20Votes = parseAbi(["function getPastVotes(address account, uint256 blockNumber) view returns (uint256)"]);

/**
 * Whether the connected account could cast a ballot in this round.
 *
 * Eligibility is the voting token's delegated power at the proposal's snapshot block — the same
 * figure the CRISP census is built from. It is deliberately NOT a plugin call: `CrispVoting` has
 * no `canVote`, and the ballot itself is submitted to the CRISP server rather than the contract.
 *
 * Returns `undefined` until the snapshot read resolves, so callers must distinguish "not yet
 * known" from `false` rather than treating both as ineligible.
 */
export function useCanVote(snapshotBlock: bigint | undefined): boolean | undefined {
  const { address } = useAccount();

  const enabled = Boolean(address) && snapshotBlock !== undefined;

  const { data: pastVotes } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_TOKEN_ADDRESS,
    abi: erc20Votes,
    functionName: "getPastVotes",
    args: [address as `0x${string}`, snapshotBlock ?? 0n],
    query: { enabled },
  });

  if (!enabled || pastVotes === undefined) return undefined;

  return pastVotes > 0n;
}
