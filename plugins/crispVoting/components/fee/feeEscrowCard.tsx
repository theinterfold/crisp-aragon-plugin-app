import { AlertCard, Button } from "@aragon/ods";
import { formatUnits } from "viem";
import { useFeeEscrow } from "../../hooks/useFeeEscrow";
import type { ProposalFeeQuote } from "../../hooks/useProposalFeeQuote";
import { PleaseWaitSpinner } from "@/components/please-wait";

/** Trims the trailing zeros `formatUnits` leaves on a 6-decimal token ("13.958450" -> "13.9585"). */
function formatAmount(value: bigint, decimals: number): string {
  const full = formatUnits(value, decimals);
  if (!full.includes(".")) return full;

  const trimmed = full.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  return trimmed;
}

/**
 * Fee-credit escrow panel.
 *
 * Creating a proposal spends credit escrowed inside the plugin, not the wallet balance — the
 * plugin cannot pull from the caller because under the Staged Proposal Processor the caller is the
 * SPP contract. Since `quoteFee` tells us the exact price, the amounts are never typed: the deposit
 * button carries the precise shortfall and the withdraw button returns the whole remaining credit.
 */
export const FeeEscrowCard = ({ quote }: { quote?: ProposalFeeQuote }) => {
  const { credit, balance, symbol, decimals, isLoading, isBusy, error, deposit, withdraw, refetch } = useFeeEscrow();

  if (isLoading) {
    return <PleaseWaitSpinner fullMessage="Loading the fee credit" />;
  }

  // Never guess decimals: the fee token is configurable and a wrong exponent would move the wrong
  // amount by orders of magnitude. But a failed `decimals` read leaves `isLoading` false and
  // `decimals` undefined, so gating the spinner on both would spin forever with no way out — say
  // what went wrong and offer a retry instead.
  if (decimals === undefined) {
    return (
      <div className="flex w-full flex-col gap-y-3 rounded-xl border border-neutral-100 bg-neutral-0 p-6 shadow-neutral-sm">
        <AlertCard
          variant="critical"
          message="Could not read the fee token"
          description="The fee token's decimals could not be loaded, so amounts cannot be shown safely. Check your network connection and the configured fee token address."
        />
        <div>
          <Button size="md" variant="tertiary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const ticker = symbol ?? "tokens";
  const fee = quote?.fee;
  const shortfall = fee === undefined || credit === undefined ? undefined : fee > credit ? fee - credit : 0n;
  const shortOnBalance = shortfall !== undefined && shortfall > 0n && shortfall > (balance ?? 0n);
  const hasCredit = (credit ?? 0n) > 0n;

  return (
    <div className="flex w-full flex-col gap-y-4 rounded-xl border border-neutral-100 bg-neutral-0 p-6 shadow-neutral-sm">
      <div>
        <h3 className="text-lg font-semibold text-neutral-800">Proposal fee credit</h3>
        <p className="text-sm text-neutral-500">
          Each proposal starts an encrypted vote round, which costs a fee in {ticker}. The fee is taken from credit
          escrowed here; anything unused (including refunds from failed rounds) can be withdrawn at any time.
        </p>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <p className="text-sm text-neutral-500">This proposal costs</p>
          <p className="text-xl font-semibold text-neutral-800">
            {quote?.isLoading ? "…" : fee === undefined ? "—" : `${formatAmount(fee, decimals)} ${ticker}`}
          </p>
        </div>
        <div>
          <p className="text-sm text-neutral-500">Escrowed credit</p>
          <p className="text-xl font-semibold text-neutral-800">
            {formatAmount(credit ?? 0n, decimals)} {ticker}
          </p>
        </div>
        <div>
          <p className="text-sm text-neutral-500">Wallet balance</p>
          <p className="text-xl font-semibold text-neutral-800">
            {formatAmount(balance ?? 0n, decimals)} {ticker}
          </p>
        </div>
      </div>

      {/* The quote reverts for the same reasons creation would, so a failure here is a real
          problem with the proposal's dates or options — worth showing before they submit. */}
      {quote?.error && !quote.isLoading && (
        <AlertCard
          variant="warning"
          message="This proposal cannot be priced yet"
          description="Check the start and end dates and the number of options — the plugin rejected these parameters."
        />
      )}

      {shortOnBalance && (
        <AlertCard
          variant="critical"
          message={`You need ${formatAmount(shortfall, decimals)} ${ticker} but hold ${formatAmount(balance ?? 0n, decimals)} ${ticker}`}
          description="Use the faucet to get more of the fee token before creating this proposal."
        />
      )}

      {shortfall === 0n && (
        <AlertCard
          variant="success"
          message="Your escrowed credit covers this proposal"
          description="No deposit needed — creating the proposal will debit the fee from your credit."
        />
      )}

      {/* Deposits and withdrawals can fail where the transaction manager never sees it — the
          client guard throws before anything is sent, and a reverted receipt is caught by
          `awaitSuccessfulReceipt` rather than by wagmi. */}
      {error && <AlertCard variant="critical" message="Transaction failed" description={error} />}

      <div className="flex flex-wrap gap-3">
        {/* The exact shortfall, not the full fee: credit left over from an earlier proposal or
            refunded from a failed round already counts towards this one. */}
        {shortfall !== undefined && shortfall > 0n && (
          <Button
            size="md"
            variant="primary"
            disabled={shortOnBalance || isBusy}
            isLoading={isBusy}
            onClick={() => void deposit(shortfall)}
          >
            Deposit {formatAmount(shortfall, decimals)} {ticker}
          </Button>
        )}

        {hasCredit && (
          <Button
            size="md"
            variant="tertiary"
            disabled={isBusy}
            isLoading={isBusy}
            onClick={() => void withdraw(credit as bigint)}
          >
            Withdraw {formatAmount(credit as bigint, decimals)} {ticker}
          </Button>
        )}
      </div>
    </div>
  );
};
