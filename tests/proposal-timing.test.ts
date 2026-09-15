import { describe, expect, test } from "bun:test";
import {
  calculateProposalTiming,
  formatDateTimeLocal,
  formatDuration,
  SUGGESTED_START_BUFFER_SECONDS,
} from "../plugins/crispVoting/utils/proposalTiming";

const mainnetTiming = {
  pluginMinimumDuration: 0,
  randomnessRequestTimeout: 3_600,
  sortitionSubmissionWindow: 600,
  dkgWindow: 21_600,
  computeWindow: 604_800,
  decryptionWindow: 21_600,
  maximumLifecycleDuration: 2_592_000,
  minimumVotingDuration: 3_600,
  availabilityFinalizationWindow: 10_800,
};

const now = 1_000_000;
const earliestStart = now + 25_800;

describe("fixed proposal timing", () => {
  test("accepts the exact voting start and one-hour voting minimum", () => {
    const timing = calculateProposalTiming(3_600, mainnetTiming, earliestStart, now);

    expect(timing.valid).toBe(true);
    expect(timing.committeeSetupWindow).toBe(25_800);
    expect(timing.earliestVotingStartAt).toBe(earliestStart);
    expect(timing.votingEndAt).toBe(earliestStart + 3_600);
    expect(timing.availabilityEndsAt).toBe(earliestStart + 3_600 + 10_800);
    expect(timing.maximumVotingWindow).toBe(1_929_000);
  });

  test("rejects a requested start before the worst-case key deadline", () => {
    const timing = calculateProposalTiming(3_600, mainnetTiming, now + 7_200, now);
    expect(timing.tooEarly).toBe(true);
    expect(timing.valid).toBe(false);
    expect(calculateProposalTiming(3_600, mainnetTiming, earliestStart - 1, now).valid).toBe(false);
  });

  test("uses the configured VRF, ticket, and DKG windows", () => {
    const configuredWindows = {
      ...mainnetTiming,
      randomnessRequestTimeout: 1_200,
      sortitionSubmissionWindow: 300,
      dkgWindow: 10_800,
    };
    expect(calculateProposalTiming(3_600, configuredWindows, now + 7_200, now).tooEarly).toBe(true);
    expect(calculateProposalTiming(3_600, configuredWindows, now + 12_300, now).valid).toBe(true);
  });

  test("keeps voting end separate from Avail finalization", () => {
    const timing = calculateProposalTiming(
      5 * 86_400,
      mainnetTiming,
      earliestStart + SUGGESTED_START_BUFFER_SECONDS,
      now
    );

    expect(timing.valid).toBe(true);
    expect(timing.availabilityEndsAt - timing.votingEndAt).toBe(10_800);
    expect(timing.recommendedVotingStartAt).toBeGreaterThanOrEqual(earliestStart + SUGGESTED_START_BUFFER_SECONDS);
    expect(formatDuration(timing.availabilityFinalizationWindow)).toBe("3 hours");
  });

  test("uses the stricter plugin minimum and reduces the maximum for a later start", () => {
    const policy = { ...mainnetTiming, pluginMinimumDuration: 5 * 86_400 };
    const laterStart = earliestStart + 3_600;
    const maximum = 1_929_000 - 3_600;

    expect(calculateProposalTiming(5 * 86_400 - 1, policy, laterStart, now).tooShort).toBe(true);
    expect(calculateProposalTiming(5 * 86_400, policy, laterStart, now).valid).toBe(true);
    expect(calculateProposalTiming(maximum + 1, policy, laterStart, now).tooLong).toBe(true);
  });

  test("clamps the suggested start when less than the ten-minute buffer is available", () => {
    const minimumVotingWindow = 3_600;
    const availableStartSlack = 5 * 60;
    const tightTiming = {
      ...mainnetTiming,
      maximumLifecycleDuration:
        mainnetTiming.randomnessRequestTimeout +
        mainnetTiming.sortitionSubmissionWindow +
        mainnetTiming.dkgWindow +
        mainnetTiming.computeWindow +
        mainnetTiming.decryptionWindow +
        mainnetTiming.availabilityFinalizationWindow +
        minimumVotingWindow +
        availableStartSlack,
    };
    const timing = calculateProposalTiming(minimumVotingWindow, tightTiming, earliestStart, now);

    expect(timing.configurationConflict).toBe(false);
    expect(timing.recommendedVotingStartAt).toBe(Math.floor((earliestStart + availableStartSlack) / 60) * 60);
    expect(calculateProposalTiming(minimumVotingWindow, tightTiming, timing.recommendedVotingStartAt!, now).valid).toBe(
      true
    );
  });

  test("omits a suggested start when no whole-minute start is feasible", () => {
    const tightTiming = {
      ...mainnetTiming,
      maximumLifecycleDuration:
        mainnetTiming.randomnessRequestTimeout +
        mainnetTiming.sortitionSubmissionWindow +
        mainnetTiming.dkgWindow +
        mainnetTiming.computeWindow +
        mainnetTiming.decryptionWindow +
        mainnetTiming.availabilityFinalizationWindow +
        mainnetTiming.minimumVotingDuration,
    };
    const timing = calculateProposalTiming(tightTiming.minimumVotingDuration, tightTiming, earliestStart, now + 1);

    expect(timing.configurationConflict).toBe(false);
    expect(timing.recommendedVotingStartAt).toBeNull();
  });

  test("rejects missing dates and incompatible live settings", () => {
    expect(calculateProposalTiming(3_600, mainnetTiming, NaN, now).invalidStart).toBe(true);
    const timing = calculateProposalTiming(
      3_600,
      {
        ...mainnetTiming,
        maximumLifecycleDuration: 650_000,
      },
      earliestStart,
      now
    );

    expect(timing.configurationConflict).toBe(true);
    expect(timing.valid).toBe(false);
  });

  test("round-trips a local date input", () => {
    const formatted = formatDateTimeLocal(earliestStart);
    expect(Math.floor(new Date(formatted).getTime() / 60_000)).toBe(Math.floor(earliestStart / 60));
  });
});
