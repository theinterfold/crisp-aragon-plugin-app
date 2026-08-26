import { getChain } from "./utils/chains";

import type { Address } from "viem";
import type { ChainName } from "./utils/chains";

// Contract Addresses
export const PUB_DAO_ADDRESS = (process.env.NEXT_PUBLIC_DAO_ADDRESS ?? "") as Address;
export const PUB_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? "") as Address;
export const PUB_ENCLAVE_FEE_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_ENCLAVE_FEE_TOKEN_ADDRESS ?? "") as Address;
export const PUB_CRISP_VOTING_PLUGIN_ADDRESS = (process.env.NEXT_PUBLIC_CRISP_VOTING_PLUGIN_ADDRESS ?? "") as Address;
export const PUB_CRISP_SERVER_URL = (process.env.NEXT_PUBLIC_CRISP_SERVER_URL ?? "") as string;

export const PUB_BRIDGE_ADDRESS = (process.env.NEXT_PUBLIC_BRIDGE_ADDRESS ?? "") as Address;

export const PUBLIC_SECONDS_PER_BLOCK = Number(process.env.NEXT_PUBLIC_SECONDS_PER_BLOCK ?? 1); // ETH Mainnet block takes ~12s
export const MINIMUM_START_DELAY_IN_SECONDS = Number(process.env.NEXT_PUBLIC_MINIMUM_START_DELAY_IN_SECONDS ?? 30);

// Target chain
export const PUB_CHAIN_NAME = (process.env.NEXT_PUBLIC_CHAIN_NAME ?? "holesky") as ChainName;
export const PUB_CHAIN = getChain(PUB_CHAIN_NAME);
export const PUB_CHAIN_ID = PUB_CHAIN.id;

// Network and services
export const PUB_FAUCET_ADDRESS = (process.env.NEXT_PUBLIC_FAUCET_ADDRESS ?? "") as Address;

/**
 * Whether chain reads go to the CRISP server's read-only JSON-RPC endpoint.
 *
 * ON by default when a server is configured. It was briefly off, because the endpoint's allowlist
 * refused the account-scoped reads a wallet needs before it will sign (`eth_getTransactionCount`,
 * `eth_getBalance`, `eth_getCode` on the signer) and took every transaction down with it. Those
 * are served now, `aggregate3` is decoded to its inner targets, and the reads are rate limited
 * per caller — so the server is once again the right transport, and the only one whose provider
 * key stays off the client.
 */
export const PUB_USE_CRISP_RPC = (process.env.NEXT_PUBLIC_USE_CRISP_RPC ?? "true") !== "false";

/**
 * Explicit override for the chain transport.
 *
 * `/api/rpc/` proxies the server-only `WEB3_RPC_URL`, which is the right choice for local
 * development — but NOT for the current deployment, where a Cloudflare rule answers
 * `POST /api/rpc` with a 502 before it ever reaches Next.
 *
 * Whatever you point this at, verify it returns COMPLETE `eth_getLogs` results first. The default
 * was briefly `ethereum-sepolia-rpc.publicnode.com`, which silently omits logs it does not hold:
 * a 100-block query for a proposal's `ProposalCreated` returned nothing while the same query to a
 * keyed provider returned it. It does not error, it just answers short — so the proposal list and
 * the delegate directory would quietly render an incomplete set, and viem's `fallback` would
 * never fail over, because nothing failed.
 */
export const PUB_WEB3_RPC_OVERRIDE = process.env.NEXT_PUBLIC_WEB3_RPC_URL ?? "";

/**
 * Where viem sends chain reads.
 *
 * Deliberately a single transport rather than a `fallback` list. A second leg only helps when the
 * first one ERRORS, and the failure mode that actually bit here was a provider answering
 * confidently with less data than it should have. A wrong answer nobody can detect is worse than
 * an outage everybody can.
 */
export const PUB_WEB3_ENDPOINT =
  PUB_WEB3_RPC_OVERRIDE ||
  (PUB_USE_CRISP_RPC && PUB_CRISP_SERVER_URL ? `${PUB_CRISP_SERVER_URL.replace(/\/$/, "")}/chain/rpc` : "/api/rpc/");

/**
 * Requests per JSON-RPC batch.
 *
 * Must not exceed the CRISP server's `MAX_RPC_BATCH`, which is 64: the server executes a batch
 * sequentially, so it bounds the fan-out one request can cause, and it rejects an oversized batch
 * WHOLESALE — every call in it fails, not just the surplus. viem's `batch: true` default is 1000,
 * which a screen resolving several reads per row clears in a single tick.
 *
 * A plain hosted provider has no such limit, so this only ever costs an extra round trip there.
 */
export const PUB_RPC_BATCH_SIZE = 64;

export const PUB_WALLET_CONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID ?? "";

export const PUB_IPFS_ENDPOINTS = process.env.NEXT_PUBLIC_IPFS_ENDPOINTS ?? "";

// General
export const PUB_DEPLOYMENT_BLOCK = Number(process.env.NEXT_PUBLIC_PLUGIN_DEPLOYMENT_BLOCK ?? 0);

// The voting token is usually deployed BEFORE the plugin (and may be shared by several
// plugins), so delegate log scans must start here, not at the plugin block.
export const PUB_TOKEN_DEPLOYMENT_BLOCK = Number(
  process.env.NEXT_PUBLIC_TOKEN_DEPLOYMENT_BLOCK ?? process.env.NEXT_PUBLIC_PLUGIN_DEPLOYMENT_BLOCK ?? 0
);
export const PUB_APP_NAME = "The Interfold";
export const PUB_APP_DESCRIPTION = "DAO Voting using CRISP";
export const PUB_TOKEN_SYMBOL = "DVT";

export const PUB_PROJECT_LOGO = "/theinterfold-logo.png";
export const PUB_PROJECT_URL = process.env.NEXT_PUBLIC_PROJECT_URL ?? "https://theinterfold.com/";
export const PUB_WALLET_ICON = "https://avatars.githubusercontent.com/u/37784886";
export const PUB_BLOG_URL = "https://blog.theinterfold.com/";
export const PUB_SOCIALS_URL = "https://x.com/theinterfold";
export const PUB_CRISP_INFO_URL = process.env.NEXT_PUBLIC_CRISP_INFO_URL ?? "https://docs.theinterfold.com/";
