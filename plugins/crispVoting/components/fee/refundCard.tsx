import { AlertCard, Button } from "@aragon/ods";
import { useClaimRefund } from "../../hooks/useClaimRefund";
import { AddressText } from "@/components/text/address";

/**
 * Offered when a proposal's E3 round failed: the fee paid to Interfold is refundable, and the
 * plugin routes the claim straight back to the recorded fee payer's escrowed credit.
 *
 * The button is shown to anyone — the claim is permissionless and can only ever credit the payer,
 * so a bystander triggering it is a favour, not a risk. Double-claims are rejected by the refund
 * manager, which is why a failed claim surfaces as an ordinary transaction error rather than
 * being pre-empted here.
 */
export const RefundCard = ({ proposalId }: { proposalId: bigint }) => {
  const { payer, isSelfPayer, isClaiming, claim } = useClaimRefund(proposalId);

  return (
    <div className="flex w-full flex-col gap-y-3 rounded-xl border border-neutral-100 bg-neutral-0 p-6 shadow-neutral-sm">
      <AlertCard
        variant="info"
        message="This round's fee is refundable"
        description="The encrypted vote round failed, so Interfold refunds the fee it was paid. Claiming credits it back to whoever paid for this proposal."
      />
      {payer && (
        <p className="text-sm text-neutral-500">
          Refund goes to {isSelfPayer ? "you" : <AddressText bold={false}>{payer}</AddressText>}.
        </p>
      )}
      <Button size="md" variant="secondary" isLoading={isClaiming} disabled={isClaiming} onClick={() => void claim()}>
        Claim refund
      </Button>
    </div>
  );
};
