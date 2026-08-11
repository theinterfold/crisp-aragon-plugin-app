import { AlertCard, Button } from "@aragon/ods";
import { formatUnits } from "viem";
import { useClaimRefund } from "../../hooks/useClaimRefund";
import { useFeeEscrow } from "../../hooks/useFeeEscrow";
import { AddressText } from "@/components/text/address";

/**
 * Offered when a proposal's E3 round has died: the fee paid to Interfold is refundable, and the
 * plugin routes the claim back to the recorded fee payer's escrowed credit.
 *
 * Getting there takes up to three permissionless transactions, because Interfold does not fail or
 * settle a round on its own — see `useClaimRefund`. The card shows which of them are outstanding
 * rather than offering a single "Claim" that reverts with `RefundNotCalculated`.
 *
 * The action is shown to anyone: every step only ever moves funds to the recorded payer, so a
 * bystander running it is doing the payer a favour, not taking anything.
 */
const Step = ({ done, children }: { done: boolean; children: React.ReactNode }) => (
  <li className="flex items-center gap-x-2 text-sm">
    <span aria-hidden="true" className={done ? "text-success-600" : "text-neutral-400"}>
      {done ? "✓" : "○"}
    </span>
    <span className={done ? "text-neutral-500 line-through" : "text-neutral-800"}>{children}</span>
  </li>
);

export const RefundCard = ({ proposalId, e3Id }: { proposalId: bigint; e3Id: bigint }) => {
  const {
    payer,
    isSelfPayer,
    isClaimed,
    isMarkedFailed,
    isCalculated,
    refundAmount,
    pendingSteps,
    error,
    isReady,
    isClaiming,
    claim,
  } = useClaimRefund(proposalId, e3Id);
  const { symbol, decimals } = useFeeEscrow();

  // A second claim reverts inside the refund manager, so once the on-chain `RefundClaimed` event
  // exists the action is retired rather than left to fail. `isClaimed` is undefined while the log
  // query is in flight or after it errored — treated as claimable, since hiding a real refund is
  // worse than offering one that turns out to be spent.
  if (isClaimed) {
    return (
      <div className="flex w-full flex-col gap-y-3 rounded-xl border border-neutral-100 bg-neutral-0 p-6 shadow-neutral-sm">
        <AlertCard
          variant="success"
          message="This round's fee was refunded"
          description="The E3 fee has been credited back to the proposal's fee payer, who can withdraw it from the proposal fee credit."
        />
        {payer && (
          <p className="text-sm text-neutral-500">
            Refunded to {isSelfPayer ? "you" : <AddressText bold={false}>{payer}</AddressText>}.
          </p>
        )}
      </div>
    );
  }

  const amountLabel =
    refundAmount !== undefined && refundAmount > 0n && decimals !== undefined
      ? `${formatUnits(refundAmount, decimals)} ${symbol ?? ""}`.trim()
      : null;

  return (
    <div className="flex w-full flex-col gap-y-3 rounded-xl border border-neutral-100 bg-neutral-0 p-6 shadow-neutral-sm">
      <AlertCard
        variant="info"
        message="This round's fee is refundable"
        description="The encrypted vote round could not complete, so Interfold refunds the fee it was paid. Settling it credits the fee back to whoever paid for this proposal."
      />

      <ul className="flex flex-col gap-y-1">
        <Step done={isMarkedFailed}>Record the failure on-chain</Step>
        <Step done={isCalculated}>Calculate the refund</Step>
        <Step done={false}>Credit it to the fee payer</Step>
      </ul>

      {amountLabel && <p className="text-sm text-neutral-500">Refund: {amountLabel}.</p>}

      {payer && (
        <p className="text-sm text-neutral-500">
          Goes to {isSelfPayer ? "you" : <AddressText bold={false}>{payer}</AddressText>}.
        </p>
      )}

      <p className="text-sm text-neutral-500">
        {pendingSteps > 1
          ? `Requires ${pendingSteps} transactions — none of these steps happen automatically.`
          : "Requires one transaction."}
      </p>

      {/* Settlement failures surface here rather than only in the console: several of them
          (preflight, reverted receipt) never reach the transaction manager's alerts. */}
      {error && (
        <AlertCard
          variant="critical"
          message="Could not settle the refund"
          description={`${error} Any steps that already completed are kept — retrying resumes from there.`}
        />
      )}

      <div>
        <Button
          size="md"
          variant="secondary"
          isLoading={isClaiming}
          disabled={isClaiming || !isReady}
          onClick={() => void claim()}
        >
          {isMarkedFailed ? "Settle refund" : "Mark failed and refund"}
        </Button>
      </div>
    </div>
  );
};
