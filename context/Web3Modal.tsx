import { createConfig, http } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import {
  PUB_APP_DESCRIPTION,
  PUB_APP_NAME,
  PUB_CHAIN,
  PUB_PROJECT_URL,
  PUB_WALLET_CONNECT_PROJECT_ID,
  PUB_WALLET_ICON,
  PUB_RPC_BATCH_SIZE,
  PUB_WEB3_ENDPOINT,
} from "@/constants";

// wagmi config
const metadata = {
  name: PUB_APP_NAME,
  description: PUB_APP_DESCRIPTION,
  url: PUB_PROJECT_URL,
  icons: [PUB_WALLET_ICON],
};

export const config = createConfig({
  chains: [PUB_CHAIN],
  ssr: true,
  transports: {
    [PUB_CHAIN.id]: http(PUB_WEB3_ENDPOINT, { batch: { batchSize: PUB_RPC_BATCH_SIZE } }),
  },
  connectors: [
    walletConnect({
      projectId: PUB_WALLET_CONNECT_PROJECT_ID,
      metadata,
      showQrModal: false,
    }),
  ],
});
