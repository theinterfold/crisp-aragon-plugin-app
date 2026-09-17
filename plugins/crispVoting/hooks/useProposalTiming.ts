import { PUB_CHAIN, PUB_CRISP_VOTING_PLUGIN_ADDRESS } from "@/constants";
import { parseAbi, type Address } from "viem";
import { useBlock, useReadContract } from "wagmi";
import { calculateProposalTiming, type ProposalTiming } from "../utils/proposalTiming";

const pluginAbi = parseAbi([
  "function interfold() view returns (address)",
  "function crispProgram() view returns (address)",
  "function minDuration() view returns (uint64)",
]);
const interfoldAbi = parseAbi([
  "function ciphernodeRegistry() view returns (address)",
  "function getTimeoutConfig() view returns (uint256 dkgWindow, uint256 computeWindow, uint256 decryptionWindow)",
  "function maxDuration() view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function randomnessRequestTimeout() view returns (uint256)",
  "function sortitionSubmissionWindow() view returns (uint256)",
]);
const crispProgramAbi = parseAbi([
  "function MIN_VOTING_DURATION() view returns (uint256)",
  "function availabilityFinalizationWindow() view returns (uint256)",
]);

export type ProposalTimingState = {
  timing?: ProposalTiming;
  isLoading: boolean;
  error?: Error;
};

function asSafeNumber(value: bigint | undefined, name: string): number {
  if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`The ${name} value is unavailable or too large`);
  }
  return Number(value);
}

/** Read the current protocol timing rules and calculate the selected proposal timeline. */
export function useProposalTiming(duration: number, startAt: number): ProposalTimingState {
  const blockRead = useBlock({ chainId: PUB_CHAIN.id, watch: true });
  const pluginRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: pluginAbi,
    functionName: "interfold",
  });
  const interfoldAddress = pluginRead.data as Address | undefined;
  const programRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: pluginAbi,
    functionName: "crispProgram",
  });
  const programAddress = programRead.data as Address | undefined;
  const pluginMinimumRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
    abi: pluginAbi,
    functionName: "minDuration",
  });

  const timeoutRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: interfoldAddress,
    abi: interfoldAbi,
    functionName: "getTimeoutConfig",
    query: { enabled: Boolean(interfoldAddress) },
  });
  const registryRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: interfoldAddress,
    abi: interfoldAbi,
    functionName: "ciphernodeRegistry",
    query: { enabled: Boolean(interfoldAddress) },
  });
  const registryAddress = registryRead.data as Address | undefined;
  const maximumLifecycleRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: interfoldAddress,
    abi: interfoldAbi,
    functionName: "maxDuration",
    query: { enabled: Boolean(interfoldAddress) },
  });

  const randomnessRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: registryAddress,
    abi: registryAbi,
    functionName: "randomnessRequestTimeout",
    query: { enabled: Boolean(registryAddress) },
  });
  const sortitionRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: registryAddress,
    abi: registryAbi,
    functionName: "sortitionSubmissionWindow",
    query: { enabled: Boolean(registryAddress) },
  });
  const votingRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: programAddress,
    abi: crispProgramAbi,
    functionName: "MIN_VOTING_DURATION",
    query: { enabled: Boolean(programAddress) },
  });
  const availabilityRead = useReadContract({
    chainId: PUB_CHAIN.id,
    address: programAddress,
    abi: crispProgramAbi,
    functionName: "availabilityFinalizationWindow",
    query: { enabled: Boolean(programAddress) },
  });

  const reads = [
    blockRead,
    pluginRead,
    programRead,
    pluginMinimumRead,
    timeoutRead,
    registryRead,
    maximumLifecycleRead,
    randomnessRead,
    sortitionRead,
    votingRead,
    availabilityRead,
  ];
  const readError = reads.find((read) => read.error)?.error;
  if (readError) return { isLoading: false, error: readError };

  const timeoutConfig = timeoutRead.data as readonly [bigint, bigint, bigint] | undefined;
  const isLoading =
    !blockRead.data ||
    !interfoldAddress ||
    !programAddress ||
    !registryAddress ||
    !timeoutConfig ||
    pluginMinimumRead.data === undefined ||
    maximumLifecycleRead.data === undefined ||
    randomnessRead.data === undefined ||
    sortitionRead.data === undefined ||
    votingRead.data === undefined ||
    availabilityRead.data === undefined;
  if (isLoading) return { isLoading: true };

  try {
    return {
      isLoading: false,
      timing: calculateProposalTiming(
        duration,
        {
          pluginMinimumDuration: asSafeNumber(pluginMinimumRead.data, "plugin minimum duration"),
          randomnessRequestTimeout: asSafeNumber(randomnessRead.data, "randomness request timeout"),
          sortitionSubmissionWindow: asSafeNumber(sortitionRead.data, "sortition submission window"),
          dkgWindow: asSafeNumber(timeoutConfig[0], "DKG window"),
          computeWindow: asSafeNumber(timeoutConfig[1], "compute window"),
          decryptionWindow: asSafeNumber(timeoutConfig[2], "decryption window"),
          maximumLifecycleDuration: asSafeNumber(maximumLifecycleRead.data, "maximum lifecycle duration"),
          minimumVotingDuration: asSafeNumber(votingRead.data, "minimum voting duration"),
          availabilityFinalizationWindow: asSafeNumber(availabilityRead.data, "availability finalization window"),
        },
        startAt,
        asSafeNumber(blockRead.data.timestamp, "block timestamp")
      ),
    };
  } catch (error) {
    return { isLoading: false, error: error as Error };
  }
}
