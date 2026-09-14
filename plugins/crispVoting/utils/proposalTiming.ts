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
  earliestVotingStartAt: number;
  recommendedVotingStartAt: number;
  votingStartAt: number;
  votingEndAt: number;
  availabilityEndsAt: number;
  minimumVotingWindow: number;
  maximumVotingWindow: number;
  configurationConflict: boolean;
  invalidStart: boolean;
  tooEarly: boolean;
  tooShort: boolean;
  tooLong: boolean;
  valid: boolean;
};

/** Calculate a fixed vote schedule from the live contract settings. */
export function calculateProposalTiming(
  duration: number,
  config: ProposalTimingConfig,
  requestedStartAt: number,
  now: number
): ProposalTiming {
  const committeeSetupWindow = config.randomnessRequestTimeout + config.sortitionSubmissionWindow + config.dkgWindow;
  const earliestVotingStartAt = now + committeeSetupWindow;
  const recommendedVotingStartAt = Math.ceil((earliestVotingStartAt + 120) / 60) * 60;
  const minimumVotingWindow = Math.max(config.pluginMinimumDuration, config.minimumVotingDuration);
  const maximumAtEarliest =
    config.maximumLifecycleDuration -
    committeeSetupWindow -
    config.availabilityFinalizationWindow -
    config.computeWindow -
    config.decryptionWindow;
  const invalidStart = !Number.isSafeInteger(requestedStartAt) || requestedStartAt <= 0;
  const votingStartAt = invalidStart ? 0 : requestedStartAt;
  const votingEndAt = votingStartAt + duration;
  const availabilityEndsAt = votingEndAt + config.availabilityFinalizationWindow;
  const maximumVotingWindow = Math.max(
    0,
    config.maximumLifecycleDuration -
      Math.max(committeeSetupWindow, votingStartAt - now) -
      config.availabilityFinalizationWindow -
      config.computeWindow -
      config.decryptionWindow
  );
  const finiteDuration = Number.isFinite(duration) && duration > 0;
  const configurationConflict = minimumVotingWindow > maximumAtEarliest;
  const tooEarly = !invalidStart && votingStartAt < earliestVotingStartAt;
  const tooShort = !finiteDuration || duration < minimumVotingWindow;
  const tooLong = finiteDuration && duration > maximumVotingWindow;

  return {
    ...config,
    committeeSetupWindow,
    earliestVotingStartAt,
    recommendedVotingStartAt,
    votingStartAt,
    votingEndAt,
    availabilityEndsAt,
    minimumVotingWindow,
    maximumVotingWindow,
    configurationConflict,
    invalidStart,
    tooEarly,
    tooShort,
    tooLong,
    valid: !invalidStart && !tooEarly && !tooShort && !tooLong && !configurationConflict,
  };
}

/** Format a timestamp for a browser-local datetime input. */
export function formatDateTimeLocal(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
