import { PUB_CHAIN, PUB_CRISP_SERVER_URL, PUB_TOKEN_ADDRESS } from "@/constants";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { CreditsMode } from "../utils/types";
import type { EligibleVoter, IRoundDetailsResponse, VoteData, VotingStep } from "../utils/types";
import { encodeSolidityProof, getZeroVote } from "@crisp-e3/sdk";
import { iVotesAbi } from "../artifacts/iVotes";
import { publicClient } from "../utils/client";
import { useAlerts } from "@/context/Alerts";
import { usePublishVote } from "./usePublishVote";
import { useCommitteeKeyCheck } from "./useCommitteeKeyCheck";
import { crispSdk } from "../utils/crispSdk";
import { hashMessage } from "viem";
import { getRandomVoterToMask } from "../utils/voters";

export const CRISP_SERVER_STATE_LITE_ROUTE = "state/lite";
export const CRISP_SERVER_STATE_TOKEN_HOLDERS = "state/token-holders";
export const CRISP_SERVER_STATE_ELIGIBLE_VOTERS = "state/eligible-addresses";

/**
 * State of the Crisp server
 */
interface CrispServerState {
  isLoading: boolean;
  error: string;
  postVote: (
    voteOption: bigint,
    e3Id: bigint,
    snapshotBlock: bigint,
    isAMask?: boolean,
    /** Send the vote yourself instead of handing it to the CRISP server to relay. */
    submitOnChain?: boolean
  ) => Promise<void>;
  votingStep: VotingStep;
  lastActiveStep: VotingStep | null;
  stepMessage: string;
  txHash: string | null;
  /** The round currently satisfies every precondition `publishInput` enforces. */
  canPublishOnChain: boolean;
  /** Why the on-chain route is unavailable, when it is. */
  onChainBlockedReason?: string;
}

interface VoteResponse {
  status: string;
  tx_hash: string | null;
  message: string | null;
  is_vote_update: boolean | null;
}

/**
 * Request body for broadcasting a vote to the CRISP server
 */
export interface BroadcastVoteRequest {
  round_id: number;
  encoded_proof: string;
  address: string;
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

  const { signMessageAsync } = useSignMessage();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [txHash, setTxHash] = useState<string | null>(null);

  const getRoundState = async (e3Id: bigint): Promise<IRoundDetailsResponse> => {
    const response = await fetch(`${PUB_CRISP_SERVER_URL}/${CRISP_SERVER_STATE_LITE_ROUTE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ round_id: Number(e3Id.toString()) }),
    });

    if (!response.ok) {
      throw new Error(`Error fetching round data: ${response.statusText}`);
    }

    const data = (await response.json()) as IRoundDetailsResponse;

    return data;
  };

  const getTokenHoldersHashes = async (e3Id: bigint): Promise<bigint[]> => {
    const response = await fetch(`${PUB_CRISP_SERVER_URL}/${CRISP_SERVER_STATE_TOKEN_HOLDERS}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ round_id: Number(e3Id.toString()) }),
    });

    if (!response.ok) {
      throw new Error(`Error fetching token holder hashes: ${response.statusText}`);
    }

    const data = await response.json();

    return data.map((s: string) => BigInt(`0x${s}`));
  };

  const getEligibleVoters = async (e3Id: bigint): Promise<EligibleVoter[]> => {
    const response = await fetch(`${PUB_CRISP_SERVER_URL}/${CRISP_SERVER_STATE_ELIGIBLE_VOTERS}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ round_id: Number(e3Id.toString()) }),
    });

    if (!response.ok) {
      throw new Error(`Error fetching eligible voters: ${response.statusText}`);
    }

    const data = await response.json();

    return data.map((v: EligibleVoter) => ({
      address: v.address,
      balance: Number(v.balance),
    }));
  };

  const handleMask = async (e3Id: bigint, numOptions: string) => {
    const eligibleVoters = await getEligibleVoters(e3Id);

    if (!eligibleVoters || eligibleVoters.length === 0) {
      throw new Error("No eligible voters available for masking");
    }

    const voter = getRandomVoterToMask(eligibleVoters);

    const zeroVote = getZeroVote(Number.parseInt(numOptions));

    return {
      voter,
      eligibleVoters,
      messageHash: "",
      signature: "",
      vote: zeroVote,
      balance: voter.balance,
      slotAddress: voter.address,
    };
  };

  const handleVote = async (
    e3Id: bigint,
    voteOption: bigint,
    blockNumber: bigint,
    numOptions: number,
    roundState: IRoundDetailsResponse
  ): Promise<VoteData> => {
    // Step 1: Signing
    setVotingStep("signing");
    setLastActiveStep("signing");
    setStepMessage("Please sign the message in your wallet...");

    const message = `Vote for round ${e3Id}`;
    const signature = await signMessageAsync({ message });
    const messageHash = hashMessage(message);

    let adjustedBalance: bigint;

    if (roundState.credit_mode === CreditsMode.CONSTANT && roundState.credits) {
      adjustedBalance = BigInt(roundState.credits);
    } else {
      const balance = await publicClient.readContract({
        address: PUB_TOKEN_ADDRESS,
        abi: iVotesAbi,
        functionName: "getPastVotes",
        args: [address as `0x${string}`, blockNumber],
      });

      const decimals = await publicClient.readContract({
        address: PUB_TOKEN_ADDRESS,
        abi: iVotesAbi,
        functionName: "decimals",
      });

      adjustedBalance = balance / 10n ** BigInt(decimals / 2);
    }

    const vote = Array.from({ length: numOptions }, (_, i) =>
      i === Number(voteOption) ? Number.parseInt(adjustedBalance.toString(), 10) : 0
    );

    return {
      signature,
      messageHash,
      vote,
      balance: adjustedBalance,
      slotAddress: address as string,
    };
  };

  const postVote = async (
    voteOption: bigint,
    e3Id: bigint,
    snapshotBlock: bigint,
    isAMask: boolean = false,
    submitOnChain: boolean = false
  ) => {
    setIsLoading(true);
    try {
      if (!address) {
        setError("No wallet address found");
        setVotingStep("error");
        setStepMessage("No wallet address found");
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
      const resolved = await resolveCommitteeKey(new Uint8Array(roundState.committee_public_key));
      if (!resolved.key) {
        const reason = resolved.reason ?? "The committee public key could not be verified.";
        setError(reason);
        setVotingStep("error");
        setStepMessage(reason);
        return;
      }

      const publicKey = resolved.key;

      let voteData;
      if (isAMask) {
        voteData = await handleMask(e3Id, roundState.num_options);
      } else {
        voteData = await handleVote(
          e3Id,
          voteOption,
          snapshotBlock,
          Number.parseInt(roundState.num_options),
          roundState
        );
      }

      // get the merkle leaves
      const merkleLeaves = await getTokenHoldersHashes(e3Id);

      // Step 2: Encrypting vote and Generating proof
      setVotingStep("generating_proof");
      setLastActiveStep("generating_proof");
      setStepMessage("Encrypting vote and generating proof...");

      let proof;

      if (isAMask) {
        proof = await crispSdk.generateMaskVoteProof({
          e3Id: Number(e3Id),
          merkleLeaves,
          slotAddress: voteData.slotAddress,
          publicKey,
          balance: voteData.balance,
          numOptions: Number.parseInt(roundState.num_options),
        });
      } else {
        proof = await crispSdk.generateVoteProof({
          merkleLeaves,
          publicKey,
          balance: voteData.balance,
          vote: voteData.vote,
          signature: voteData.signature as `0x${string}`,
          messageHash: voteData.messageHash as `0x${string}`,
          e3Id: Number(e3Id),
          slotAddress: voteData.slotAddress,
        });
      }

      const encodedProof = encodeSolidityProof(proof);

      // For now we are mocking
      const voteBody: BroadcastVoteRequest = {
        encoded_proof: encodedProof,
        address: address as string,
        round_id: Number(e3Id),
      };

      // Step 3: Broadcasting
      setVotingStep("broadcasting");
      setLastActiveStep("broadcasting");

      // Everything above this point is identical for both routes: the ballot is encrypted and
      // proven locally, and `encodedProof` is already the exact payload `publishInput` decodes.
      // The only difference is who sends the transaction — the voter, or the CRISP server acting
      // as a relayer.
      if (submitOnChain) {
        setStepMessage("Publishing your vote on-chain...");

        const hash = await publishVoteOnChain(encodedProof as `0x${string}`);
        setTxHash(hash);

        const onChainLabel = isAMask ? "Masking" : "Vote";
        setVotingStep("complete");
        setStepMessage(`${onChainLabel} published on-chain!`);
        addAlert(`${onChainLabel} published on-chain!`, { timeout: 3000, type: "success" });
        return;
      }

      setStepMessage("Broadcasting vote to the network...");

      const response = await fetch(`${PUB_CRISP_SERVER_URL}/voting/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(voteBody),
      });

      if (response.status !== 200) {
        setError("Failed to broadcast vote");
        setVotingStep("error");
        setStepMessage("Failed to broadcast vote");
        return;
      }

      const voteResponse = (await response.json()) as VoteResponse;

      if (voteResponse.tx_hash) {
        setTxHash(voteResponse.tx_hash);
      }

      const label = isAMask ? "Masking" : voteResponse.is_vote_update ? "Vote update" : "Vote";

      setVotingStep("complete");
      setStepMessage(`${label} submitted successfully!`);

      addAlert(`${label} submitted successfully!`, { timeout: 3000, type: "success" });
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
