import { useEffect } from "react";
import { formatUnits } from "viem";
import { useTokenMeta } from "@/hooks/useTokenMeta";
import { useAccount } from "wagmi";
import { Button } from "@aragon/ods";
import { AddressText } from "@/components/text/address";
import { PleaseWaitSpinner } from "@/components/please-wait";
import { compactNumber } from "@/utils/numbers";
import { useTokenVotes } from "@/hooks/useTokenVotes";
import { useDelegate } from "@/hooks/useDelegate";
import { useDelegates } from "../hooks/useDelegates";

/**
 * @param refreshKey - bump to re-scan the directory. The page above holds its own delegate button,
 *   and this component owns the only copy of the voting-power figures, so a delegation made up
 *   there has to reach down here or the table silently keeps showing pre-delegation numbers.
 */
export function DelegateList({ refreshKey = 0 }: { refreshKey?: number }) {
  const { address } = useAccount();
  const { delegates, totalSupply, isLoading, error, refetch: refetchDelegates } = useDelegates();
  const { delegatesTo, refetch: refetchMyVotes } = useTokenVotes(address);

  // BOTH have to be refreshed after delegating, and only the first one used to be. `delegatesTo`
  // drives the "Delegated" label on the button, while every voting-power figure in the table comes
  // from `useDelegates` — so refreshing just the former flipped the label while the numbers stayed
  // frozen at their pre-delegation values: your power still counted as yours, and the address you
  // delegated to never gained it.
  // Delayed rather than immediate: the node answering the refetch may not have the block the
  // receipt came from yet, and re-reading too early just re-reads the pre-delegation state. This
  // matters more when reads go through the CRISP server, which serves a head cached for a few
  // seconds — an instant refetch can be pinned to the block before the delegation landed.
  const onDelegated = () =>
    setTimeout(() => {
      refetchMyVotes();
      refetchDelegates();
    }, 1000 * 2);

  const { delegate, isDelegatingTo } = useDelegate(onDelegated);
  const { symbol, decimals } = useTokenMeta();

  // Skipped on mount: the hook already scans once on its own, and re-running it here would make
  // every page load pay for the directory twice.
  useEffect(() => {
    if (refreshKey > 0) refetchDelegates();
  }, [refreshKey, refetchDelegates]);

  if (isLoading) {
    return (
      <div className="py-6">
        <PleaseWaitSpinner fullMessage="Loading delegates…" />
      </div>
    );
  }
  if (error) return <p className="text-sm text-critical-600">{error}</p>;
  if (!delegates.length) {
    return <p className="text-sm text-neutral-500">No delegates yet — be the first by delegating to yourself above.</p>;
  }

  const pct = (v: bigint) => (totalSupply > 0n ? `${(Number((v * 10000n) / totalSupply) / 100).toFixed(1)}%` : "—");

  return (
    <div className="flex flex-col">
      {/* The figure is delegated voting power (`getVotes`), not a token balance: delegating to
          someone raises this number without moving any tokens into their wallet. */}
      <div className="flex items-center justify-between pb-2 text-xs text-neutral-500">
        <span>Delegate</span>
        <span>Voting power</span>
      </div>
      {delegates.map((d, i) => {
        const isYou = !!address && d.address.toLowerCase() === address.toLowerCase();
        const alreadyDelegated = !!delegatesTo && delegatesTo.toLowerCase() === d.address.toLowerCase();
        return (
          <div
            key={d.address}
            className="flex items-center justify-between gap-x-4 border-t border-neutral-100 py-3 first:border-t-0"
          >
            <div className="flex min-w-0 items-center gap-x-3">
              <span className="w-6 shrink-0 text-sm text-neutral-400">{i + 1}</span>
              <div className="min-w-0">
                <AddressText bold={false}>{d.address}</AddressText>
                {isYou && <span className="ml-2 text-xs text-primary-400">you</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-x-4">
              <div className="text-right">
                <div className="text-sm font-semibold text-neutral-800">
                  {decimals === undefined ? "—" : compactNumber(formatUnits(d.votingPower, decimals))} {symbol ?? ""}
                </div>
                <div className="text-xs text-neutral-500">{pct(d.votingPower)}</div>
              </div>
              <Button
                size="sm"
                variant="tertiary"
                isLoading={isDelegatingTo(d.address)}
                disabled={!address || alreadyDelegated}
                onClick={() => delegate(d.address)}
              >
                {alreadyDelegated ? "Delegated" : "Delegate"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
