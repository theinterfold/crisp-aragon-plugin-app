import { CreditsMode } from "./types";

/** The denominator used by the contract for ratio (percentage) calculations. */
export const RATIO_BASE = 100n;

/**
 * The factor by which each voter's power is divided before being submitted to
 * CRISP (see `useCrispServer`): in token (CUSTOM) credit mode each voter's power
 * is divided by `10^(decimals/2)` so the plaintext vote fits the CRISP integer
 * vote vector. CONSTANT mode submits raw credit counts and is not scaled.
 *
 * This MUST stay in sync with `CrispVoting._voteScale()` on-chain.
 */
export function voteScale(creditMode: CreditsMode | number | undefined, decimals: number): bigint {
  if (creditMode === CreditsMode.CONSTANT) return 1n;
  return 10n ** BigInt(Math.floor(decimals / 2));
}

/**
 * Whether a proposal is signaling-only (a poll) and therefore has no quorum /
 * pass-fail concept. Mirrors `CrispVoting._isSignalingOnly`: proposals with more
 * than 3 options, or CONSTANT credits, are informational polls.
 */
export function isSignalingOnly(numOptions: number, creditMode: CreditsMode | number | undefined): boolean {
  return numOptions > 3 || creditMode === CreditsMode.CONSTANT;
}

export interface QuorumInfo {
  /** Whether turnout met the quorum requirement. */
  reached: boolean;
  /** Turnout as a percentage of total voting power (0-100). */
  turnoutPct: number;
  /** Required quorum (minParticipation) as a percentage (0-100). */
  requiredPct: number;
}

/**
 * Compute quorum status, mirroring `CrispVoting._canExecute` exactly:
 *
 *   totalVotes * voteScale * RATIO_BASE >= minParticipation * totalVotingPower
 *
 * The tally is recorded in scaled vote units, so `totalVotes` is scaled back up
 * by `voteScale` to be comparable with the raw token supply (rather than dividing
 * the supply down, which would truncate).
 *
 * @param totalVotes sum of the (scaled) on-chain tally counts
 * @param totalVotingPower total voting power at the snapshot block, raw units
 *        (`getPastTotalSupply(snapshotBlock)`)
 * @param minParticipation quorum requirement as a percentage (0-100)
 */
export function computeQuorum(
  totalVotes: bigint,
  totalVotingPower: bigint,
  minParticipation: number,
  creditMode: CreditsMode | number | undefined,
  decimals: number
): QuorumInfo | null {
  if (!totalVotingPower || totalVotingPower <= 0n) return null;

  const scale = voteScale(creditMode, decimals);
  const scaledVotes = totalVotes * scale;
  const reached = scaledVotes * RATIO_BASE >= BigInt(Math.round(minParticipation)) * totalVotingPower;
  const turnoutPct = (Number(scaledVotes) / Number(totalVotingPower)) * 100;

  return { reached, turnoutPct, requiredPct: minParticipation };
}

/**
 * Convert a scaled tally count back into a human-readable token amount.
 * Reverses the `10^(decimals/2)` vote scaling and the token's own decimals:
 *   tokens = scaledCount * voteScale / 10^decimals = scaledCount / 10^(decimals - decimals/2)
 * For CONSTANT mode the tally is a raw credit count and is returned as-is.
 */
export function tallyCountToTokens(
  scaledCount: bigint,
  creditMode: CreditsMode | number | undefined,
  decimals: number
): number {
  if (creditMode === CreditsMode.CONSTANT) return Number(scaledCount);

  const shift = decimals - Math.floor(decimals / 2);
  const divisor = 10 ** shift;
  return Number(scaledCount) / divisor;
}
