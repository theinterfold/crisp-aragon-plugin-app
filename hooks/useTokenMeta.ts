import { erc20Abi } from "viem";
import { useReadContracts } from "wagmi";
import { PUB_CHAIN, PUB_TOKEN_ADDRESS } from "@/constants";

/**
 * Symbol and decimals of the voting token, read on-chain.
 *
 * Both are deliberately read rather than hardcoded: the plugin can be installed against ANY
 * IVotes token (see `TOKEN_ADDRESS` in the deploy scripts), so a baked-in symbol or an assumed
 * 18 decimals will be wrong the moment the token changes.
 *
 * `decimals` stays `undefined` until the read resolves — do NOT substitute a default. Decimals
 * feed the CRISP vote scaling (`10^(decimals-1)`, which must match the server's encoding), so a
 * guessed value silently produces wrong figures. Gate rendering on `undefined` instead.
 */
export function useTokenMeta(): { symbol: string | undefined; decimals: number | undefined } {
  const { data } = useReadContracts({
    contracts: [
      { chainId: PUB_CHAIN.id, address: PUB_TOKEN_ADDRESS, abi: erc20Abi, functionName: "symbol" },
      { chainId: PUB_CHAIN.id, address: PUB_TOKEN_ADDRESS, abi: erc20Abi, functionName: "decimals" },
    ],
  });

  const symbol = data?.[0]?.result as string | undefined;
  const decimals = data?.[1]?.result as number | undefined;

  return { symbol, decimals: decimals === undefined ? undefined : Number(decimals) };
}
