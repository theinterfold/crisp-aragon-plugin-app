import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import type { ProposalMetadata, RawAction } from "@/utils/types";
import { useAlerts } from "@/context/Alerts";
import { PUB_APP_NAME, PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_PROJECT_URL } from "@/constants";
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

export function useCreateProposal() {
  const { push } = useRouter();
  const { addAlert } = useAlerts();
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState<string>("A new proposal");
  const [summary, setSummary] = useState<string>("The summary");
  const [description, setDescription] = useState<string>("The description");
  const [actions, setActions] = useState<RawAction[]>([]);
  const [resources, setResources] = useState<{ name: string; url: string }[]>([
    { name: PUB_APP_NAME, url: PUB_PROJECT_URL },
  ]);
  const [startDate, setStartDate] = useState<string>("");
  const [startTime, setStartTime] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");

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
  const startDateTime = useMemo(
    () => Math.floor(new Date(`${startDate}T${startTime ? startTime : "00:00:00"}`).getTime() / 1000),
    [startDate, startTime]
  );

  const endDateTime = useMemo(
    () => Math.floor(new Date(`${endDate}T${endTime ? endTime : "00:00:00"}`).getTime() / 1000),
    [endDate, endTime]
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

  // Quote against the same normalisation `submitProposal` applies, so the figure on screen is the
  // one the transaction pays. A start date already in the past is sent as 0 ("start now").
  const nowSeconds = Math.floor(Date.now() / 1000);
  const quotedStartDate = Number.isFinite(startDateTime) && startDateTime > nowSeconds ? startDateTime : 0;
  const quotedEndDate = Number.isFinite(endDateTime) ? endDateTime : 0;

  const feeQuote = useProposalFeeQuote(quotedStartDate, quotedEndDate, data);

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

    // The end date is required: the contract's `_endDate = 0` shorthand means "the earliest date
    // minDuration allows", which for a plugin configured with minDuration 0 is a vote that closes
    // in the same block. Demand an explicit, future date rather than silently creating one.
    if (!Number.isFinite(endDateTime) || endDateTime <= Math.floor(Date.now() / 1000)) {
      return addAlert("Invalid proposal dates", {
        description: "Please set an end date in the future",
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
        options: optionLabels,
      };

      const ipfsPin = await uploadToPinata(JSON.stringify(proposalMetadataJsonObject));

      // `startDateTime` was computed before the IPFS upload and possible funding transactions,
      // which together can take longer than the start delay. The contract reverts with
      // `DateOutOfBounds` if the start is even a second in the past, so re-check it here and
      // fall back to 0 — which the contract reads as "start at block.timestamp" — rather than
      // sending a stale timestamp that is guaranteed to revert.
      const buildArgs = () => {
        const now = Math.floor(Date.now() / 1000);
        // An empty date field parses to NaN, and `NaN <= now` is false — so a bare comparison
        // would pass NaN straight through to viem, which cannot encode it as `uint64`. Anything
        // missing or already past becomes 0, which the contract reads as "start at block.timestamp".
        const safeStartDateTime = Number.isFinite(startDateTime) && startDateTime > now ? startDateTime : 0;
        return [toHex(ipfsPin), actions, BigInt(safeStartDateTime), BigInt(endDateTime), data] as const;
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
    startDate,
    startTime,
    endDate,
    endTime,
    setStartDate,
    setStartTime,
    setEndDate,
    setEndTime,
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
