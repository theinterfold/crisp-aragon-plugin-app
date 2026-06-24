import { useReadContract } from "wagmi";
import { parseAbi } from "viem";
import type { Address } from "viem";
import { PUB_CHAIN_ID, PUB_CRISP_VOTING_PLUGIN_ADDRESS } from "@/constants";

/** Lifecycle stages of an E3 computation (mirrors IInterfold.E3Stage). */
export enum E3Stage {
  None,
  Requested,
  CommitteeFinalized,
  KeyPublished,
  CiphertextReady,
  Complete,
  Failed,
}

/** Reasons an E3 failed (mirrors IInterfold.FailureReason). */
export enum E3FailureReason {
  None,
  CommitteeFormationTimeout,
  InsufficientCommitteeMembers,
  DKGTimeout,
  DKGInvalidShares,
  NoInputsReceived,
  ComputeTimeout,
  ComputeProviderExpired,
  ComputeProviderFailed,
  RequesterCancelled,
  DecryptionTimeout,
  DecryptionInvalidShares,
  VerificationFailed,
}

const pluginAbi = parseAbi(["function interfold() view returns (address)"]);
const interfoldAbi = parseAbi([
  "function getE3Stage(uint256 e3Id) view returns (uint8)",
  "function getFailureReason(uint256 e3Id) view returns (uint8)",
]);

/** Human-readable description of an E3 failure reason. */
export function describeE3Failure(reason: E3FailureReason | undefined): string {
  switch (reason) {
    case E3FailureReason.CommitteeFormationTimeout:
      return "The voting committee could not be formed in time.";
    case E3FailureReason.InsufficientCommitteeMembers:
      return "Not enough ciphernodes were available to form the voting committee.";
    case E3FailureReason.DKGTimeout:
      return "The committee timed out during distributed key generation (DKG).";
    case E3FailureReason.DKGInvalidShares:
      return "The committee produced invalid key shares during distributed key generation (DKG).";
    case E3FailureReason.NoInputsReceived:
      return "No votes were received before the input window closed.";
    case E3FailureReason.ComputeTimeout:
    case E3FailureReason.ComputeProviderExpired:
    case E3FailureReason.ComputeProviderFailed:
      return "The compute provider failed to produce a result.";
    case E3FailureReason.DecryptionTimeout:
    case E3FailureReason.DecryptionInvalidShares:
      return "The committee failed to decrypt the result.";
    case E3FailureReason.VerificationFailed:
      return "The result could not be verified.";
    case E3FailureReason.RequesterCancelled:
      return "The request was cancelled.";
    default:
      return "The encrypted vote round failed and could not be tallied.";
  }
}

/**
 * Reads the on-chain E3 lifecycle stage for a proposal's round. Used as a fallback
 * when the CRISP server can't return a usable round state: the Enclave/Interfold
 * contract is the authoritative source for whether a round has failed (e.g. the
 * committee couldn't be formed or DKG timed out). Gate with `enabled` so the happy
 * path (committee ready / tallied) skips these reads.
 */
export function useE3Status(e3Id: bigint | undefined, enabled = true) {
  const active = enabled && e3Id !== undefined;

  const { data: interfold } = useReadContract({
    chainId: PUB_CHAIN_ID,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: pluginAbi,
    functionName: "interfold",
    query: { enabled: active },
  });

  const { data: stageRaw } = useReadContract({
    chainId: PUB_CHAIN_ID,
    address: interfold as Address | undefined,
    abi: interfoldAbi,
    functionName: "getE3Stage",
    args: [e3Id ?? 0n],
    query: { enabled: active && !!interfold },
  });

  const stage = stageRaw === undefined ? undefined : (Number(stageRaw) as E3Stage);
  const isFailed = stage === E3Stage.Failed;

  const { data: reasonRaw } = useReadContract({
    chainId: PUB_CHAIN_ID,
    address: interfold as Address | undefined,
    abi: interfoldAbi,
    functionName: "getFailureReason",
    args: [e3Id ?? 0n],
    query: { enabled: active && !!interfold && isFailed },
  });

  const failureReason = reasonRaw === undefined ? undefined : (Number(reasonRaw) as E3FailureReason);

  return { stage, isFailed, failureReason };
}
