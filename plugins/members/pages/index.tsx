import { useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { Button, InputText } from "@aragon/ods";
import { formatUnits, isAddress, type Address } from "viem";
import { MainSection } from "@/components/layout/main-section";
import { MissingContentView } from "@/components/MissingContentView";
import { AddressText } from "@/components/text/address";
import { useTokenVotes } from "@/hooks/useTokenVotes";
import { useDelegate } from "@/hooks/useDelegate";
import { ADDRESS_ZERO } from "@/utils/evm";
import { compactNumber } from "@/utils/numbers";
import { useTokenMeta } from "@/hooks/useTokenMeta";
import { DelegateList } from "../components/delegateList";

export default function Delegation() {
  const { address, isConnected } = useAccount();
  const { balance, votingPower, delegatesTo, refetch } = useTokenVotes(address);
  // Refetch as soon as the receipt lands — the tx manager only fires this once the transaction is
  // confirmed on chain, so there is nothing left to wait out.
  const { delegate, delegateToSelf, isDelegatingTo } = useDelegate(refetch);
  const [target, setTarget] = useState("");

  const delegatedToSelf = !!delegatesTo && !!address && delegatesTo.toLowerCase() === address.toLowerCase();
  const notDelegated = !delegatesTo || delegatesTo === ADDRESS_ZERO;
  const targetValid = isAddress(target);
  const { symbol, decimals } = useTokenMeta();
  const fmt = (v?: bigint) =>
    decimals === undefined ? "—" : `${compactNumber(formatUnits(v ?? 0n, decimals))} ${symbol ?? ""}`;

  return (
    <MainSection narrow>
      <div className="page-head w-full">
        <div>
          <div className="kicker mb-3">Membership</div>
          <h1 className="display-title">Delegation</h1>
        </div>
      </div>

      {!isConnected || !address ? (
        <MissingContentView>Connect your wallet (top right) to view and manage your voting power.</MissingContentView>
      ) : (
        <div className="flex flex-col gap-y-6">
          <Card>
            <Row label={`${symbol ?? "Token"} balance`} value={fmt(balance)} />
            <Row label="Voting power" value={fmt(votingPower)} />
            <Row
              label="Delegating to"
              value={
                notDelegated ? (
                  "Nobody — no voting power"
                ) : delegatedToSelf ? (
                  "Yourself"
                ) : (
                  <AddressText bold={false}>{delegatesTo}</AddressText>
                )
              }
            />
          </Card>

          {/* One box, two actions: both write the same `delegate()` call and only one can be in
              flight at a time, so splitting them into separate cards only made it look like two
              unrelated flows. */}
          <Card>
            <p className="text-base font-semibold text-neutral-800">Delegate your voting power</p>
            <p className="text-sm text-neutral-500">
              Your tokens carry no voting power until they are delegated — to yourself or to someone else. Delegating
              moves no tokens and is all or nothing: your whole balance follows one address, and your balance stays in
              your wallet. Voting power applies to proposals created after you delegate.
            </p>

            <div className="flex flex-col gap-y-2 pt-1">
              <span>
                <Button
                  size="md"
                  variant="primary"
                  isLoading={isDelegatingTo(address)}
                  disabled={delegatedToSelf}
                  onClick={() => delegateToSelf()}
                >
                  {delegatedToSelf ? "Already self-delegated" : "Delegate to myself"}
                </Button>
              </span>

              <p className="pt-2 text-sm text-neutral-500">Or hand it to another address:</p>
              <InputText
                placeholder="0x… delegate address"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              <span>
                <Button
                  size="md"
                  variant="secondary"
                  isLoading={targetValid && isDelegatingTo(target as Address)}
                  disabled={!targetValid}
                  onClick={() => delegate(target as Address)}
                >
                  Delegate to this address
                </Button>
              </span>
            </div>
          </Card>

          <Card>
            <p className="text-base font-semibold text-neutral-800">Delegates</p>
            <p className="text-sm text-neutral-500">
              Addresses with active voting power. Delegate your power to any of them.
            </p>
            <DelegateList />
          </Card>
        </div>
      )}
    </MainSection>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-3 rounded-xl border border-neutral-100 bg-neutral-0 p-4 xl:p-6">{children}</div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-semibold text-neutral-800">{value}</span>
    </div>
  );
}
