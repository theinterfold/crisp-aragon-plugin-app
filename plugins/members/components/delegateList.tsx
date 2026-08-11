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

export function DelegateList() {
  const { address } = useAccount();
  const { delegates, totalSupply, isLoading, error } = useDelegates();
  const { delegatesTo, refetch } = useTokenVotes(address);
  const { delegate, isConfirming } = useDelegate(() => setTimeout(() => refetch(), 1000 * 2));
  const { symbol, decimals } = useTokenMeta();

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
                isLoading={isConfirming}
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
