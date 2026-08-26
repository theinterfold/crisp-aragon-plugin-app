import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { erc20Abi, parseAbiItem, type Address } from "viem";
import { iVotesAbi } from "@/plugins/crispVoting/artifacts/iVotes";
import { PUB_CRISP_SERVER_URL, PUB_TOKEN_ADDRESS, PUB_TOKEN_DEPLOYMENT_BLOCK } from "@/constants";
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

type Directory = { delegates: DelegateEntry[]; totalSupply: bigint };

/** The shape `/members/delegates` returns. `uint256`s arrive as decimal strings. */
type DelegatesResponse = {
  token: string;
  /** The block the voting-power reads were pinned to. */
  block: number;
  /** The `DelegateChanged` range the server actually scanned. `scanned_from` is what makes the
   *  answer checkable: anything later than the token's deployment would be missing delegates. */
  scanned_from: number;
  scanned_to: number;
  /** How far the server's own index reaches. Below `scanned_to` means it filled the rest from its
   *  upstream provider — correct either way, just slower for the first caller in a block. */
  indexed_head: number;
  total_supply: string;
  delegates: { address: string; voting_power: string }[];
};

/**
 * Ask the CRISP server for the directory it already has.
 *
 * The server indexes the token's `DelegateChanged` logs to run rounds, so the scan below is work
 * every client repeats against data the server holds. One request replaces a chunked log walk
 * from the token deployment block plus a `getVotes` multicall per 200 candidates.
 *
 * Returns `null` — never throws — whenever the server cannot answer: not configured, this token
 * not in its `INDEX_LOG_CONTRACTS` (a 404), or unreachable. The on-chain scan is the fallback in
 * every one of those cases, so the directory never depends on the server being up.
 */
async function fetchDirectoryFromServer(signal: AbortSignal): Promise<Directory | null> {
  if (!PUB_CRISP_SERVER_URL) return null;

  try {
    const response = await fetch(`${PUB_CRISP_SERVER_URL.replace(/\/$/, "")}/members/delegates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The server cannot know where this token's history starts — its own coverage begins
      // wherever IT started indexing, which without a backfill is long after the token shipped.
      // Naming the block here is what makes the answer complete: the server scans from it,
      // reaching past its index into its upstream provider for the part it has not indexed.
      body: JSON.stringify({ token: PUB_TOKEN_ADDRESS, from_block: PUB_TOKEN_DEPLOYMENT_BLOCK }),
      signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as DelegatesResponse;
    if (!Array.isArray(data?.delegates)) return null;

    // Trust it only as far as it says it scanned. A server that answered from a shorter range
    // than we asked for is missing delegates, and nothing else in the response would show it.
    if (!(data.scanned_from <= PUB_TOKEN_DEPLOYMENT_BLOCK)) return null;

    return {
      // Already ranked and zero-filtered server-side; re-sorting here would only disagree.
      delegates: data.delegates.map((entry) => ({
        address: entry.address as Address,
        votingPower: BigInt(entry.voting_power),
      })),
      totalSupply: BigInt(data.total_supply),
    };
  } catch {
    return null;
  }
}

/**
 * The delegate directory: every address ever delegated to that still holds voting power, ranked,
 * with the token's total supply for percentages.
 *
 * Served by the CRISP server's `/members/delegates` when it indexes this token — it already holds
 * the `DelegateChanged` history, so one request replaces the whole scan. Falls back to building
 * it here from chunked log scans plus a `getVotes` multicall, which is what every client did
 * before the route existed and what still runs against a server that has never seen this token.
 */
export function useDelegates() {
  const publicClient = usePublicClient();
  const [delegates, setDelegates] = useState<DelegateEntry[]>([]);
  const [totalSupply, setTotalSupply] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped to re-run the scan. Delegating changes both the SET of delegates (the target may be
  // new) and everyone's voting power, and neither is derivable from what is already on screen.
  const [reloadNonce, setReloadNonce] = useState(0);
  const hasLoadedOnce = useRef(false);

  const refetch = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    async function run() {
      if (!publicClient) return;
      try {
        // The spinner replaces the whole list, which is the right thing on first paint and the
        // wrong thing on a refresh triggered by delegating — the list would vanish and reappear.
        // Keep the stale rows visible while the new ones are fetched.
        if (!hasLoadedOnce.current) setIsLoading(true);
        setError(null);

        // The server's answer first, the chain scan only if it cannot give one. Deliberately not
        // a race: when the server can answer, the scan below is hundreds of requests nobody needs
        // to make, and starting both would spend them anyway.
        const fromServer = await fetchDirectoryFromServer(abort.signal);
        if (cancelled) return;
        if (fromServer) {
          setTotalSupply(fromServer.totalSupply);
          setDelegates(fromServer.delegates);
          hasLoadedOnce.current = true;
          return;
        }

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
        hasLoadedOnce.current = true;
      } catch {
        if (!cancelled) setError("Could not load delegates");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [publicClient, reloadNonce]);

  return { delegates, totalSupply, isLoading, error, refetch };
}
