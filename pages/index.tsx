import { Button } from "@aragon/ods";
import { useAccount } from "wagmi";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import Link from "next/link";
import { plugins } from "@/plugins";
import { PUB_CRISP_INFO_URL } from "@/constants";

export default function StandardHome() {
  const { isConnected } = useAccount();
  const { open } = useWeb3Modal();

  const proposalsHref = `/plugins/${plugins[0]?.id ?? "crisp-token-voting"}/#/`;

  return (
    <section className="mint-slab">
      <div className="mx-auto w-full max-w-screen-xl px-6 py-20">
        {/* Serif marquee hero */}
        <div className="serif-hero">
          <div className="rail">
            <span className="num">№ 01</span>
            <span className="vline" />
            <span className="label">
              Secret
              <br />
              ballots
            </span>
          </div>
          <h1>
            Secret ballots <span className="ital">without</span> the{" "}
            <span className="strike">
              trusted
              <svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2,16 Q60,4 120,10 T198,6" />
              </svg>
            </span>{" "}
            third party.
          </h1>
        </div>

        {/* Lede + protocol notes */}
        <div className="hero-body-grid">
          <div />
          <p className="lede">
            <span className="dropcap">C</span>RISP is a secret ballot protocol for digital decision-making, built on the
            Interfold and the Aragon OSx stack. Participants submit encrypted votes, and a committee of independent
            ciphernodes coordinates a verifiable tally without exposing individual ballots.
          </p>
          <ul className="em-list self-center">
            <li>Client-side encryption</li>
            <li>No trusted tallier</li>
            <li>Coercion resistance</li>
            <li>Verifiable public result</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="mt-14 flex flex-wrap items-center gap-3">
          {!isConnected && (
            <Button size="lg" variant="primary" onClick={() => open()}>
              Connect wallet
            </Button>
          )}
          <Link href={proposalsHref}>
            <Button size="lg" variant={isConnected ? "primary" : "tertiary"}>
              View proposals
            </Button>
          </Link>
          <a href={PUB_CRISP_INFO_URL} target="_blank" rel="noreferrer" className="hero-text-link">
            Learn how CRISP works →
          </a>
        </div>
      </div>
    </section>
  );
}
