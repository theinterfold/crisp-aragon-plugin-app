import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { useState } from "react";
import type { Address } from "viem";
import { CrispVotingAbi } from "../artifacts/CrispVoting";
import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS } from "@/constants";
import { useTransactionManager } from "@/hooks/useTransactionManager";

/**
 * Claims the requester refund for a proposal whose E3 failed.
 *
 * `claimRefund` is permissionless on purpose — the refund manager only ever pays the requester
 * (the plugin), and the plugin credits it to the recorded `proposalPayer`, so the caller gains
 * nothing by claiming on someone else's behalf. The UI still surfaces who gets the credit, since
 * the person who paid is not necessarily the person looking at the proposal (under the SPP the
 * payer is the parent proposal's creator).
 */
export function useClaimRefund(proposalId: bigint | undefined, enabled = true) {
  const { address } = useAccount();
  const client = usePublicClient();
  const [isClaiming, setIsClaiming] = useState(false);

  const active = enabled && proposalId !== undefined;

  const { data: payer, refetch: refetchPayer } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: CrispVotingAbi,
    functionName: "proposalPayer",
    args: [proposalId ?? 0n],
    query: { enabled: active },
  });

  const { writeContractAsync } = useTransactionManager({
    onSuccessMessage: "Refund claimed",
    onSuccessDescription: "The E3 fee has been credited back to the proposal's fee payer",
    onErrorMessage: "Could not claim the refund",
    onError: () => setIsClaiming(false),
  });

  const claim = async () => {
    if (proposalId === undefined) return;

    try {
      setIsClaiming(true);
      const hash = await writeContractAsync({
        chainId: PUB_CHAIN.id,
        abi: CrispVotingAbi,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        functionName: "claimRefund",
        args: [proposalId],
      });
      await client?.waitForTransactionReceipt({ hash });
      await refetchPayer();
    } finally {
      setIsClaiming(false);
    }
  };

  const payerAddress = payer as Address | undefined;

  return {
    /** The account the refund will be credited to. */
    payer: payerAddress,
    /** Whether the connected account is the one that paid for this proposal. */
    isSelfPayer: Boolean(address && payerAddress && address.toLowerCase() === payerAddress.toLowerCase()),
    isClaiming,
    claim,
  };
}
