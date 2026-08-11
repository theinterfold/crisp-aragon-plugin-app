import { usePublicClient, useReadContract } from "wagmi";
import { parseAbi, type Address, type Hex } from "viem";
import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS } from "@/constants";
import { useTransactionManager } from "@/hooks/useTransactionManager";
import { awaitSuccessfulReceipt } from "../utils/awaitReceipt";
import { E3Stage } from "./useE3Status";

const pluginAbi = parseAbi(["function interfold() view returns (address)"]);

const interfoldAbi = parseAbi([
  "function getE3Stage(uint256 e3Id) view returns (uint8)",
  "struct E3 { uint256 seed; uint8 committeeSize; uint256 requestBlock; uint256[2] inputWindow; bytes32 encryptionSchemeId; address e3Program; uint8 paramSet; bytes customParams; address decryptionVerifier; address pkVerifier; bytes32 committeePublicKey; bytes32 ciphertextOutput; bytes plaintextOutput; address requester; bytes32 ciphertextCommitment; }",
  "function getE3(uint256 e3Id) view returns (E3)",
]);

const crispProgramAbi = parseAbi([
  "function publishInput(uint256 e3Id, bytes data)",
  "function getRoundData(uint256 e3Id) view returns (uint256 merkleRoot, bytes32 paramsHash, uint256 numOptions, uint8 creditMode, uint256 inputRoot, uint40 numberOfVotes)",
]);

export type PublishVote = {
  /** Every precondition `publishInput` enforces is satisfied right now. */
  canPublish: boolean;
  /** Why an on-chain vote would be rejected, when it would be. */
  blockedReason?: string;
  /** Still resolving the reads needed to answer that. */
  isLoading: boolean;
  /** Submits an already-built vote payload directly to the CRISP program. */
  publish: (encodedProof: Hex) => Promise<Hex>;
};

/**
 * Submits a vote straight to the CRISP program instead of handing it to the CRISP server.
 *
 * The client already does all the work — encrypting the ballot and generating the Noir proof
 * happen locally, and `encodeSolidityProof` produces exactly the `(bytes, address, bytes32, bytes)`
 * tuple that `CRISPProgram.publishInput` decodes. The server's only role in the existing flow is
 * to relay that payload in a transaction, so bypassing it costs the voter gas and removes a
 * liveness dependency without changing the ballot in any way.
 *
 * `publishInput` verifies the Noir proof on-chain against `e3.committeePublicKey`, so a vote that
 * reaches the tally this way cannot have been encrypted under a key the committee does not hold.
 * (It does NOT protect ballot secrecy — a ballot encrypted to the wrong key is broadcast publicly
 * before it is rejected — but it does mean a relayer cannot substitute or drop a valid vote.)
 */
export function usePublishVote(e3Id: bigint | undefined): PublishVote {
  const client = usePublicClient();
  const enabled = e3Id !== undefined;

  const { data: interfold } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: pluginAbi,
    functionName: "interfold",
    query: { enabled },
  });

  const interfoldAddress = interfold as Address | undefined;

  const { data: e3 } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: interfoldAddress,
    abi: interfoldAbi,
    functionName: "getE3",
    args: [e3Id ?? 0n],
    query: { enabled: enabled && !!interfoldAddress },
  });

  const { data: stageRaw } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: interfoldAddress,
    abi: interfoldAbi,
    functionName: "getE3Stage",
    args: [e3Id ?? 0n],
    query: { enabled: enabled && !!interfoldAddress },
  });

  // The CRISP program address comes from the E3 itself rather than configuration: the plugin
  // stores `crispProgramAddress` privately with no getter, and the E3 is the authority on which
  // program a round actually runs.
  const programAddress = (e3 as { e3Program?: Address } | undefined)?.e3Program;
  const inputWindow = (e3 as { inputWindow?: readonly [bigint, bigint] } | undefined)?.inputWindow;

  const { data: roundData } = useReadContract({
    chainId: PUB_CHAIN.id,
    address: programAddress,
    abi: crispProgramAbi,
    functionName: "getRoundData",
    args: [e3Id ?? 0n],
    query: { enabled: enabled && !!programAddress },
  });

  const merkleRoot = (roundData as readonly [bigint, ...unknown[]] | undefined)?.[0];

  const isLoading =
    enabled && (stageRaw === undefined || e3 === undefined || (!!programAddress && roundData === undefined));

  /**
   * Mirrors every guard in `publishInput` so the UI can refuse before spending gas on a revert,
   * and can say which one is the problem rather than surfacing a bare rejection.
   */
  const blockedReason = (() => {
    if (isLoading || !enabled) return undefined;
    if (!programAddress) return "The round's CRISP program could not be resolved.";
    if (stageRaw !== undefined && Number(stageRaw) !== E3Stage.KeyPublished) {
      return "The committee key has not been published yet, so the round is not accepting votes.";
    }
    if (merkleRoot === 0n) {
      return "The census merkle root has not been set for this round yet.";
    }
    if (inputWindow) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now < inputWindow[0]) return "The voting window has not opened yet.";
      if (now > inputWindow[1]) return "The voting window has closed.";
    }
    return undefined;
  })();

  const { writeContractAsync } = useTransactionManager({
    onSuccessMessage: "Vote published on-chain",
    onErrorMessage: "Could not publish the vote on-chain",
  });

  const publish = async (encodedProof: Hex) => {
    if (e3Id === undefined) throw new Error("No round selected");
    if (!client) throw new Error("No RPC client available");
    if (!programAddress) throw new Error("The round's CRISP program could not be resolved");
    if (blockedReason) throw new Error(blockedReason);

    const hash = await writeContractAsync({
      chainId: PUB_CHAIN.id,
      abi: crispProgramAbi,
      address: programAddress,
      functionName: "publishInput",
      args: [e3Id, encodedProof],
    });

    await awaitSuccessfulReceipt(client, hash, "The vote");

    return hash;
  };

  return {
    canPublish: !isLoading && !blockedReason && !!programAddress,
    blockedReason,
    isLoading: Boolean(isLoading),
    publish,
  };
}
