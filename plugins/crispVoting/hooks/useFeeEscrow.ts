import { useAccount, usePublicClient, useReadContracts } from "wagmi";
import { erc20Abi, type Address } from "viem";
import { useState } from "react";
import { CrispVotingAbi } from "../artifacts/CrispVoting";
import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_ENCLAVE_FEE_TOKEN_ADDRESS } from "@/constants";
import { useTransactionManager } from "@/hooks/useTransactionManager";
import { awaitSuccessfulReceipt } from "../utils/awaitReceipt";

export type FeeEscrow = {
  /** Fee-token credit escrowed in the plugin for this account (`feeCredits`). */
  credit?: bigint;
  /** Fee-token balance still in the account's wallet. */
  balance?: bigint;
  /** How much of the wallet balance the plugin is currently allowed to pull. */
  allowance?: bigint;
  symbol?: string;
  decimals?: number;
  isLoading: boolean;
  /** A deposit or withdrawal is in flight. */
  isBusy: boolean;
  /** Escrows `amount` of the fee token, approving first when the allowance is short. */
  deposit: (amount: bigint) => Promise<void>;
  /** Returns `amount` of unused credit to the wallet. */
  withdraw: (amount: bigint) => Promise<void>;
  refetch: () => void;
};

/**
 * The plugin no longer pulls the E3 fee from the caller at creation time. It debits an escrowed
 * credit balance (`feeCredits`) instead, because under the Staged Proposal Processor the caller is
 * the SPP contract — which holds no tokens — rather than the person who wanted the proposal.
 *
 * So paying for a proposal is now two steps: `deposit` the fee token into the plugin, then create.
 * Anything left over can be pulled back with `withdraw` at any time; credit is only ever spent by
 * proposals whose recorded payer is this account.
 */
export function useFeeEscrow(): FeeEscrow {
  const { address } = useAccount();
  const client = usePublicClient();
  const [isBusy, setIsBusy] = useState(false);

  const {
    data,
    isLoading,
    refetch: refetchReads,
  } = useReadContracts({
    query: { enabled: Boolean(address) },
    contracts: [
      {
        chainId: PUB_CHAIN.id,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        abi: CrispVotingAbi,
        functionName: "feeCredits",
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
        address: PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address as Address, PUB_CRISP_VOTING_PLUGIN_ADDRESS],
      },
      {
        chainId: PUB_CHAIN.id,
        address: PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "symbol",
      },
      {
        chainId: PUB_CHAIN.id,
        address: PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "decimals",
      },
    ],
  });

  const { writeContractAsync: approveWrite } = useTransactionManager({
    onSuccessMessage: "Fee token approved",
    onErrorMessage: "Could not approve the fee token",
  });

  const { writeContractAsync: depositWrite } = useTransactionManager({
    onSuccessMessage: "Fee credit deposited",
    onErrorMessage: "Could not deposit fee credit",
  });

  const { writeContractAsync: withdrawWrite } = useTransactionManager({
    onSuccessMessage: "Fee credit withdrawn",
    onErrorMessage: "Could not withdraw fee credit",
  });

  /**
   * Optional chaining on `client` would make every await below resolve to `undefined` rather than
   * fail, silently skipping the receipt waits — the UI would report success and refetch stale
   * balances while the transactions were still pending.
   */
  const requireClient = () => {
    if (!client) throw new Error("No RPC client available");
    return client;
  };

  const deposit = async (amount: bigint) => {
    if (amount <= 0n) return;

    try {
      setIsBusy(true);
      const publicClient = requireClient();
      await ensureAllowance(amount);

      const hash = await depositWrite({
        chainId: PUB_CHAIN.id,
        abi: CrispVotingAbi,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        functionName: "deposit",
        args: [amount],
      });
      await awaitSuccessfulReceipt(publicClient, hash, "The deposit");
      await refetchReads();
    } finally {
      setIsBusy(false);
    }
  };

  const withdraw = async (amount: bigint) => {
    if (amount <= 0n) return;

    try {
      setIsBusy(true);
      const publicClient = requireClient();
      const hash = await withdrawWrite({
        chainId: PUB_CHAIN.id,
        abi: CrispVotingAbi,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        functionName: "withdraw",
        args: [amount],
      });
      await awaitSuccessfulReceipt(publicClient, hash, "The withdrawal");
      await refetchReads();
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Read the allowance fresh rather than trusting the cached read: a deposit may follow an
   * approval made moments earlier in the same flow, and a stale value would send a redundant
   * (or missing) approval.
   */
  const ensureAllowance = async (amount: bigint) => {
    const publicClient = requireClient();

    const current = (await publicClient.readContract({
      address: PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address as Address, PUB_CRISP_VOTING_PLUGIN_ADDRESS],
    })) as bigint | undefined;

    if ((current ?? 0n) >= amount) return;

    // Exactly `amount`, never an unlimited allowance. The spender is an upgradeable proxy
    // (`upgradeTo` / `upgradeToAndCall` are in its ABI), so an infinite approval would remain
    // spendable by whatever implementation sits behind it later. The deposit flow always knows
    // the precise figure, so the only cost of scoping it is one approval per deposit.
    const hash = await approveWrite({
      chainId: PUB_CHAIN.id,
      abi: erc20Abi,
      address: PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
      functionName: "approve",
      args: [PUB_CRISP_VOTING_PLUGIN_ADDRESS, amount],
    });
    // A reverted approval must stop the flow: the deposit that follows would fail anyway.
    await awaitSuccessfulReceipt(publicClient, hash, "The fee-token approval");
  };

  const decimals = data?.[4]?.result as number | undefined;

  return {
    credit: data?.[0]?.result as bigint | undefined,
    balance: data?.[1]?.result as bigint | undefined,
    allowance: data?.[2]?.result as bigint | undefined,
    symbol: data?.[3]?.result as string | undefined,
    decimals: decimals === undefined ? undefined : Number(decimals),
    isLoading: Boolean(address) && isLoading,
    isBusy,
    deposit,
    withdraw,
    refetch: () => void refetchReads(),
  };
}
