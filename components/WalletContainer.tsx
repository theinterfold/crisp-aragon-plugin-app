import { PUB_CHAIN } from "@/constants";
import { formatHexString } from "@/utils/evm";
import { blockieDataUrl } from "@/utils/blockies";
import { MemberAvatar } from "@aragon/ods";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import classNames from "classnames";
import { useEffect } from "react";
import { http } from "viem";
import { createConfig, useAccount, useEnsName, useSwitchChain } from "wagmi";
import { mainnet } from "wagmi/chains";

const config = createConfig({
  chains: [mainnet],
  ssr: true,
  transports: {
    // ENS lives on mainnet, so it cannot come from the chain endpoint above (which points at
    // this deployment's chain). viem's default mainnet transport needs no key and a failed
    // name lookup only costs us a raw address in the UI.
    [mainnet.id]: http(undefined, { batch: true }),
  },
});

// TODO: update with ODS wallet module - [https://linear.app/aragon/issue/RD-198/create-ods-walletmodule]
const WalletContainer = () => {
  const { open } = useWeb3Modal();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const { data: ensName } = useEnsName({
    config,
    chainId: mainnet.id,
    address: address,
  });

  // Always the blockie, matching how explorers render an address (Etherscan never substitutes an
  // ENS avatar). Synchronous, so it is correct from the first paint and never swaps.
  const blockie = blockieDataUrl(address);

  useEffect(() => {
    if (!chainId) return;
    else if (chainId === PUB_CHAIN.id) return;

    switchChain({ chainId: PUB_CHAIN.id });
  }, [chainId]);

  return (
    <button
      className={classNames(
        "shrink-none flex h-12 items-center rounded-xl border border-neutral-100 bg-neutral-0 leading-tight text-neutral-500",
        "outline-none focus:outline-none focus-visible:ring focus-visible:ring-primary focus-visible:ring-offset", // focus styles
        { "px-1 md:px-0 md:pl-4 md:pr-1": isConnected },
        { "px-4": !isConnected }
      )}
      onClick={() => open()}
    >
      {isConnected && address && (
        <div className="flex items-center gap-3">
          <span className="hidden md:block">{ensName ?? formatHexString(address)}</span>
          <MemberAvatar src={blockie ?? ""} address={address} alt="Profile picture" size="md" />
        </div>
      )}

      {!isConnected && <span>Connect</span>}
    </button>
  );
};

export default WalletContainer;
