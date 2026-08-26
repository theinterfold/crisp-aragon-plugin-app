import { PUB_CHAIN, PUB_RPC_BATCH_SIZE, PUB_WEB3_ENDPOINT } from "@/constants";
import { createPublicClient, http } from "viem";

/**
 * The chain was hardcoded to `sepolia` while the rest of the app reads `NEXT_PUBLIC_CHAIN_NAME`,
 * so this client silently talked to the wrong network on any other deployment.
 */
export const publicClient = createPublicClient({
  chain: PUB_CHAIN,
  transport: http(PUB_WEB3_ENDPOINT, { batch: { batchSize: PUB_RPC_BATCH_SIZE } }),
});
