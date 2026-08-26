import { PUB_CRISP_SERVER_URL, PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_DEPLOYMENT_BLOCK } from "@/constants";

import type { Hex } from "viem";

/** One `ProposalCreated` event, as `/proposals` returns it. `uint256`s arrive as decimal strings. */
export type ServerProposal = {
  proposal_id: string;
  creator: string;
  start_date: number;
  end_date: number;
  /** The raw `metadata` bytes, hex-encoded — the IPFS URI before `fromHex`. */
  metadata: Hex;
  block: number;
  transaction_hash: string | null;
  /** Present only when asked for via `flags`. `undefined` means "not requested", which is not the
   *  same as `false` — rendering `false` for an unasked flag states a fact nobody established. */
  executed?: boolean;
  refund_claimed?: boolean;
};

type ProposalsResponse = {
  plugin: string;
  /** The block range the server actually scanned. Anything later than the plugin's deployment
   *  block means proposals are missing, and nothing else in the response would show it. */
  scanned_from: number;
  scanned_to: number;
  /** How far the server's own index reaches; below `scanned_to` it filled the rest upstream. */
  indexed_head: number;
  proposals: ServerProposal[];
};

/**
 * Ask the CRISP server for the plugin's proposals.
 *
 * The server watches this plugin's logs already, so one request replaces the `ProposalCreated`
 * scan from the deployment block that every client otherwise runs on every page load — and the
 * per-proposal page runs again, filtered to one id, just to recover the metadata URI.
 *
 * Returns `null` — never throws — whenever the server cannot answer: not configured, plugin not
 * served, unreachable, or an answer that does not reach back to the deployment block. Every
 * caller keeps its own log scan as the fallback, so nothing here is load-bearing.
 */
export async function fetchProposalsFromServer(
  proposalId?: bigint,
  /** Extra per-proposal facts to resolve: `"executed"`, `"refund_claimed"`. Each is another topic
   *  the server has to scan, so ask only for what you render. */
  flags: string[] = []
): Promise<ServerProposal[] | null> {
  if (!PUB_CRISP_SERVER_URL || !PUB_DEPLOYMENT_BLOCK) return null;

  try {
    const response = await fetch(`${PUB_CRISP_SERVER_URL.replace(/\/$/, "")}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plugin: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        // The server's coverage starts wherever IT began indexing, so it cannot know where this
        // plugin's history does. Naming the block is what lets it reach past its index.
        from_block: PUB_DEPLOYMENT_BLOCK,
        ...(proposalId !== undefined ? { proposal_id: proposalId.toString() } : {}),
        ...(flags.length ? { flags } : {}),
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as ProposalsResponse;
    if (!Array.isArray(data?.proposals)) return null;

    // Trust it only as far as it says it scanned. A server that answered from a shorter range is
    // missing proposals, which for a list is indistinguishable from there being none.
    if (!(data.scanned_from <= PUB_DEPLOYMENT_BLOCK)) return null;

    return data.proposals;
  } catch {
    return null;
  }
}
