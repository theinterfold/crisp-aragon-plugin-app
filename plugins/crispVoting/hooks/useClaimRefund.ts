import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbi, parseAbiItem, type Address } from "viem";
import { CrispVotingAbi } from "../artifacts/CrispVoting";
import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_DEPLOYMENT_BLOCK } from "@/constants";
import { useTransactionManager } from "@/hooks/useTransactionManager";
import { awaitSuccessfulReceipt } from "../utils/awaitReceipt";
import { isRefundQueryStale } from "../utils/refundQuery";
import { E3Stage } from "./useE3Status";

const refundClaimedEvent = parseAbiItem(
  "event RefundClaimed(uint256 indexed proposalId, uint256 indexed e3Id, address indexed payer, uint256 amount)"
);

const pluginAbi = parseAbi(["function interfold() view returns (address)"]);

const interfoldAbi = parseAbi([
  "function getE3Stage(uint256 e3Id) view returns (uint8)",
  "function e3RefundManager() view returns (address)",
  "function markE3Failed(uint256 e3Id) returns (uint8)",
  "function processE3Failure(uint256 e3Id)",
]);

const refundManagerAbi = parseAbi([
  "struct RefundDistribution { uint256 requesterAmount; uint256 honestNodeAmount; uint256 protocolAmount; uint256 totalSlashed; uint256 honestNodeCount; bool calculated; address feeToken; uint256 originalPayment; uint256 perNodeAmount; }",
  "function getRefundDistribution(uint256 e3Id) view returns (RefundDistribution)",
]);

/**
 * Claims the requester refund for a proposal whose E3 failed.
 *
 * Claiming is the LAST of three steps, and the first two are what make it work:
 *
 *   1. `markE3Failed(e3Id)` moves the round from its stalled stage into `Failed`. Interfold never
 *      does this itself — it is a permissionless call someone must send once a stage deadline
 *      passes, so a round whose DKG timed out days ago still reads as live until then.
 *   2. `processE3Failure(e3Id)` transfers the payment to the refund manager and calculates the
 *      distribution. Without it `claimRequesterRefund` reverts with `RefundNotCalculated`.
 *   3. `claimRefund(proposalId)` on the plugin, which credits the recorded `proposalPayer`.
 *
 * The plugin's `claimRefund` forwards straight to the refund manager with no preconditions of its
 * own, so offering step 3 alone reverts on any round that has not been through 1 and 2. This hook
 * runs whichever steps are still outstanding.
 *
 * Step 3 is permissionless by design — the refund manager only ever pays the requester (the
 * plugin), and the plugin credits the recorded payer — so the caller gains nothing by claiming on
 * someone else's behalf. Steps 1 and 2 are permissionless in Interfold for the same reason.
 */
export function useClaimRefund(proposalId: bigint | undefined, e3Id: bigint | undefined, enabled = true) {
  const { address } = useAccount();
  const client = usePublicClient();
  const [isClaiming, setIsClaiming] = useState(false);
  const [isClaimed, setIsClaimed] = useState<boolean | undefined>(undefined);

  const active = enabled && proposalId !== undefined && e3Id !== undefined;

  const { data: payer, refetch: refetchPayer } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: CrispVotingAbi,
    functionName: "proposalPayer",
    args: [proposalId ?? 0n],
    query: { enabled: active },
  });

  const { data: interfold } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: pluginAbi,
    functionName: "interfold",
    query: { enabled: active },
  });

  const interfoldAddress = interfold as Address | undefined;

  const { data: stageRaw, refetch: refetchStage } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: interfoldAddress,
    abi: interfoldAbi,
    functionName: "getE3Stage",
    args: [e3Id ?? 0n],
    query: { enabled: active && !!interfoldAddress },
  });

  const { data: refundManager } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: interfoldAddress,
    abi: interfoldAbi,
    functionName: "e3RefundManager",
    query: { enabled: active && !!interfoldAddress },
  });

  const { data: distribution, refetch: refetchDistribution } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: refundManager as Address | undefined,
    abi: refundManagerAbi,
    functionName: "getRefundDistribution",
    args: [e3Id ?? 0n],
    query: { enabled: active && !!refundManager },
  });

  const isMarkedFailed = stageRaw !== undefined && Number(stageRaw) === E3Stage.Failed;
  const isCalculated = (distribution as { calculated?: boolean } | undefined)?.calculated === true;
  const refundAmount = (distribution as { requesterAmount?: bigint } | undefined)?.requesterAmount;

  /**
   * Identity of the newest status query, and the proposal currently on screen.
   * See `isRefundQueryStale` for why both are checked.
   */
  const latestQuery = useRef(0);
  const activeProposalId = useRef<bigint | undefined>(proposalId);

  const checkClaimed = useCallback(async () => {
    if (!client || proposalId === undefined) return;

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
    activeProposalId.current = proposalId;
    latestQuery.current += 1;
    setIsClaimed(undefined);

    if (!active) return;
    void checkClaimed();
  }, [active, proposalId, checkClaimed]);

  const { writeContractAsync: markFailedWrite } = useTransactionManager({
    onSuccessMessage: "Round marked as failed",
    onErrorMessage: "Could not mark the round as failed",
  });

  const { writeContractAsync: processFailureWrite } = useTransactionManager({
    onSuccessMessage: "Refund calculated",
    onErrorMessage: "Could not calculate the refund",
  });

  const { writeContractAsync: claimWrite } = useTransactionManager({
    onSuccessMessage: "Refund claimed",
    onSuccessDescription: "The E3 fee has been credited back to the proposal's fee payer",
    onErrorMessage: "Could not claim the refund",
  });

  const claim = async () => {
    if (proposalId === undefined || e3Id === undefined) return;

    try {
      setIsClaiming(true);
      if (!client) throw new Error("No RPC client available");
      if (!interfoldAddress) throw new Error("Interfold address unavailable");

      if (!isMarkedFailed) {
        const hash = await markFailedWrite({
          chainId: PUB_CHAIN.id,
          abi: interfoldAbi,
          address: interfoldAddress,
          functionName: "markE3Failed",
          args: [e3Id],
        });
        await awaitSuccessfulReceipt(client, hash, "Marking the round as failed");
        await refetchStage();
      }

      if (!isCalculated) {
        const hash = await processFailureWrite({
          chainId: PUB_CHAIN.id,
          abi: interfoldAbi,
          address: interfoldAddress,
          functionName: "processE3Failure",
          args: [e3Id],
        });
        await awaitSuccessfulReceipt(client, hash, "Calculating the refund");
        await refetchDistribution();
      }

      const hash = await claimWrite({
        chainId: PUB_CHAIN.id,
        abi: CrispVotingAbi,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        functionName: "claimRefund",
        args: [proposalId],
      });
      await awaitSuccessfulReceipt(client, hash, "The refund claim");
      await Promise.all([refetchPayer(), refetchDistribution(), checkClaimed()]);
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
    /** The round is already in the `Failed` stage on-chain. */
    isMarkedFailed,
    /** The refund distribution has been calculated, so a claim can settle. */
    isCalculated,
    /** How much the requester is owed, once calculated. */
    refundAmount,
    /** How many transactions `claim()` will send from the current state. */
    pendingSteps: (isMarkedFailed ? 0 : 1) + (isCalculated ? 0 : 1) + 1,
    isClaiming,
    claim,
  };
}
