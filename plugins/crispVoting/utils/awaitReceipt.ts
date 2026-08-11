import type { Hash, PublicClient } from "viem";

/**
 * Waits for a transaction and fails if it reverted.
 *
 * `waitForTransactionReceipt` RESOLVES for reverted transactions — it only rejects on timeout or
 * transport failure — so awaiting it bare treats a revert as success. That is how a failed approval
 * would be followed by a deposit that cannot possibly work, and how a reverted deposit would report
 * "Fee credit deposited" and refetch an unchanged balance.
 *
 * @param client The public client to wait with.
 * @param hash The transaction to wait for.
 * @param action Human-readable operation name, used in the thrown message.
 */
export async function awaitSuccessfulReceipt(client: PublicClient, hash: Hash, action: string) {
  const receipt = await client.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`${action} reverted on-chain`);
  }

  return receipt;
}
