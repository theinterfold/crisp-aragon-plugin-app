import { Button, InputNumber } from "@aragon/ods";
import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useFeeEscrow } from "../../hooks/useFeeEscrow";
import { PleaseWaitSpinner } from "@/components/please-wait";

/**
 * Fee-credit escrow panel.
 *
 * Creating a proposal spends credit escrowed inside the plugin, not the wallet balance — the
 * plugin cannot pull from the caller because under the Staged Proposal Processor the caller is the
 * SPP contract. The create flow tops the credit up automatically for the exact quoted fee, so this
 * panel exists for the two things it cannot do on its own: pre-funding, and getting unused credit
 * (including refunds from failed E3s) back out.
 */
export const FeeEscrowCard = () => {
  const { credit, balance, symbol, decimals, isLoading, isBusy, deposit, withdraw } = useFeeEscrow();
  const [amount, setAmount] = useState<string>("");

  // Never guess decimals: the fee token is configurable and a wrong exponent would move the
  // wrong amount by orders of magnitude.
  if (isLoading || decimals === undefined) {
    return <PleaseWaitSpinner fullMessage="Loading the fee credit" />;
  }

  const ticker = symbol ?? "tokens";
  const parsed = (() => {
    if (!amount.trim()) return 0n;
    try {
      return parseUnits(amount, decimals);
    } catch {
      return 0n;
    }
  })();

  const canDeposit = parsed > 0n && parsed <= (balance ?? 0n);
  const canWithdraw = parsed > 0n && parsed <= (credit ?? 0n);

  return (
    <div className="flex w-full flex-col gap-y-4 rounded-xl border border-neutral-100 bg-neutral-0 p-6 shadow-neutral-sm">
      <div>
        <h3 className="text-lg font-semibold text-neutral-800">Proposal fee credit</h3>
        <p className="text-sm text-neutral-500">
          Each proposal starts an encrypted vote round, which costs a fee in {ticker}. The fee is taken from credit
          escrowed here — creating a proposal tops this up automatically, and anything unused (including refunds from
          failed rounds) can be withdrawn at any time.
        </p>
      </div>

      <div className="flex gap-x-8">
        <div>
          <p className="text-sm text-neutral-500">Escrowed credit</p>
          <p className="text-xl font-semibold text-neutral-800">
            {formatUnits(credit ?? 0n, decimals)} {ticker}
          </p>
        </div>
        <div>
          <p className="text-sm text-neutral-500">Wallet balance</p>
          <p className="text-xl font-semibold text-neutral-800">
            {formatUnits(balance ?? 0n, decimals)} {ticker}
          </p>
        </div>
      </div>

      <InputNumber
        label={`Amount (${ticker})`}
        placeholder="0"
        value={amount}
        min={0}
        disabled={isBusy}
        onChange={(value) => setAmount(value ?? "")}
      />

      <div className="flex gap-x-3">
        <Button
          size="md"
          variant="primary"
          disabled={!canDeposit || isBusy}
          isLoading={isBusy}
          onClick={() => void deposit(parsed).then(() => setAmount(""))}
        >
          Deposit
        </Button>
        <Button
          size="md"
          variant="tertiary"
          disabled={!canWithdraw || isBusy}
          isLoading={isBusy}
          onClick={() => void withdraw(parsed).then(() => setAmount(""))}
        >
          Withdraw
        </Button>
      </div>
    </div>
  );
};
