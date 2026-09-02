export type ProposalTimingConfig = {
  pluginMinimumDuration: number;
  randomnessRequestTimeout: number;
  sortitionSubmissionWindow: number;
  dkgWindow: number;
  computeWindow: number;
  decryptionWindow: number;
  maximumLifecycleDuration: number;
  minimumVotingDuration: number;
  availabilityFinalizationWindow: number;
};

export type ProposalTiming = ProposalTimingConfig & {
  committeeSetupWindow: number;
  protocolMinimumProposalDuration: number;
  minimumProposalDuration: number;
  maximumProposalDuration: number;
  guaranteedVotingDuration: number;
  votingClosesAfter: number;
  configurationConflict: boolean;
  tooShort: boolean;
  tooLong: boolean;
  valid: boolean;
};

/** Calculate the proposal timeline from the values enforced by the live contracts. */
export function calculateProposalTiming(duration: number, config: ProposalTimingConfig): ProposalTiming {
  const committeeSetupWindow = config.randomnessRequestTimeout + config.sortitionSubmissionWindow + config.dkgWindow;
  const protocolMinimumProposalDuration =
    committeeSetupWindow + config.minimumVotingDuration + config.availabilityFinalizationWindow;
  const minimumProposalDuration = Math.max(config.pluginMinimumDuration, protocolMinimumProposalDuration);
  const maximumProposalDuration = Math.max(
    0,
    config.maximumLifecycleDuration - config.computeWindow - config.decryptionWindow
  );
  const votingClosesAfter = Math.max(0, duration - config.availabilityFinalizationWindow);
  const guaranteedVotingDuration = Math.max(0, votingClosesAfter - committeeSetupWindow);
  const finiteDuration = Number.isFinite(duration) && duration > 0;
  const configurationConflict = minimumProposalDuration > maximumProposalDuration;
  const tooShort = !finiteDuration || duration < minimumProposalDuration;
  const tooLong = finiteDuration && duration > maximumProposalDuration;

  return {
    ...config,
    committeeSetupWindow,
    protocolMinimumProposalDuration,
    minimumProposalDuration,
    maximumProposalDuration,
    guaranteedVotingDuration,
    votingClosesAfter,
    configurationConflict,
    tooShort,
    tooLong,
    valid: !tooShort && !tooLong && !configurationConflict,
  };
}

/** Format a whole-second duration without hiding smaller nonzero units. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";

  let remaining = Math.floor(seconds);
  const units = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ] as const;
  const parts: string[] = [];

  for (const [name, size] of units) {
    const amount = Math.floor(remaining / size);
    if (amount === 0) continue;
    parts.push(`${amount} ${name}${amount === 1 ? "" : "s"}`);
    remaining -= amount * size;
    if (parts.length === 3) break;
  }

  return parts.length === 0 ? "0 seconds" : parts.join(" ");
}
