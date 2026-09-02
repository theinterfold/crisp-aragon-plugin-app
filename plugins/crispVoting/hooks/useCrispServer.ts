import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_TOKEN_ADDRESS } from "@/constants";
import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { CreditsMode } from "../utils/types";
import type { EligibleVoter, IRoundDetailsResponse, VoteData, VotingStep } from "../utils/types";
import {
  encodeSolidityProof,
  finishBallotProof,
  finishMaskProof,
  getZeroVote,
  type BroadcastVoteRequest,
  type BroadcastVoteResponse,
} from "@crisp-e3/sdk";
import { ensureCircuits } from "../utils/circuits";
import { iVotesAbi } from "../artifacts/iVotes";
import { publicClient } from "../utils/client";
import { useAlerts } from "@/context/Alerts";
import { crispSdk } from "../utils/crispSdk";
import { getRandomVoterToMask } from "../utils/voters";
import {
  CensusMode,
  ballotTypedData,
  getBallotDigest,
  getCensusMode,
  getCrispRoundConfig,
  getOnchainVotingPower,
} from "../utils/ballotDigest";
import { usePublishVote } from "./usePublishVote";
import { useCommitteeKeyCheck } from "./useCommitteeKeyCheck";

/**
 * Converts the server's `committee_public_key` to bytes, or `undefined` if it is not the byte array
 * the type claims.
 *
 * `getRoundStateLite` only CASTS the parsed JSON, so the declared `number[]` is a promise the server
 * is not held to. `new Uint8Array("...")` on a string yields an empty array rather than throwing,
 * and an array of non-numbers yields zeros — either way the caller would go on to treat junk as a
 * key. Returning `undefined` instead lets the resolver report "no server key" honestly.
 */
function toKeyBytes(value: unknown): Uint8Array | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const valid = value.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255);
  if (!valid) return undefined;

  return Uint8Array.from(value as number[]);
}

/**
 * State of the Crisp server
 */
interface CrispServerState {
  isLoading: boolean;
  error: string;
  postVote: (voteOption: bigint, e3Id: bigint, snapshotBlock: bigint, isAMask?: boolean) => Promise<void>;
  votingStep: VotingStep;
  lastActiveStep: VotingStep | null;
  stepMessage: string;
  txHash: string | null;
  /** The round currently satisfies every precondition `publishInput` enforces. */
  canPublishOnChain: boolean;
  /** Why the on-chain route is unavailable, when it is. */
  onChainBlockedReason?: string;
}

type PendingAvailabilityJob = {
  jobId: string;
  encodedProof: string;
  isMask: boolean;
};

function availabilityJobKey(e3Id: bigint, address: string): string {
  return `crisp-availability-${PUB_CHAIN.id}-${e3Id}-${address.toLowerCase()}`;
}

function readAvailabilityJob(key: string): PendingAvailabilityJob | undefined {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as PendingAvailabilityJob) : undefined;
  } catch {
    return undefined;
  }
}

function writeAvailabilityJob(key: string, job: PendingAvailabilityJob): void {
  localStorage.setItem(key, JSON.stringify(job));
}

function clearAvailabilityJob(key: string): void {
  localStorage.removeItem(key);
}

/**
 * Hook to interact with Crisp server
 * @returns an error, a loading state and a function to cast votes
 */
export function useCrispServer(e3Id?: bigint): CrispServerState {
  const { address } = useAccount();
  const { addAlert } = useAlerts();

  // The on-chain route needs the round up front to check `publishInput`'s preconditions, so the
  // caller passes it here rather than only at vote time.
  const {
    publish: publishVoteOnChain,
    canPublish: canPublishOnChain,
    blockedReason: onChainBlockedReason,
  } = usePublishVote(e3Id);

  const resolveCommitteeKey = useCommitteeKeyCheck(e3Id);

  const [votingStep, setVotingStep] = useState<VotingStep>("idle");
  const [lastActiveStep, setLastActiveStep] = useState<VotingStep | null>(null);
  const [stepMessage, setStepMessage] = useState<string>("");

  const { signTypedDataAsync } = useSignTypedData();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [txHash, setTxHash] = useState<string | null>(null);

  // All three go through the SDK rather than hand-rolled fetches, so the
  // route names and payload shapes stay owned by the SDK.
  const getRoundState = async (e3Id: bigint): Promise<IRoundDetailsResponse> => {
    return (await crispSdk.getRoundStateLite(e3Id)) as unknown as IRoundDetailsResponse;
  };

  const getTokenHoldersHashes = async (e3Id: bigint): Promise<bigint[]> => {
    const hashes = await crispSdk.getTokenHolderHashes(e3Id);
    return hashes.map((h) => BigInt(h.startsWith("0x") ? h : `0x${h}`));
  };

  const getEligibleVoters = async (e3Id: bigint): Promise<EligibleVoter[]> => {
    const holders = await crispSdk.getEligibleAddresses(e3Id);
    return holders.map((v) => ({ address: v.address, balance: BigInt(v.balance) }));
  };
  const handleMask = async (
    e3Id: bigint,
    numOptions: string,
    /// Set for an ONCHAIN round: the program that will verify the mask.
    crispProgram?: `0x${string}`
  ) => {
    const eligibleVoters = await getEligibleVoters(e3Id);

    if (!eligibleVoters || eligibleVoters.length === 0) {
      throw new Error("No eligible voters available for masking");
    }

    const voter = getRandomVoterToMask(eligibleVoters);

    const zeroVote = getZeroVote(Number.parseInt(numOptions));

    // A mask is still checked against public input 4, so its voting power has to be the number
    // the contract will supply for that slot — not the balance the server recorded. The two
    // usually coincide, because both scale by the token's decimals, but they diverge the moment a
    // round names an explicit divisor, and a mask that got it wrong would fail in the verifier.
    const balance = crispProgram
      ? await getOnchainVotingPower(publicClient, crispProgram, e3Id, voter.address as `0x${string}`)
      : voter.balance;

    return {
      voter,
      eligibleVoters,
      vote: zeroVote,
      balance,
      slotAddress: voter.address,
    };
  };

  const handleVote = async (
    e3Id: bigint,
    voteOption: bigint,
    blockNumber: bigint,
    numOptions: number,
    roundState: IRoundDetailsResponse,
    /// Set for an ONCHAIN round: the program that will verify the ballot, and the only authority
    /// on how much weight the slot may spend.
    crispProgram?: `0x${string}`
  ): Promise<VoteData> => {
    // No signing here any more. The ballot digest commits to the ciphertext, so it does not
    // exist until the vote has been encrypted — the wallet prompt moved into `postVote`, after
    // `prepareBallot`. Signing a round-scoped message here would authorise any ballot for the
    // round, which is the binding weakness the digest exists to close.
    let adjustedBalance: bigint;

    if (crispProgram) {
      // An ONCHAIN round takes both the snapshot and the scaling from the contract, which then
      // verifies the proof against exactly that number. Reading it here — rather than repeating
      // the `getPastVotes` call and the `10 ** (decimals - 1)` division below — is what keeps the
      // prover and the verifier in agreement; a one-unit difference fails the proof with nothing
      // naming the cause.
      adjustedBalance = await getOnchainVotingPower(publicClient, crispProgram, e3Id, address as `0x${string}`);
    } else if (roundState.credit_mode === CreditsMode.CONSTANT && roundState.credits) {
      adjustedBalance = BigInt(roundState.credits);
    } else {
      // The voting token is timestamp-clocked (EIP-6372, CLOCK_MODE=timestamp), so
      // getPastVotes expects a *timestamp*, not a block number. The CRISP server snapshots
      // voting power at `start_time - 1`; we must query the exact same point or our leaf
      // won't match the server's merkle tree. `blockNumber` (on-chain snapshotBlock) is unused here.
      const snapshotTimestamp = BigInt(roundState.start_time) - 1n;

      const balance = await publicClient.readContract({
        address: PUB_TOKEN_ADDRESS,
        abi: iVotesAbi,
        functionName: "getPastVotes",
        args: [address as `0x${string}`, snapshotTimestamp],
      });

      const decimals = await publicClient.readContract({
        address: PUB_TOKEN_ADDRESS,
        abi: iVotesAbi,
        functionName: "decimals",
      });

      // Must mirror the CRISP server's scaling exactly (it keeps 1 decimal of precision:
      // balance / 10^(decimals-1)) or our vote won't match the server's merkle leaf. It also
      // keeps votes within the BFV per-choice encoding cap (2^33 - 1 for 3 options).
      adjustedBalance = balance / 10n ** BigInt(decimals - 1);
    }

    const vote = Array.from({ length: numOptions }, (_, i) =>
      i === Number(voteOption) ? Number.parseInt(adjustedBalance.toString(), 10) : 0
    );

    return {
      vote,
      balance: adjustedBalance,
      slotAddress: address as string,
    };
  };

  const postVote = async (voteOption: bigint, e3Id: bigint, snapshotBlock: bigint, isAMask: boolean = false) => {
    setIsLoading(true);
    try {
      if (!address) {
        setError("No wallet address found");
        setVotingStep("error");
        setStepMessage("No wallet address found");
        return;
      }

      const pendingJobKey = availabilityJobKey(e3Id, address);

      const finishAvailability = async (response: BroadcastVoteResponse, operationIsMask: boolean): Promise<void> => {
        let current = response;
        if (current.status === "failed_broadcast") {
          clearAvailabilityJob(pendingJobKey);
          throw new Error(current.message ?? "The availability service rejected the ballot");
        }

        let transactionHash = current.tx_hash;
        if (current.status === "ready_for_commitment") {
          if (!current.encoded_proof) {
            throw new Error("The availability service did not return the proof commitment");
          }
          if (!canPublishOnChain) {
            throw new Error(onChainBlockedReason ?? "The round is not ready for the proof commitment");
          }

          setStepMessage("Please confirm the proof commitment in your wallet...");
          transactionHash = await publishVoteOnChain(current.encoded_proof as `0x${string}`);

          if (current.job_id) {
            current = await crispSdk.getVoteAvailability(current.job_id);
          }
        }

        if (transactionHash) setTxHash(transactionHash);

        const label = operationIsMask ? "Mask" : "Vote";
        const finalized = current.status === "success";
        const queued = current.status === "pending_commitment";
        setVotingStep("complete");
        setStepMessage(
          finalized
            ? `${label} finalized successfully!`
            : queued
              ? `${label} proof stored and queued for commitment. You can safely leave this page.`
              : `${label} committed. Availability will finalize in the background.`
        );
        addAlert(
          finalized
            ? `${label} finalized successfully!`
            : queued
              ? `${label} proof queued. You can safely leave this page.`
              : `${label} committed. You can safely leave this page.`,
          { timeout: 5000, type: "success" }
        );

        if (finalized) clearAvailabilityJob(pendingJobKey);
      };

      const pendingJob = readAvailabilityJob(pendingJobKey);
      if (pendingJob) {
        setVotingStep("broadcasting");
        setLastActiveStep("broadcasting");
        setStepMessage("Checking your pending availability job...");
        const response = await crispSdk
          .getVoteAvailability(pendingJob.jobId)
          .catch(() => crispSdk.broadcastVote({ e3Id, encodedProof: pendingJob.encodedProof }));
        await finishAvailability(response, pendingJob.isMask);
        return;
      }

      addAlert(`${isAMask ? "Masking" : "Vote"} generation started! Please do not leave the current page.`, {
        timeout: 3000,
        type: "info",
      });

      const roundState = await getRoundState(e3Id);

      if (roundState.status !== "Active") {
        setError("This round is not accepting votes yet. Please wait and try again.");
        setVotingStep("error");
        setStepMessage("This round is not accepting votes yet.");
        return;
      }

      // The committee key comes from `CommitteePublished` logs, falling back to the CRISP server
      // only when the key was never published on-chain. Either way it is accepted only if its
      // recomputed BFV commitment matches the round's on-chain `committeePublicKey`, so nobody —
      // relayer or log spammer — can substitute a key they hold the secret for and decrypt the
      // ballot. Resolved BEFORE anything is encrypted to it.
      const resolved = await resolveCommitteeKey(toKeyBytes(roundState.committee_public_key));
      if (!resolved.key) {
        const reason = resolved.reason ?? "The committee public key could not be verified.";
        setError(reason);
        setVotingStep("error");
        setStepMessage(reason);
        return;
      }

      const publicKey = resolved.key;

      // Resolved before the ballot is built: an ONCHAIN round takes its weight from this contract
      // rather than from a census, so the program has to be known first.
      const { crispProgram, paramSet } = await getCrispRoundConfig(publicClient, PUB_CRISP_VOTING_PLUGIN_ADDRESS, e3Id);
      const censusMode = await getCensusMode(publicClient, crispProgram, e3Id);
      const isOnchainCensus = censusMode === CensusMode.ONCHAIN;

      let voteData;
      if (isAMask) {
        voteData = await handleMask(e3Id, roundState.num_options, isOnchainCensus ? crispProgram : undefined);
      } else {
        voteData = await handleVote(
          e3Id,
          voteOption,
          snapshotBlock,
          Number.parseInt(roundState.num_options),
          roundState,
          isOnchainCensus ? crispProgram : undefined
        );
      }

      // An on-chain census has no tree: `publishInput` reads each voter's power from the token, so
      // there is no holder list to fetch and no root to prove against. Asking for one would 404 —
      // the coordinator never builds it for these rounds.
      const merkleLeaves = isOnchainCensus ? [] : await getTokenHoldersHashes(e3Id);

      // Step 2: Encrypt the ballot. Split from proving because the signature covers a digest that
      // commits to this exact ciphertext, so the ballot has to exist before the voter can sign it.
      setVotingStep("generating_proof");
      setLastActiveStep("generating_proof");
      setStepMessage("Encrypting vote...");

      const ballotBase = {
        vote: voteData.vote,
        publicKey,
        slotAddress: voteData.slotAddress,
        isMaskVote: isAMask,
        numOptions: Number.parseInt(roundState.num_options),
      };

      // The BFV circuits are preset-bound and must be registered before any encryption or
      // proving. Loaded lazily so the matching artifact bundle only downloads when voting.
      await ensureCircuits(paramSet);

      // The SDK's own prepareBallot (not the standalone one): it resolves the slot's head —
      // previous ciphertext plus its tree index — from the server and threads the pair into the
      // circuit inputs, which is what lets a re-vote or a mask extend the slot's existing chain.
      const prepared = await crispSdk.prepareBallot(
        isOnchainCensus
          ? { e3Id, ...ballotBase, censusMode: "onchain", votingPower: voteData.balance }
          : { e3Id, ...ballotBase, censusMode: "merkle", merkleLeaves, balance: voteData.balance }
      );

      // The digest comes from the contract that will verify the ballot, not from a struct rebuilt
      // here. `publishInput` recomputes it and the circuit proves the signature covers it, so a
      // local copy that drifted would produce ballots every node rejects.
      const digest = await getBallotDigest(
        publicClient,
        crispProgram,
        e3Id,
        voteData.slotAddress as `0x${string}`,
        prepared.ctCommitment
      );

      let proof;

      if (isAMask) {
        // A mask carries a real digest and a placeholder signature. It must be indistinguishable
        // from a real ballot on-chain, and it is cast for someone else's slot, so there is no key
        // to sign with and no wallet prompt.
        proof = await finishMaskProof(prepared, digest);
      } else {
        // Step 3: Signing, now that there is a ciphertext to bind to.
        setVotingStep("signing");
        setLastActiveStep("signing");
        setStepMessage("Please sign your ballot in your wallet...");

        const { domain, types } = ballotTypedData(PUB_CHAIN.id, crispProgram);

        // `signTypedData`, not `signMessage`: `ballotDigest` returns an EIP-712 digest that a
        // wallet signs directly. `signMessage` would add the EIP-191 prefix and sign a different
        // one, and every ballot would fail looking like a bad signature.
        const signature = await signTypedDataAsync({
          domain,
          types,
          primaryType: "Ballot",
          message: {
            e3Id,
            slot: voteData.slotAddress as `0x${string}`,
            ciphertextCommitment: prepared.ctCommitment,
          },
        });

        setVotingStep("generating_proof");
        setLastActiveStep("generating_proof");
        setStepMessage("Generating proof...");

        proof = await finishBallotProof(prepared, digest, signature);
      }

      const encodedProof = encodeSolidityProof(proof);

      // For now we are mocking
      const voteBody: BroadcastVoteRequest = {
        e3Id,
        encodedProof,
      };

      // Step 3: Broadcasting
      setVotingStep("broadcasting");
      setLastActiveStep("broadcasting");

      // The availability service first stores the ciphertext and returns a compact proof
      // commitment. It either relays that commitment or asks this wallet to submit it. Avail and
      // VectorX finalization continue after this request returns.
      setStepMessage("Storing the encrypted ballot and committing its proof...");
      const voteResponse = await crispSdk.broadcastVote(voteBody);
      if (voteResponse.job_id) {
        writeAvailabilityJob(pendingJobKey, {
          jobId: voteResponse.job_id,
          encodedProof,
          isMask: isAMask,
        });
      }
      await finishAvailability(voteResponse, isAMask);
    } catch (error) {
      console.error("Error in postVote:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setError(errorMessage);
      setVotingStep("error");
      setStepMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    postVote,
    error,
    isLoading,
    votingStep,
    lastActiveStep,
    stepMessage,
    txHash,
    canPublishOnChain,
    onChainBlockedReason,
  };
}
