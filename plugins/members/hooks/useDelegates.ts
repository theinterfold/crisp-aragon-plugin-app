import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { erc20Abi, parseAbiItem, type Address } from "viem";
import { iVotesAbi } from "@/plugins/crispVoting/artifacts/iVotes";
import { PUB_TOKEN_ADDRESS, PUB_TOKEN_DEPLOYMENT_BLOCK } from "@/constants";
import { ADDRESS_ZERO } from "@/utils/evm";

const delegateChangedEvent = parseAbiItem(
  "event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)"
);

// Keep each getLogs range small enough for public RPCs that cap eth_getLogs.
const CHUNK = 9_000n;

export type DelegateEntry = { address: Address; votingPower: bigint };

/**
 * Builds the delegate list from the FOLD token's DelegateChanged events (every address that
 * has ever been delegated to), then reads each one's current voting power and drops the zeros.
 * No subgraph or extra contract — just chunked log scans from the token deployment block.
 */
export function useDelegates() {
  const publicClient = usePublicClient();
  const [delegates, setDelegates] = useState<DelegateEntry[]>([]);
  const [totalSupply, setTotalSupply] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!publicClient) return;
      try {
        setIsLoading(true);
        setError(null);

        const latest = await publicClient.getBlockNumber();
        const start = BigInt(PUB_TOKEN_DEPLOYMENT_BLOCK || 0);

        // 1. Collect every address that has ever been delegated to.
        const candidates = new Set<string>();
        for (let from = start; from <= latest; from += CHUNK + 1n) {
          const to = from + CHUNK > latest ? latest : from + CHUNK;
          const logs = await publicClient.getLogs({
            address: PUB_TOKEN_ADDRESS,
            event: delegateChangedEvent,
            fromBlock: from,
            toBlock: to,
          });
          for (const log of logs) {
            const toDelegate = (log.args as { toDelegate?: Address }).toDelegate;
            if (toDelegate && toDelegate !== ADDRESS_ZERO) candidates.add(toDelegate.toLowerCase());
          }
          if (cancelled) return;
        }

        const addrs = Array.from(candidates) as Address[];

        // 2. Read the total supply (for %) and each candidate's current voting power.
        const supply = (await publicClient.readContract({
          address: PUB_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "totalSupply",
        })) as bigint;

        const votes = addrs.length
          ? ((await publicClient.multicall({
              allowFailure: true,
              contracts: addrs.map((a) => ({
                address: PUB_TOKEN_ADDRESS,
                abi: iVotesAbi,
                functionName: "getVotes",
                args: [a],
              })) as any,
            })) as { result?: unknown }[])
          : [];
        if (cancelled) return;

        const entries: DelegateEntry[] = addrs
          .map((a, i) => ({ address: a, votingPower: (votes[i]?.result as bigint | undefined) ?? 0n }))
          .filter((e) => e.votingPower > 0n)
          .sort((x, y) => (y.votingPower > x.votingPower ? 1 : y.votingPower < x.votingPower ? -1 : 0));

        setTotalSupply(supply);
        setDelegates(entries);
      } catch {
        if (!cancelled) setError("Could not load delegates");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  return { delegates, totalSupply, isLoading, error };
}
