import { useCallback } from "react";
import { usePublicClient } from "wagmi";
// viem's `hexToBytes` validates its input; a hand-rolled per-byte `Number.parseInt` yields NaN on
// malformed hex, which a `Uint8Array` silently stores as 0.
import { hexToBytes, parseAbi, parseAbiItem, type Address, type Hex } from "viem";
import { PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_DEPLOYMENT_BLOCK } from "@/constants";
import { decodeParamSet, isCommitteeKeyAuthentic, type ChainBfvParams } from "../utils/committeeKey";
import { getPastBlockNumberAtTimestamp } from "../utils/blockAtTimestamp";

const pluginAbi = parseAbi(["function interfold() view returns (address)"]);

const interfoldAbi = parseAbi([
  "struct E3 { uint256 seed; uint8 committeeSize; uint256 requestBlock; uint256[2] inputWindow; bytes32 encryptionSchemeId; address e3Program; uint8 paramSet; bytes customParams; address decryptionVerifier; address pkVerifier; bytes32 committeePublicKey; bytes32 ciphertextOutput; bytes plaintextOutput; address requester; bytes32 ciphertextCommitment; }",
  "function getE3(uint256 e3Id) view returns (E3)",
  "function paramSetRegistry(uint8 paramSet) view returns (bytes)",
  "function ciphernodeRegistry() view returns (address)",
]);

/**
 * The registry's announcement of a committee's serialized public key.
 *
 * `publicKey` here is NOT trustworthy on its own: `publishCommitteePublicKey` is permissionless and
 * accepts any blob up to 256 KB, so several candidate events can exist for one round. The registry
 * fills `pkCommitment` and `nodes` from its own storage, so those are identical across every
 * candidate and cannot be used to tell a real key from a planted one — only recomputing the
 * commitment from the key bytes can.
 */
const committeePublishedEvent = parseAbiItem(
  "event CommitteePublished(uint256 indexed e3Id, address[] nodes, bytes publicKey, bytes32 pkCommitment, bytes proof)"
);

export type CommitteeKeyResolution = {
  /** A key that matched the round's on-chain commitment. */
  key?: Uint8Array;
  /** Where the accepted key came from. */
  source?: "chain" | "server";
  /** Why no key could be accepted. */
  reason?: string;
};

/**
 * Resolves the committee public key for a round, preferring the chain.
 *
 * Candidates are read from `CommitteePublished` logs and accepted only if their recomputed BFV
 * commitment matches the round's on-chain `committeePublicKey` — which is written once, by
 * `publishCommittee`, behind a verified DKG proof. Anyone can emit a candidate, so the commitment
 * is what separates the real key from noise; without that check, reading from events would be
 * strictly worse than trusting the server.
 *
 * The CRISP server is kept as a fallback for liveness only: `publishCommitteePublicKey` is a
 * separate transaction that may never have been sent for a given round, and a key that never made
 * it on-chain is still perfectly usable once verified. The fallback is held to exactly the same
 * commitment check, so it is a change of transport, not of trust.
 */
export function useCommitteeKeyCheck(e3Id: bigint | undefined) {
  const client = usePublicClient();

  return useCallback(
    async (serverKey?: Uint8Array): Promise<CommitteeKeyResolution> => {
      if (e3Id === undefined) return { reason: "No round selected." };
      if (!client) return { reason: "No RPC client available to verify the committee key." };

      try {
        const interfold = (await client.readContract({
          address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
          abi: pluginAbi,
          functionName: "interfold",
        })) as Address;

        const e3 = (await client.readContract({
          address: interfold,
          abi: interfoldAbi,
          functionName: "getE3",
          args: [e3Id],
        })) as { paramSet: number; committeePublicKey: Hex; requestBlock: bigint };

        const encodedParams = (await client.readContract({
          address: interfold,
          abi: interfoldAbi,
          functionName: "paramSetRegistry",
          args: [e3.paramSet],
        })) as Hex;

        if (!encodedParams || encodedParams === "0x") {
          return { reason: "This round's encryption parameters are not registered on-chain." };
        }

        const params: ChainBfvParams = decodeParamSet(encodedParams);

        const fromChain = await resolveFromChain(client, interfold, e3Id, e3, params);
        if (fromChain.key) return fromChain;

        if (serverKey && serverKey.length > 0) {
          const verdict = await isCommitteeKeyAuthentic(serverKey, e3.committeePublicKey, params);
          if (verdict.ok) return { key: serverKey, source: "server" };

          return {
            reason: `${fromChain.reason ?? "No committee key was published on-chain."} The key offered by the CRISP server was rejected too: ${verdict.reason}`,
          };
        }

        return { reason: fromChain.reason ?? "No committee key could be found for this round." };
      } catch (err) {
        // Fail closed. An unverifiable key is not a key to encrypt a secret ballot to, so a read
        // or decode failure blocks the vote rather than waving it through.
        const message = (err as Error)?.message ?? "unknown error";
        return { reason: `The committee public key could not be verified (${message}).` };
      }
    },
    [client, e3Id]
  );
}

/**
 * Lower bound for the `CommitteePublished` scan, derived from the round itself.
 *
 * `e3.requestBlock` is a TIMESTAMP despite the name — Interfold assigns it `block.timestamp`
 * (`e3.requestBlock = block.timestamp`). Passing it straight to `fromBlock` asks for block ~1.8
 * billion on a chain whose head is ~11 million: no error, just no logs, silently degrading every
 * round to the server. So it is converted to a block number first.
 *
 * A round cannot be announced before it was requested, so this is a valid bound and a tighter one
 * than the configured deployment block — and, unlike that constant, it cannot be misconfigured.
 * If the conversion fails for any reason the deployment block is used instead, since a slightly
 * loose bound is only slower, whereas no bound at all would scan from genesis.
 */
async function resolveFromBlock(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  requestTimestamp: bigint
): Promise<bigint> {
  try {
    const latest = await client.getBlock({ blockTag: "latest" });
    if (latest.number === null || requestTimestamp >= latest.timestamp) return BigInt(PUB_DEPLOYMENT_BLOCK);

    return await getPastBlockNumberAtTimestamp(requestTimestamp, client, latest);
  } catch (err) {
    // Surfaced rather than swallowed: the fallback is the widest scan range, so it is the case
    // most likely to hit a provider limit, and an operator seeing slow or failing key lookups
    // needs to know the conversion was why.
    console.warn("Could not derive a block number for the round's request timestamp", err);
    return BigInt(PUB_DEPLOYMENT_BLOCK);
  }
}

/** Blocks per `eth_getLogs` call. Hosted providers commonly cap the range at 10k or fewer. */
const LOG_SCAN_CHUNK = 5_000n;

/**
 * Candidates deserialized before giving up.
 *
 * Each check runs a wasm BFV deserialization over up to 256 KB of attacker-supplied bytes on the
 * main thread, and `publishCommitteePublicKey` is permissionless — so without a cap, spamming one
 * round with events freezes the voter's tab on the vote path.
 */
const MAX_CANDIDATES = 20;

/**
 * Scans `CommitteePublished` for a candidate whose commitment matches the round's.
 *
 * Never throws: a failure here must degrade to the verified server fallback, not block the vote.
 * A single unbounded `getLogs` over `fromBlock..latest` is exactly the request hosted providers
 * reject on range or result-count limits, and letting that propagate took out voting entirely
 * while skipping the fallback that would have worked.
 */
async function resolveFromChain(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  interfold: Address,
  e3Id: bigint,
  e3: { committeePublicKey: Hex; requestBlock: bigint },
  params: ChainBfvParams
): Promise<CommitteeKeyResolution> {
  let scanned = 0;

  try {
    const registry = (await client.readContract({
      address: interfold,
      abi: interfoldAbi,
      functionName: "ciphernodeRegistry",
    })) as Address;

    const fromBlock = await resolveFromBlock(client, e3.requestBlock);
    const latest = await client.getBlockNumber();

    // Newest chunk first: the key is announced once, shortly after the committee finalises, so the
    // recent end of the range is where it is. Stopping at the first match usually means one call.
    for (let end = latest; end >= fromBlock; end -= LOG_SCAN_CHUNK) {
      const start = end - LOG_SCAN_CHUNK + 1n > fromBlock ? end - LOG_SCAN_CHUNK + 1n : fromBlock;

      const logs = await client.getLogs({
        address: registry,
        event: committeePublishedEvent,
        args: { e3Id },
        fromBlock: start,
        toBlock: end,
      });

      for (const log of logs) {
        const candidate = (log.args as { publicKey?: Hex }).publicKey;
        if (!candidate || candidate === "0x") continue;

        if (scanned >= MAX_CANDIDATES) {
          return {
            reason: `Checked the first ${MAX_CANDIDATES} published key candidates on-chain without a match.`,
          };
        }
        scanned += 1;

        // Decoded once and reused on the success path.
        const bytes = hexToBytes(candidate);
        const verdict = await isCommitteeKeyAuthentic(bytes, e3.committeePublicKey, params);
        if (verdict.ok) return { key: bytes, source: "chain" };
      }

      if (start === fromBlock) break;
    }
  } catch (err) {
    console.warn("Committee key log scan failed; falling back to the CRISP server", err);
    return { reason: "The on-chain committee key could not be read (the log query failed)." };
  }

  return scanned === 0
    ? { reason: "No committee key has been published on-chain for this round." }
    : { reason: `Checked ${scanned} published key candidate(s) on-chain, none matched the round's commitment.` };
}
