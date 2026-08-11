import { computePublicKeyCommitment, getThresholdBfvParamsSet, ThresholdBfvParamsPresetNames } from "@interfold/sdk";
import type { ThresholdBfvParamsPresetName } from "@interfold/sdk";
import { decodeAbiParameters, hexToBytes, parseAbiParameters, size, type Hex } from "viem";

/** The BFV parameters a round runs under, as published on-chain. */
export type ChainBfvParams = {
  degree: bigint;
  plaintextModulus: bigint;
  moduli: readonly bigint[];
};

/**
 * Decodes `Interfold.paramSetRegistry(paramSet)`.
 *
 * The registry holds the exact blob the E3 program is configured with — the same bytes whose
 * keccak becomes the round's `paramsHash` — so it is the authoritative statement of a round's BFV
 * parameters. Reading it beats mapping `paramSet` to a preset name by hand: the numeric index is
 * just a registry key, and nothing stops a deployment from registering different parameters under
 * it than a hardcoded table assumes.
 */
export function decodeParamSet(encoded: Hex): ChainBfvParams {
  const [[degree, plaintextModulus, moduli]] = decodeAbiParameters(
    parseAbiParameters("(uint256, uint256, uint256[], bytes)"),
    encoded
  );

  return { degree, plaintextModulus, moduli };
}

/**
 * Finds the SDK preset whose parameters match the ones the chain published.
 *
 * The commitment is computed from (degree, plaintextModulus, moduli), and the SDK takes those as a
 * named preset. Rather than assume `paramSet === 0` means `INSECURE_THRESHOLD_512`, every preset is
 * asked for its parameters and compared against the chain. A round whose parameters match no known
 * preset returns `undefined` — the caller must then refuse to validate rather than guess, since a
 * commitment computed under the wrong parameters never matches and would reject a legitimate key.
 */
/**
 * Resolved presets, keyed by parameter identity.
 *
 * Without this the enumeration runs once per candidate key, and the candidate count is
 * attacker-controlled (`publishCommitteePublicKey` is permissionless) — so a spammer could force
 * `candidates × presets` wasm parameter builds on the vote path. Parameters for a given round never
 * change, so the answer is cacheable for the lifetime of the page.
 */
const presetCache = new Map<string, ThresholdBfvParamsPresetName | undefined>();

const paramsKey = (p: ChainBfvParams) => `${p.degree}:${p.plaintextModulus}:${p.moduli.join(",")}`;

export async function resolvePresetForParams(
  params: ChainBfvParams
): Promise<ThresholdBfvParamsPresetName | undefined> {
  const key = paramsKey(params);
  if (presetCache.has(key)) return presetCache.get(key);

  for (const name of ThresholdBfvParamsPresetNames) {
    const preset = await getThresholdBfvParamsSet(name);

    const sameModuli =
      preset.moduli.length === params.moduli.length &&
      preset.moduli.every((m, i) => BigInt(m) === BigInt(params.moduli[i]));

    if (
      BigInt(preset.degree) === params.degree &&
      BigInt(preset.plaintextModulus) === params.plaintextModulus &&
      sameModuli
    ) {
      presetCache.set(key, name);
      return name;
    }
  }

  // Cached too: an unrecognised parameter set will not become recognised on a retry, and caching
  // it stops a spam of candidates from re-running the enumeration for each one.
  presetCache.set(key, undefined);
  return undefined;
}

/**
 * Whether a serialized BFV public key is the one the committee actually produced.
 *
 * `CommitteePublished.publicKey` — and equally the key the CRISP server hands out — is an untrusted
 * transport value. The authority is the on-chain `pkCommitment`, which is bound to the verified DKG
 * proof and can only be written once. Encrypting to an unverified key lets whoever supplied it
 * decrypt the ballot, which defeats the point of a secret vote, so this must pass before a vote is
 * encrypted.
 *
 * The comparison is deliberately made on the recomputed commitment rather than on the key bytes:
 * fhe.rs normalizes an internal flag when decoding threshold-aggregated keys, so a decode/re-encode
 * cycle is not a stable byte-for-byte check.
 *
 * @param publicKey The serialized key to check.
 * @param expectedCommitment The round's on-chain `committeePublicKey` (a 32-byte commitment).
 * @param params The round's BFV parameters, from `paramSetRegistry`.
 */
export async function isCommitteeKeyAuthentic(
  publicKey: Uint8Array,
  expectedCommitment: Hex,
  params: ChainBfvParams
): Promise<{ ok: boolean; reason?: string }> {
  if (publicKey.length === 0) {
    return { ok: false, reason: "The committee public key is empty." };
  }

  const expected = hexToBytes32(expectedCommitment);
  if (!expected) {
    return { ok: false, reason: "The round has no committee key commitment on-chain yet." };
  }

  const preset = await resolvePresetForParams(params);
  if (!preset) {
    return {
      ok: false,
      reason: "This round's encryption parameters do not match any parameter set this app can verify.",
    };
  }

  // `computePublicKeyCommitment` THROWS on bytes that are not a decodable BFV key ("Error
  // deserializing public key: Protobuf error"), it does not return a non-matching commitment.
  // Candidates come from a permissionless event, so a single junk blob would otherwise abort the
  // whole search and make voting impossible for everyone — a rejected candidate must be an
  // ordinary "no", not an exception.
  let actual: Uint8Array;
  try {
    actual = await computePublicKeyCommitment(publicKey, preset);
  } catch {
    return { ok: false, reason: "The committee public key is not a valid BFV key." };
  }

  const matches = actual.length === expected.length && actual.every((byte, i) => byte === expected[i]);

  return matches
    ? { ok: true }
    : {
        ok: false,
        reason: "The committee public key does not match the commitment recorded on-chain.",
      };
}

/**
 * Parses a 32-byte hex commitment, rejecting the unset (all-zero) value.
 *
 * Decoding is viem's, not hand-rolled: a per-byte `Number.parseInt` yields `NaN` on non-hex input,
 * and assigning `NaN` into a `Uint8Array` silently stores `0`. Any 64-character garbage would
 * therefore have decoded to 32 zero bytes — and the all-zero guard used to run on the STRING, so it
 * would not have caught it either. The guard now runs on the decoded bytes.
 */
function hexToBytes32(value: Hex): Uint8Array | undefined {
  let decoded: Uint8Array;
  try {
    if (size(value) !== 32) return undefined;
    decoded = hexToBytes(value);
  } catch {
    return undefined;
  }

  if (decoded.every((byte) => byte === 0)) return undefined;

  return decoded;
}
