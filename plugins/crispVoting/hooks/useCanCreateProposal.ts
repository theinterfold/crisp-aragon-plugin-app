import { useAccount, useReadContracts } from "wagmi";
import { CrispVotingAbi } from "../artifacts/CrispVoting";
import { iVotesAbi } from "../artifacts/iVotes";
import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_ENCLAVE_FEE_TOKEN_ADDRESS } from "@/constants";
import { erc20Abi, zeroAddress, type Address } from "viem";

export type CanCreateProposal = {
  /** Contract-accurate: the account meets `minProposerVotingPower` in *delegated* votes. */
  canCreate: boolean;
  /** The account holds tokens but its delegated voting power is below the threshold. */
  needsDelegation: boolean;
  /** The account holds no voting tokens at all. */
  hasNoTokens: boolean;
  /** Whether the account has delegated to anyone (self or other). */
  isDelegated: boolean;
  /**
   * The account can fund no E3 fee at all: it holds none of the Interfold fee token AND has no
   * credit already escrowed in the plugin.
   */
  hasNoFeeToken: boolean;
  /** Balance of the Interfold fee token held by the account. */
  feeBalance?: bigint;
  /** Fee-token credit already escrowed in the plugin for this account. */
  feeCredit?: bigint;
  /** Still fetching on-chain state. */
  isLoading: boolean;
  votingToken?: Address;
  minProposerVotingPower?: bigint;
  votes?: bigint;
  balance?: bigint;
  refetch: () => void;
};

/**
 * Mirrors the on-chain gate in `CrispVoting.createProposal`, which checks
 * `votingToken.getVotes(sender) >= minProposerVotingPower` — i.e. *delegated*
 * voting power, NOT raw token balance. A holder who never delegated (even to
 * themselves) has `getVotes == 0` and will be rejected, so we surface that as
 * `needsDelegation` rather than a hard "cannot create".
 */
export function useCanCreateProposal(): CanCreateProposal {
  const { address } = useAccount();

  // Phase 1: read the plugin config (min power + voting token address).
  const {
    data: pluginReads,
    isLoading: pluginLoading,
    refetch: refetchPlugin,
  } = useReadContracts({
    contracts: [
      {
        chainId: PUB_CHAIN.id,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        abi: CrispVotingAbi,
        functionName: "minProposerVotingPower",
      },
      {
        chainId: PUB_CHAIN.id,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        abi: CrispVotingAbi,
        functionName: "getVotingToken",
      },
    ],
  });

  const minProposerVotingPower = pluginReads?.[0]?.result as bigint | undefined;
  const votingToken = pluginReads?.[1]?.result as Address | undefined;

  // Phase 2: read the account's delegated votes, balance and delegate on that token.
  const {
    data: tokenReads,
    isLoading: tokenLoading,
    refetch: refetchToken,
  } = useReadContracts({
    query: { enabled: Boolean(address && votingToken) },
    contracts: [
      {
        chainId: PUB_CHAIN.id,
        address: votingToken,
        abi: iVotesAbi,
        functionName: "getVotes",
        args: [address as Address],
      },
      {
        chainId: PUB_CHAIN.id,
        address: votingToken,
        abi: iVotesAbi,
        functionName: "balanceOf",
        args: [address as Address],
      },
      {
        chainId: PUB_CHAIN.id,
        address: votingToken,
        abi: iVotesAbi,
        functionName: "delegates",
        args: [address as Address],
      },
      {
        chainId: PUB_CHAIN.id,
        address: PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as Address],
      },
      {
        chainId: PUB_CHAIN.id,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        abi: CrispVotingAbi,
        functionName: "feeCredits",
        args: [address as Address],
      },
    ],
  });

  const votes = tokenReads?.[0]?.result as bigint | undefined;
  const balance = tokenReads?.[1]?.result as bigint | undefined;
  const delegate = tokenReads?.[2]?.result as Address | undefined;
  const feeBalance = tokenReads?.[3]?.result as bigint | undefined;
  const feeCredit = tokenReads?.[4]?.result as bigint | undefined;

  const isLoading = pluginLoading || (Boolean(address && votingToken) && tokenLoading);
  const isDelegated = Boolean(delegate && delegate !== zeroAddress);

  // No threshold configured => anyone connected can create.
  const noThreshold = minProposerVotingPower === 0n;

  const meetsThreshold = votes !== undefined && minProposerVotingPower !== undefined && votes >= minProposerVotingPower;

  const hasNoTokens = balance !== undefined && balance === 0n;

  // Holds enough tokens to pass the threshold, but delegated power is short —
  // self-delegation would fix it.
  const wouldPassIfDelegated =
    balance !== undefined &&
    minProposerVotingPower !== undefined &&
    balance >= minProposerVotingPower &&
    !meetsThreshold;

  // The plugin debits ESCROWED credit (`feeCredits`) for the E3 fee, not the caller's wallet.
  // The create flow tops the credit up from the wallet balance on demand, so either source is
  // enough — only an account with neither is hard-blocked.
  const hasNoFeeToken = feeBalance !== undefined && feeBalance === 0n && feeCredit !== undefined && feeCredit === 0n;

  // Refresh BOTH batches. Returning only the phase-2 refetch would leave the plugin config
  // (`minProposerVotingPower`, `getVotingToken`) stale, so a settings change would never be
  // picked up by a caller that reasonably expects this to resync every eligibility input.
  const refetch = () => {
    void refetchPlugin();
    void refetchToken();
  };

  const canCreate = Boolean(address) && (noThreshold || meetsThreshold) && !hasNoFeeToken;

  return {
    canCreate,
    needsDelegation: Boolean(address) && !canCreate && wouldPassIfDelegated,
    hasNoTokens: Boolean(address) && !canCreate && hasNoTokens,
    hasNoFeeToken: Boolean(address) && hasNoFeeToken,
    feeBalance,
    feeCredit,
    isDelegated,
    isLoading,
    votingToken,
    minProposerVotingPower,
    votes,
    balance,
    refetch,
  };
}
