import { useState, useEffect, useMemo, useRef } from "react";
import { useBlockNumber, useReadContract } from "wagmi";
import { CrispVotingAbi } from "../artifacts/CrispVoting";
import { PUB_CHAIN_ID, PUB_CRISP_SERVER_URL, PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_DEPLOYMENT_BLOCK } from "@/constants";
import { fetchProposalsFromServer } from "../utils/proposalsApi";
import { useMetadata } from "@/hooks/useMetadata";
import { getAbiItem, fromHex } from "viem";
import { publicClient } from "../utils/client";

import type { RawAction, ProposalMetadata } from "@/utils/types";
import type { IRoundDetailsResponse, Proposal, Tally } from "../utils/types";
import type { AbiEvent, Hex } from "viem";
import { CreditsMode } from "../utils/types";
import { crispSdk } from "../utils/crispSdk";
import { useE3Status } from "./useE3Status";

type ProposalCreatedLogResponse = {
  args: {
    actions: RawAction[];
    allowFailureMap: bigint;
    creator: string;
    endDate: bigint;
    startDate: bigint;
    metadata: string;
    proposalId: bigint;
  };
};

export const ProposalCreatedEvent = getAbiItem({
  abi: CrispVotingAbi,
  name: "ProposalCreated",
}) as AbiEvent;

export function useProposal(proposalId: bigint) {
  const [creationEvent, setCreationEvent] = useState<ProposalCreatedLogResponse["args"]>();
  const [metadataUri, setMetadataUri] = useState<string>();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  // On-chain proposal data
  const {
    data: proposalResult,
    error: proposalError,
    fetchStatus: proposalFetchStatus,
  } = useReadContract({
    chainId: PUB_CHAIN_ID,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: CrispVotingAbi,
    functionName: "getProposal",
    args: [proposalId],
  });

  const [isTallied, setIsTallied] = useState(false);
  const [isCommitteeReady, setIsCommitteeReady] = useState(false);
  const [totalVotingPower, setTotalVotingPower] = useState<bigint | undefined>(undefined);

  // On-chain tally
  const { data: tallyResult, refetch: refetchTally } = useReadContract({
    chainId: PUB_CHAIN_ID,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: CrispVotingAbi,
    functionName: "getTally",
    args: [proposalId],
  });

  const proposalRaw = proposalResult as Proposal | undefined;

  // Interfold is the authority on whether a round failed, so ask it about anything not yet
  // tallied — not just rounds whose committee never formed.
  //
  // Gating on `!isCommitteeReady` (the previous behaviour) meant a round that formed its
  // committee and then died later was never checked at all: every post-DKG failure reason
  // (ComputeTimeout, ComputeProviderExpired, ComputeProviderFailed, DecryptionTimeout,
  // DecryptionInvalidShares, VerificationFailed) landed on a proposal the UI still showed as
  // healthy. A tallied round is terminal and cannot fail afterwards, so that gate stays.
  const {
    isDead: e3Failed,
    isFailurePending: e3FailurePending,
    failureReason: e3FailureReason,
  } = useE3Status(proposalRaw?.e3Id, !isTallied);

  const tally: Tally = useMemo(() => {
    if (!tallyResult) return [];
    const result = tallyResult as { counts?: bigint[] };
    return Array.isArray(result.counts) ? result.counts : [];
  }, [tallyResult]);

  // The on-chain `getTally` read fires once on mount, but the tally isn't decodable
  // until the round has finished and CRISP has published it — so a fresh page load
  // can land before it's ready and show "no votes were cast". Once the round reports
  // finished, refetch on each new block until the tally actually arrives.
  useEffect(() => {
    if (!isTallied) return;
    if (tally.length > 0) return;
    void refetchTally();
  }, [isTallied, blockNumber, tally.length, refetchTally]);

  const eligibleVotersFetched = useRef(false);

  useEffect(() => {
    if (proposalRaw?.e3Id === undefined) return;
    if (isTallied && isCommitteeReady) return;
    // Round failed on-chain (committee/DKG): no point polling the CRISP server.
    if (e3Failed) return;

    // E3 ids are namespaced (contract address in the high bits, ~1e76), so they only survive
    // as bigints.
    const roundId = proposalRaw.e3Id;

    crispSdk
      .getRoundStateLite(roundId)
      .then(async (raw) => {
        const data = raw as unknown as IRoundDetailsResponse | null;
        setIsTallied(data?.status === "Finished");
        setIsCommitteeReady(
          data
            ? data.committee_public_key.length > 0 && (data.status === "Active" || data.status === "Finished")
            : false
        );

        if (data && data.credit_mode === CreditsMode.CONSTANT && data.credits && !eligibleVotersFetched.current) {
          eligibleVotersFetched.current = true;
          const voters = await crispSdk.getEligibleAddresses(roundId);
          setTotalVotingPower(BigInt(data.credits) * BigInt(voters.length));
        } else if (data && data.credit_mode !== CreditsMode.CONSTANT) {
          setTotalVotingPower(undefined);
        }
      })
      .catch(() => {});
  }, [proposalRaw?.e3Id, blockNumber, isTallied, isCommitteeReady, e3Failed]);

  // Fetch creation event (only once when proposal data is available)
  const snapshotBlock = proposalRaw?.parameters?.snapshotBlock;

  useEffect(() => {
    if (!snapshotBlock || !publicClient || creationEvent) return;

    void (async () => {
      // One request to the server, which already holds this plugin's log history, instead of a
      // scan from the deployment block per proposal page. Falls back to the scan when it cannot
      // answer.
      const fromServer = await fetchProposalsFromServer(proposalId);
      const match = fromServer?.[0];
      if (match) {
        setCreationEvent({
          proposalId,
          creator: match.creator as Hex,
          startDate: BigInt(match.start_date),
          endDate: BigInt(match.end_date),
          metadata: match.metadata,
        } as unknown as ProposalCreatedLogResponse["args"]);
        setMetadataUri(fromHex(match.metadata, "string"));
        return;
      }

      try {
        const logs = await publicClient.getLogs({
          address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
          event: ProposalCreatedEvent,
          args: { proposalId },
          // Use the plugin deployment block, not snapshotBlock: for proposals whose
          // voting starts in the future, snapshotBlock is a block that hasn't been
          // mined yet, so the ProposalCreated event would fall outside the range.
          fromBlock: BigInt(PUB_DEPLOYMENT_BLOCK),
        });

        if (!logs?.length) return;

        const log = logs[0] as unknown as { args: ProposalCreatedLogResponse["args"] };
        setCreationEvent(log.args);
        setMetadataUri(fromHex(log.args.metadata as Hex, "string"));
      } catch (err) {
        console.error("Could not fetch proposal creation event", err);
      }
    })();
    // `blockNumber` is included so the lookup retries on each new block until the
    // ProposalCreated event is indexed by the RPC (it may lag right after creation).
  }, [proposalId, snapshotBlock, creationEvent, blockNumber]);

  // JSON metadata
  const {
    data: metadata,
    isLoading: metadataLoading,
    error: metadataError,
  } = useMetadata<ProposalMetadata>(metadataUri);

  const proposal = useMemo(
    () => arrangeProposalData(proposalRaw, creationEvent, metadata, tally, isTallied),
    [proposalRaw, creationEvent, metadata, tally, isTallied]
  );

  return {
    proposal,
    isCommitteeReady,
    totalVotingPower,
    e3Failed,
    e3FailurePending,
    e3FailureReason,
    status: {
      proposalReady: proposalFetchStatus === "idle",
      proposalLoading: proposalFetchStatus === "fetching",
      proposalError,
      metadataReady: !metadataError && !metadataLoading && !!metadata,
      metadataLoading,
      metadataError: metadataError !== undefined,
    },
  };
}

function arrangeProposalData(
  proposalData?: Proposal,
  creationEvent?: ProposalCreatedLogResponse["args"],
  metadata?: ProposalMetadata,
  tally: Tally = [],
  isTallied = false
): Proposal | null {
  if (!proposalData) return null;

  const hasVotes = tally.some((v) => v > 0n);

  return {
    actions: proposalData.actions,
    active: proposalData.parameters.endDate > BigInt(Math.floor(Date.now() / 1000)),
    executed: proposalData.executed,
    parameters: proposalData.parameters,
    tally,
    allowFailureMap: proposalData.allowFailureMap,
    creator: creationEvent?.creator ?? "",
    title: metadata?.title ?? "",
    summary: metadata?.summary ?? "",
    description: metadata?.description ?? "",
    resources: metadata?.resources ?? [],
    e3Id: proposalData.e3Id,
    options: metadata?.options ?? ["Yes", "No"],
    numOptions: metadata?.options?.length ?? 2,
    isTallied: hasVotes || isTallied,
  };
}
