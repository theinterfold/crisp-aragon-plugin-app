import { useRouter } from "next/router";
import { useMemo, useState } from "react";
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
  // A duration, not a pair of absolute dates.
  //
  // Voting always starts when the proposal is created (the contract reads a `_startDate` of 0 as
  // `block.timestamp`), so a start field could only ever say "now" or schedule a vote for later —
  // and scheduling was never the intent. Asking for a duration also removes a whole class of bug:
  // an absolute end date picked before an IPFS upload and a funding transaction could be in the
  // past by the time the create transaction landed, whereas a duration is resolved against the
  // clock at submit.
  const [durationValue, setDurationValue] = useState<number>(1);
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

  // Quote against the same shape `submitProposal` sends: start 0 ("start now"), end = now +
  // duration.
  //
  // `now` is rounded down to the minute rather than read raw. A value that changed on every
  // render would hand the quote hook a new key each time and refetch it in a loop; a minute-
  // resolution bucket is stable enough to hold still and close enough for a fee that scales with
  // window length.
  const nowBucket = Math.floor(Date.now() / 60_000) * 60;
  const quotedEndDate = durationSeconds > 0 ? nowBucket + durationSeconds : 0;

  const feeQuote = useProposalFeeQuote(0, quotedEndDate, data);

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

    // A duration is required: the contract's `_endDate = 0` shorthand means "the earliest date
    // minDuration allows", which for a plugin configured with minDuration 0 is a vote that closes
    // in the same block. Demand an explicit window rather than silently creating one.
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return addAlert("Invalid voting duration", {
        description: "Please set how long voting should stay open",
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

      // The end is resolved HERE, against the clock at send time, not when the form was filled in.
      // The IPFS upload and any funding transaction above can take a while, and an absolute end
      // date chosen before them could already be in the past by now — which the contract rejects
      // with `DateOutOfBounds`. A duration cannot go stale that way.
      //
      // Start is always 0: the contract reads that as `block.timestamp`, so the window opens when
      // the transaction lands rather than at a timestamp that has to be guessed ahead of it.
      const buildArgs = () => {
        const endDateTime = Math.floor(Date.now() / 1000) + durationSeconds;
        return [toHex(ipfsPin), actions, 0n, BigInt(endDateTime), data] as const;
      };

      // The plugin debits escrowed credit rather than pulling the fee from the caller, so the
      // credit has to cover the E3 quote BEFORE the create transaction is sent. `quoteFee` shows
      // the price up front and the escrow panel lets the user deposit it, but this stays as a
      // safety net: an unset start date normalises to `block.timestamp` on-chain, so the window
      // — and the fee — can move between the quote and this transaction.
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
