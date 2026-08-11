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

// The candidate set grows with every address ever delegated to, and a single multicall carrying
// all of them will eventually exceed an RPC's request, calldata or eth_call limits — at which
// point the catch below discards the entire directory. Cap how many go into one batch.
const MULTICALL_BATCH = 200;

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

        // Falling back to block 0 would scan the entire chain in 9k-block steps — thousands of
        // getLogs calls that leave the directory spinning until the RPC gives up. A missing
        // deployment block is a configuration error, so say so instead of trying.
        //
        // `isSafeInteger`, not `isFinite`: a fractional value would reach `BigInt()` and throw
        // (surfacing as the generic "Could not load delegates"), and a value past 2^53 would have
        // already lost block-number precision by the time it got here.
        if (!Number.isSafeInteger(PUB_TOKEN_DEPLOYMENT_BLOCK) || PUB_TOKEN_DEPLOYMENT_BLOCK <= 0) {
          setError("NEXT_PUBLIC_TOKEN_DEPLOYMENT_BLOCK is not a valid block number, so delegates cannot be scanned.");
          setIsLoading(false);
          return;
        }

        const latest = await publicClient.getBlockNumber();
        // The effect can be torn down while this await is pending. Everything past here writes
        // state, so a superseded run must stop before it overwrites the newer one's results.
        if (cancelled) return;

        const start = BigInt(PUB_TOKEN_DEPLOYMENT_BLOCK);

        // A deployment block past the chain head skips the loop entirely and renders an empty
        // directory as though the token simply had no delegates — misconfiguration disguised as data.
        if (start > latest) {
          setError(
            `NEXT_PUBLIC_TOKEN_DEPLOYMENT_BLOCK (${PUB_TOKEN_DEPLOYMENT_BLOCK}) is ahead of the chain head (${latest}).`
          );
          setIsLoading(false);
          return;
        }

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
        //
        // Every read below is pinned to `latest`. Left unpinned they resolve against whatever head
        // each request happens to hit, so a delegation landing mid-scan could be counted in one
        // batch and not another — producing percentages that do not sum correctly and a ranking
        // assembled from two different chain states.
        const supply = (await publicClient.readContract({
          address: PUB_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "totalSupply",
          blockNumber: latest,
        })) as bigint;

        const votes: { result?: unknown }[] = [];
        for (let i = 0; i < addrs.length; i += MULTICALL_BATCH) {
          const batch = addrs.slice(i, i + MULTICALL_BATCH);
          const batchVotes = (await publicClient.multicall({
            allowFailure: true,
            blockNumber: latest,
            contracts: batch.map((a) => ({
              address: PUB_TOKEN_ADDRESS,
              abi: iVotesAbi,
              functionName: "getVotes",
              args: [a],
            })) as any,
          })) as { result?: unknown }[];
          // Appended in slice order, so `votes[i]` still lines up with `addrs[i]` below.
          votes.push(...batchVotes);
          if (cancelled) return;
        }
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
