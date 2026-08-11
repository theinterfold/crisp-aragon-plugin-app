import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbiItem, type Address } from "viem";
import { CrispVotingAbi } from "../artifacts/CrispVoting";
import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_DEPLOYMENT_BLOCK } from "@/constants";
import { useTransactionManager } from "@/hooks/useTransactionManager";
import { awaitSuccessfulReceipt } from "../utils/awaitReceipt";
import { isRefundQueryStale } from "../utils/refundQuery";

const refundClaimedEvent = parseAbiItem(
  "event RefundClaimed(uint256 indexed proposalId, uint256 indexed e3Id, address indexed payer, uint256 amount)"
);

/**
 * Claims the requester refund for a proposal whose E3 failed.
 *
 * `claimRefund` is permissionless on purpose — the refund manager only ever pays the requester
 * (the plugin), and the plugin credits it to the recorded `proposalPayer`, so the caller gains
 * nothing by claiming on someone else's behalf. The UI still surfaces who gets the credit, since
 * the person who paid is not necessarily the person looking at the proposal (under the SPP the
 * payer is the parent proposal's creator).
 *
 * Whether a refund was already taken has no getter on the plugin — the refund manager owns that
 * state. The `RefundClaimed` event is the durable record, so it is what decides whether to offer
 * the button; local state alone would re-offer an already-spent claim after any page reload, and
 * the second attempt reverts inside the refund manager.
 */
export function useClaimRefund(proposalId: bigint | undefined, enabled = true) {
  const { address } = useAccount();
  const client = usePublicClient();
  const [isClaiming, setIsClaiming] = useState(false);
  const [isClaimed, setIsClaimed] = useState<boolean | undefined>(undefined);

  const active = enabled && proposalId !== undefined;

  const { data: payer, refetch: refetchPayer } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: CrispVotingAbi,
    functionName: "proposalPayer",
    args: [proposalId ?? 0n],
    query: { enabled: active },
  });

  /**
   * Identity of the newest status query, and the proposal currently on screen. `isRefundQueryStale`
   * checks a finished query against both before it is allowed to write state.
   *
   * Refs rather than a per-call "is this stale?" argument: the argument form defaults to "never
   * stale", so any caller that forgets to pass one silently loses the guard — which is exactly how
   * the refresh inside `claim` ended up unprotected.
   */
  const latestQuery = useRef(0);
  const activeProposalId = useRef<bigint | undefined>(proposalId);

  const checkClaimed = useCallback(async () => {
    if (!client || proposalId === undefined) return;

    // Captured, not read at completion time: this closure belongs to whichever proposal was
    // current when it was created, which is not necessarily the one on screen when it finishes.
    const query = { id: ++latestQuery.current, proposalId };
    const isStale = () =>
      isRefundQueryStale(query, { latestId: latestQuery.current, activeProposalId: activeProposalId.current });

    try {
      const logs = await client.getLogs({
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        event: refundClaimedEvent,
        args: { proposalId },
        fromBlock: BigInt(PUB_DEPLOYMENT_BLOCK),
        toBlock: "latest",
      });
      if (isStale()) return;
      setIsClaimed(logs.length > 0);
    } catch {
      // Leave `isClaimed` undefined: the card treats "unknown" as claimable rather than hiding a
      // legitimate refund because a log query failed.
      if (isStale()) return;
      setIsClaimed(undefined);
    }
  }, [client, proposalId]);

  useEffect(() => {
    // Clear the previous proposal's answer immediately. Without this the card would keep showing
    // proposal A's "already refunded" state while B's query is still in flight. Moving the active
    // proposal and bumping the id together retires everything issued for the proposal just left.
    activeProposalId.current = proposalId;
    latestQuery.current += 1;
    setIsClaimed(undefined);

    if (!active) return;
    void checkClaimed();
  }, [active, proposalId, checkClaimed]);

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
      if (!client) throw new Error("No RPC client available");

      const hash = await writeContractAsync({
        chainId: PUB_CHAIN.id,
        abi: CrispVotingAbi,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        functionName: "claimRefund",
        args: [proposalId],
      });
      await awaitSuccessfulReceipt(client, hash, "The refund claim");
      await Promise.all([refetchPayer(), checkClaimed()]);
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
    /** True once a `RefundClaimed` event exists for this proposal; undefined while unknown. */
    isClaimed,
    isClaiming,
    claim,
  };
}
