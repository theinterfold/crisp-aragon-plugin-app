import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import type { ProposalMetadata, RawAction } from "@/utils/types";
import { useAlerts } from "@/context/Alerts";
import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS } from "@/constants";
import { uploadToPinata } from "@/utils/ipfs";
import { CrispVotingAbi } from "../artifacts/CrispVoting";
import { URL_PATTERN } from "@/utils/input-values";
import { encodeAbiParameters, parseAbiParameters, toHex } from "viem";
import { useTransactionManager } from "@/hooks/useTransactionManager";
import { useAccount, usePublicClient } from "wagmi";
import { CreditsMode } from "../utils/types";
import { useFeeEscrow } from "./useFeeEscrow";
import { readInsufficientFeeCredit } from "../utils/feeCredit";
import { useProposalFeeQuote } from "./useProposalFeeQuote";
import { useProposalTiming } from "./useProposalTiming";
import { formatDateTimeLocal, formatDuration } from "../utils/proposalTiming";

const UrlRegex = new RegExp(URL_PATTERN);

/** Units a voting window may be expressed in. Minutes are kept for testnet rounds. */
export const DURATION_UNITS = ["minutes", "hours", "days"] as const;

export type DurationUnit = (typeof DURATION_UNITS)[number];

export const DURATION_UNIT_SECONDS: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
};

export function useCreateProposal() {
  const { push } = useRouter();
  const { addAlert } = useAlerts();
  const [isCreating, setIsCreating] = useState(false);
  // Empty, not seeded with sample text. Every one of these inputs already shows the same guidance
  // as a placeholder, so a real value added nothing except work: the first thing anyone did was
  // select it and delete it, and text left in by accident got published as the proposal's actual
  // title. Blank also makes the "please enter a title" checks below reachable — prefilled fields
  // meant they could never fire.
  const [title, setTitle] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [actions, setActions] = useState<RawAction[]>([]);
  // No resources by default. They are optional, but the validation below requires a name AND a
  // valid URL for every row that EXISTS — so a blank starter row could not be left alone, it had
  // to be filled in or removed. The form already renders an empty state and an "Add resource"
  // button, which is the honest way to offer something optional.
  const [resources, setResources] = useState<{ name: string; url: string }[]>([]);
  // The selected start is fixed. The duration covers voting only; Avail finalization follows it.
  const [startDateLocal, setStartDateLocal] = useState("");
  const [usingSuggestedStart, setUsingSuggestedStart] = useState(true);
  const [durationValue, setDurationValue] = useState<number>(5);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("days");

  const [numOptions, setNumOptions] = useState<number>(2);
  const [creditsMode, setCreditsMode] = useState<CreditsMode>(CreditsMode.CUSTOM);
  const [credits, setCredits] = useState<number>(0);
  const [optionLabels, setOptionLabels] = useState<string[]>(["Yes", "No"]);

  const client = usePublicClient();
  const { address: selfAddress } = useAccount();

  const { writeContractAsync: createProposalWrite } = useTransactionManager({
    onSuccessMessage: "Proposal created",
    onSuccess() {
      setTimeout(() => {
        push("#/");
        window.scroll(0, 0);
      }, 1000 * 2);
    },
    onErrorMessage: "Could not create the proposal",
    onError: () => setIsCreating(false),
  });

  const { deposit, refetch: refetchEscrow } = useFeeEscrow();

  // The dates and ballot encoding are derived here rather than inside `submitProposal` so the fee
  // quote below is computed from EXACTLY the bytes the transaction will send. A second, separate
  // encoding for display purposes could quote one price and charge another.
  const durationSeconds = useMemo(
    () => (Number.isFinite(durationValue) ? Math.trunc(durationValue) * DURATION_UNIT_SECONDS[durationUnit] : 0),
    [durationValue, durationUnit]
  );
  const votingStartAt = useMemo(() => Math.floor(new Date(startDateLocal).getTime() / 1000), [startDateLocal]);
  const proposalTiming = useProposalTiming(durationSeconds, votingStartAt);
  useEffect(() => {
    if (usingSuggestedStart && proposalTiming.timing) {
      const suggested = formatDateTimeLocal(proposalTiming.timing.recommendedVotingStartAt);
      if (suggested !== startDateLocal) setStartDateLocal(suggested);
    }
  }, [startDateLocal, usingSuggestedStart, proposalTiming.timing?.recommendedVotingStartAt]);

  const updateVotingStart = (value: string) => {
    setUsingSuggestedStart(false);
    setStartDateLocal(value);
  };

  const useSuggestedVotingStart = () => {
    setUsingSuggestedStart(true);
    if (proposalTiming.timing) {
      setStartDateLocal(formatDateTimeLocal(proposalTiming.timing.recommendedVotingStartAt));
    }
  };

  // This runs during render, so it must not throw on a half-filled form: an empty number input
  // gives NaN, and `BigInt(NaN)` is a RangeError that takes the whole page down rather than
  // failing at submit time. Non-finite values fall back to the contract's own minimums.
  const data = useMemo(
    () =>
      encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256, uint256"), [
        0n, // allowFailureMap
        BigInt(Number.isFinite(numOptions) ? Math.trunc(numOptions) : 2),
        BigInt(Number.isFinite(Number(creditsMode)) ? Math.trunc(Number(creditsMode)) : 0),
        BigInt(Number.isFinite(credits) ? Math.trunc(credits) : 0),
      ]),
    [numOptions, creditsMode, credits]
  );

  const feeQuote = useProposalFeeQuote(votingStartAt, votingStartAt + durationSeconds, data);

  const submitProposal = async () => {
    // Check metadata
    if (!title.trim()) {
      return addAlert("Invalid proposal details", {
        description: "Please enter a title",
        type: "error",
      });
    }

    if (!summary.trim()) {
      return addAlert("Invalid proposal details", {
        description: "Please enter a summary of what the proposal is about",
        type: "error",
      });
    }

    // Require an explicit voting window rather than using the plugin's zero-date shorthand.
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return addAlert("Invalid voting duration", {
        description: "Set how long people can submit ballots",
        type: "error",
      });
    }

    if (proposalTiming.isLoading) {
      return addAlert("Proposal timing is loading", {
        description: "Wait for the live protocol timing rules before you submit the proposal",
        type: "error",
      });
    }

    if (proposalTiming.error || !proposalTiming.timing) {
      return addAlert("Proposal timing is unavailable", {
        description: "The app could not verify the live protocol timing rules",
        type: "error",
      });
    }

    if (proposalTiming.timing.configurationConflict) {
      return addAlert("Protocol timing settings conflict", {
        description: "The live minimum duration is greater than the live maximum duration",
        type: "error",
      });
    }

    if (proposalTiming.timing.invalidStart) {
      return addAlert("Invalid voting start", {
        description: "Choose a valid date and time for voting to start",
        type: "error",
      });
    }

    if (proposalTiming.timing.tooEarly) {
      return addAlert("Voting starts too early", {
        description: `Committee setup can take ${formatDuration(proposalTiming.timing.committeeSetupWindow)}. Choose a later start time.`,
        type: "error",
      });
    }

    if (proposalTiming.timing.tooShort) {
      return addAlert("Voting duration is too short", {
        description: `The live contracts require at least ${formatDuration(proposalTiming.timing.minimumVotingWindow)}`,
        type: "error",
      });
    }

    if (proposalTiming.timing.tooLong) {
      return addAlert("Voting duration is too long", {
        description: `The live protocol allows at most ${formatDuration(
          proposalTiming.timing.maximumVotingWindow
        )} before compute and decryption`,
        type: "error",
      });
    }

    for (const item of resources) {
      if (!item.name.trim()) {
        return addAlert("Invalid resource name", {
          description: "Please enter a name for all the resources",
          type: "error",
        });
      } else if (!UrlRegex.test(item.url.trim())) {
        return addAlert("Invalid resource URL", {
          description: "Please enter valid URL for all the resources",
          type: "error",
        });
      }
    }

    try {
      setIsCreating(true);
      const proposalMetadataJsonObject: ProposalMetadata = {
        title,
        summary,
        description,
        resources,
        // Option labels beyond the Yes/No(/Abstain) presets are optional in the form — the input
        // shows `Option N` as a placeholder only. Resolve the blanks here so the ballot metadata
        // always carries a label for every option.
        options: optionLabels.map((label, idx) => label.trim() || `Option ${idx + 1}`),
      };

      const ipfsPin = await uploadToPinata(JSON.stringify(proposalMetadataJsonObject));

      const buildArgs = () =>
        [toHex(ipfsPin), actions, BigInt(votingStartAt), BigInt(votingStartAt + durationSeconds), data] as const;

      // The plugin debits escrowed credit rather than pulling the fee from the caller, so the
      // credit has to cover the E3 quote BEFORE the create transaction is sent. `quoteFee` shows
      // the price up front and the escrow panel lets the user deposit it, but this stays as a
      // safety net: fees or live timing settings can change after the quote.
      // Not optional-chained on purpose: `client?.simulateContract(...)` resolves to `undefined`
      // when there is no client, which reads as "the simulation passed" and skips the funding
      // check entirely — the create transaction would then revert with InsufficientFeeCredit.
      if (!client) throw new Error("No RPC client available");

      const shortfall = await client
        .simulateContract({
          account: selfAddress,
          abi: CrispVotingAbi,
          address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
          functionName: "createProposal",
          args: buildArgs(),
        })
        .then(() => undefined)
        .catch((err) => {
          const missing = readInsufficientFeeCredit(err);
          // Any other revert is a real problem with the proposal (bad dates, no voting power,
          // an Interfold-side failure) — surface it instead of masking it as a funding step.
          if (!missing) throw err;
          return missing;
        });

      if (shortfall) {
        await deposit(shortfall.missing);
        refetchEscrow();
        // Funding may take several blocks. Recheck the fixed start and the credit after it
        // confirms so an expired schedule or failed deposit does not reach the create write.
        await client.simulateContract({
          account: selfAddress,
          abi: CrispVotingAbi,
          address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
          functionName: "createProposal",
          args: buildArgs(),
        });
      }

      await createProposalWrite({
        chainId: PUB_CHAIN.id,
        abi: CrispVotingAbi,
        address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
        functionName: "createProposal",
        args: buildArgs(),
      });
    } catch (err) {
      console.error("ERR", err);
      // `createProposalWrite` and the escrow writes raise their own alerts; a failure here is
      // most likely the pre-flight simulation, which would otherwise fail silently.
      if (!(err as { message?: string })?.message?.startsWith("User rejected the request")) {
        addAlert("Could not create the proposal", {
          type: "error",
          description: (err as { shortMessage?: string })?.shortMessage ?? "The proposal would revert on-chain",
        });
      }
      setIsCreating(false);
    }
  };

  return {
    /** The E3 fee this proposal will cost, quoted from the current form values. */
    feeQuote,
    isCreating,
    title,
    summary,
    description,
    actions,
    resources,
    setTitle,
    setSummary,
    setDescription,
    setActions,
    setResources,
    submitProposal,
    durationValue,
    durationUnit,
    durationSeconds,
    startDateLocal,
    updateVotingStart,
    useSuggestedVotingStart,
    proposalTiming,
    setDurationValue,
    setDurationUnit,
    credits,
    setCredits,
    creditsMode,
    setCreditsMode,
    numOptions,
    setNumOptions,
    optionLabels,
    setOptionLabels,
  };
}
