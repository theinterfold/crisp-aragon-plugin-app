import { describe, expect, test } from "bun:test";
import { calculateProposalTiming, formatDuration } from "../plugins/crispVoting/utils/proposalTiming";

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

describe("proposal timing", () => {
  test("accepts the exact mainnet minimum", () => {
    const timing = calculateProposalTiming(40_200, mainnetTiming);

    expect(timing.valid).toBe(true);
    expect(timing.committeeSetupWindow).toBe(25_800);
    expect(timing.protocolMinimumProposalDuration).toBe(40_200);
    expect(timing.maximumProposalDuration).toBe(1_965_600);
    expect(timing.guaranteedVotingDuration).toBe(3_600);
    expect(timing.votingClosesAfter).toBe(29_400);
  });

  test("rejects a duration one second below the mainnet minimum", () => {
    expect(calculateProposalTiming(40_199, mainnetTiming).valid).toBe(false);
  });

  test("shows the worst-case voting time for the five-day default", () => {
    const timing = calculateProposalTiming(5 * 86_400, mainnetTiming);

    expect(timing.guaranteedVotingDuration).toBe(395_400);
    expect(formatDuration(timing.guaranteedVotingDuration)).toBe("4 days 13 hours 50 minutes");
  });

  test("uses the stricter plugin minimum and the protocol maximum", () => {
    const policy = { ...mainnetTiming, pluginMinimumDuration: 5 * 86_400 };

    expect(calculateProposalTiming(5 * 86_400 - 1, policy).tooShort).toBe(true);
    expect(calculateProposalTiming(5 * 86_400, policy).valid).toBe(true);
    expect(calculateProposalTiming(1_965_601, policy).tooLong).toBe(true);
  });

  test("reports live settings that cannot produce a valid proposal", () => {
    const timing = calculateProposalTiming(40_200, {
      ...mainnetTiming,
      maximumLifecycleDuration: 650_000,
    });

    expect(timing.configurationConflict).toBe(true);
    expect(timing.valid).toBe(false);
  });
});
