import { useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { iVotesAbi } from "@/plugins/crispVoting/artifacts/iVotes";
import { PUB_CHAIN, PUB_TOKEN_ADDRESS } from "@/constants";
import { useTransactionManager } from "@/hooks/useTransactionManager";

/**
 * Delegate the connected account's voting power to a target (or to self).
 *
 * ERC20Votes grants ZERO voting power until an account delegates — holding the token is not
 * enough. This is why `createProposal` reverts with `ProposalCreationForbidden` for a holder who
 * has never delegated: the plugin gates on `getVotes`, not `balanceOf`.
 *
 * Delegation is all-or-nothing and moves no tokens: `delegate(target)` points the caller's ENTIRE
 * balance at one address, and the balance keeps tracking the wallet, so a delegate's `balanceOf`
 * never changes — only its `getVotes`. There is no partial delegation in ERC20Votes; splitting
 * power requires splitting the tokens across accounts.
 */
export function useDelegate(onSuccess?: () => void) {
  const { address } = useAccount();
  // Which address the in-flight tx delegates to, so callers can spin only the button that was
  // pressed instead of every delegate button on the page (they all share this one tx manager).
  const [pendingTarget, setPendingTarget] = useState<Address | undefined>();

  const clearPending = () => setPendingTarget(undefined);

  const { writeContract, isConfirming, isConfirmed } = useTransactionManager({
    onSuccessMessage: "Voting power delegated",
    onSuccess: () => {
      clearPending();
      onSuccess?.();
    },
    onErrorMessage: "Could not delegate voting power",
    onError: clearPending,
  });

  const delegate = (target: Address) => {
    setPendingTarget(target);
    writeContract({
      chainId: PUB_CHAIN.id,
      abi: iVotesAbi,
      address: PUB_TOKEN_ADDRESS,
      functionName: "delegate",
      args: [target],
    });
  };

  const delegateToSelf = () => {
    if (address) delegate(address);
  };

  /** True only while the pending tx is the one delegating to `target`. */
  const isDelegatingTo = (target?: Address) =>
    isConfirming && !!target && !!pendingTarget && pendingTarget.toLowerCase() === target.toLowerCase();

  return {
    delegate,
    delegateToSelf,
    isConfirming,
    isConfirmed,
    pendingTarget,
    isDelegatingTo,
    canDelegate: !!address,
  };
}
