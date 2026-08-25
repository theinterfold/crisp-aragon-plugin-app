import { PUB_RPC_BATCH_SIZE, PUB_WEB3_ENDPOINT } from "@/constants";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(PUB_WEB3_ENDPOINT, { batch: { batchSize: PUB_RPC_BATCH_SIZE } }),
});
