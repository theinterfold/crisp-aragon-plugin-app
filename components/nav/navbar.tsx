import WalletContainer from "@/components/WalletContainer";
import { plugins } from "@/plugins";
import classNames from "classnames";
import Link from "next/link";
import { useState } from "react";
import { MobileNavDialog } from "./mobileNavDialog";
import { NavLink, type INavLink } from "./navLink";
import { AvatarIcon, Button, IconType, Spinner } from "@aragon/ods";
import {
  PUB_APP_NAME,
  PUB_CHAIN,
  PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
  PUB_PROJECT_LOGO,
  PUB_TOKEN_ADDRESS,
} from "@/constants";
import { useTransactionManager } from "@/hooks/useTransactionManager";
import { useAccount, useReadContract } from "wagmi";
import { iVotesAbi } from "@/plugins/crispVoting/artifacts/iVotes";
import { useAlerts } from "@/context/Alerts";

export const Navbar: React.FC = () => {
  const [showMenu, setShowMenu] = useState(false);
  const { address } = useAccount();

  const { addAlert } = useAlerts();

  const navLinks: INavLink[] = [
    { path: "/", id: "dashboard", name: "Dashboard" /*, icon: IconType.APP_DASHBOARD*/ },
    ...plugins.map((p) => ({
      id: p.id,
      name: p.title,
      path: `/plugins/${p.id}/#/`,
      // icon: p.icon,
    })),
  ];

  const { data: balanceDAO } = useReadContract({
    chainId: PUB_CHAIN.id,
    abi: iVotesAbi,
    address: PUB_TOKEN_ADDRESS,
    functionName: "balanceOf",
    args: [address!],
  });

  const { data: daoDecimals } = useReadContract({
    chainId: PUB_CHAIN.id,
    abi: iVotesAbi,
    address: PUB_TOKEN_ADDRESS,
    functionName: "decimals",
  });

  const { data: feeDecimals } = useReadContract({
    chainId: PUB_CHAIN.id,
    abi: iVotesAbi,
    address: PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
    functionName: "decimals",
  });

  const { writeContract, isConfirming } = useTransactionManager({
    onSuccessMessage: "Tokens minted",
    onErrorMessage: "Could not mint test tokens",
  });

  // Whole-token amounts each faucet click hands out. Scaled by the token's own
  // decimals at mint time (the fee token is 6-decimal USDC, the DAO token 18).
  const DAO_FAUCET_TOKENS = 1n;
  const FEE_FAUCET_TOKENS = 1000n; // ~69 proposals at the current ~14.4 fee

  const toBaseUnits = (whole: bigint, decimals: number) => whole * 10n ** BigInt(decimals);

  const mintTestTokens = () => {
    // you first need to connect your wallet
    if (!address) {
      addAlert("Wallet not connected");
      return;
    }

    // DAO voting token: only ever needed once, so mint a single token when empty.
    if (balanceDAO === 0n) {
      writeContract({
        chainId: PUB_CHAIN.id,
        abi: iVotesAbi,
        address: PUB_TOKEN_ADDRESS,
        functionName: "mint",
        args: [address, toBaseUnits(DAO_FAUCET_TOKENS, Number(daoDecimals ?? 18))],
      });
    } else {
      addAlert("You already have DAO tokens", { timeout: 1000 });
    }

    // Fee token (USDC): consumed on every proposal, so always top up on click.
    writeContract({
      chainId: PUB_CHAIN.id,
      abi: iVotesAbi,
      address: PUB_ENCLAVE_FEE_TOKEN_ADDRESS,
      functionName: "mint",
      args: [address, toBaseUnits(FEE_FAUCET_TOKENS, Number(feeDecimals ?? 6))],
    });
  };

  return (
    <>
      <nav className="h-30 sticky top-0 z-[var(--hub-navbar-z-index)] flex w-full select-none items-center justify-center border-b border-b-neutral-800 bg-neutral-50">
        <div className="w-full max-w-[1280px] flex-col gap-2 p-3 md:px-6 md:pb-0 lg:gap-3">
          <div className="flex w-full items-center justify-between">
            <div className="pb-3 lg:ml-10">
              <Link
                href="/"
                className={classNames(
                  "flex items-center gap-x-5 rounded-full py-2 md:rounded-lg",
                  "outline-none focus:outline-none focus-visible:ring focus-visible:ring-primary focus-visible:ring-offset" // focus styles
                )}
              >
                <img src={PUB_PROJECT_LOGO} width="200" className="shrink-0" alt={PUB_APP_NAME + " logo"} />
                {/* <span className="text-md leading-tight text-neutral-500">Secret ballots demo on</span>
                <img src="/logo-aragon-text.svg" alt="Aragon" className="h-6" /> */}
              </Link>
              <div className="flex items-center gap-x-2"></div>
            </div>

            <div className="flex items-center gap-x-2">
              <div className="shrink-0">
                <Button className="btn-mint" onClick={mintTestTokens}>
                  {" "}
                  {isConfirming ? <Spinner size="sm" /> : "Mint test tokens"}{" "}
                </Button>
              </div>
              <div className="shrink-0">
                <WalletContainer />
              </div>

              {/* Nav Trigger */}
              <button
                onClick={() => setShowMenu(true)}
                className={classNames(
                  "rounded-full border border-neutral-100 bg-neutral-0 p-1 md:hidden",
                  "outline-none focus:outline-none focus-visible:ring focus-visible:ring-primary focus-visible:ring-offset" // focus styles
                )}
              >
                <AvatarIcon size="lg" icon={IconType.MENU} />
              </button>
            </div>
          </div>

          {/* Tab wrapper */}
          <ul className="hidden gap-x-10 md:flex lg:pl-10">
            {navLinks.map(({ id, name, path }) => (
              <NavLink name={name} path={path} id={id} key={id} />
            ))}
          </ul>
        </div>
      </nav>
      <MobileNavDialog open={showMenu} navLinks={navLinks} onOpenChange={setShowMenu} />
    </>
  );
};
