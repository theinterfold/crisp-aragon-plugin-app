import { useTokenMeta } from "@/hooks/useTokenMeta";

/**
 * Decimals of the voting token, read on-chain.
 *
 * Returns `undefined` until the read resolves — do NOT substitute a default. Decimals feed the
 * CRISP vote scaling (`10^(decimals-1)`, which must match the server's encoding), so a guessed
 * 18 silently misreports balances against a token that isn't 18. Gate rendering on `undefined`.
 */
export function useTokenDecimals(): number | undefined {
  return useTokenMeta().decimals;
}
