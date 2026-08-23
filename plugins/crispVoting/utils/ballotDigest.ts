import { parseAbi, type Address, type PublicClient } from "viem";

const pluginAbi = parseAbi(["function interfold() view returns (address)"]);

const interfoldAbi = parseAbi([
  "struct E3 { uint256 seed; uint8 committeeSize; uint256 requestBlock; uint256[2] inputWindow; bytes32 encryptionSchemeId; address e3Program; uint8 paramSet; bytes customParams; address decryptionVerifier; address pkVerifier; bytes32 committeePublicKey; bytes32 ciphertextOutput; bytes plaintextOutput; address requester; bytes32 ciphertextCommitment; }",
  "function getE3(uint256 e3Id) view returns (E3)",
]);

const crispProgramAbi = parseAbi([
  "function ballotDigest(uint256 e3Id, address slot, bytes32 ciphertextCommitment) view returns (bytes32)",
  "function votingPowerOf(uint256 e3Id, address slot) view returns (uint256)",
  "function censusModeOf(uint256 e3Id) view returns (uint8)",
]);

/// Mirrors `CRISPProgram.CensusMode`.
export const CensusMode = { TOKEN: 0, BY_REQUESTER: 1, ONCHAIN: 2 } as const;

/**
 * Resolve the CRISP program a round was requested against.
 *
 * Read from the round rather than configured. The plugin keeps `crispProgramAddress` private with
 * no getter, and the E3 is the authority on which program a round actually runs, so a configured
 * value could disagree with the contract that will verify the ballot.
 *
 * Resolved on demand rather than from a `useReadContract` hook, so a voter who clicks before the
 * hook has settled does not fall through to an undefined address.
 *
 * @param client The public client.
 * @param pluginAddress The CRISP voting plugin.
 * @param e3Id The round.
 * @returns The CRISP program address for that round.
 */
export const resolveCrispProgram = async (
  client: PublicClient,
  pluginAddress: Address,
  e3Id: bigint
): Promise<Address> => {
  const interfoldAddress = await client.readContract({
    address: pluginAddress,
    abi: pluginAbi,
    functionName: "interfold",
  });

  const e3 = await client.readContract({
    address: interfoldAddress,
    abi: interfoldAbi,
    functionName: "getE3",
    args: [e3Id],
  });

  return e3.e3Program;
};

/**
 * Read the digest a voter signs to authorise one ballot.
 *
 * Read from the contract rather than rebuilt here. `CRISPProgram.publishInput` recomputes this
 * digest and the circuit proves the signature covers it, so a locally built EIP-712 struct that
 * drifted from the contract would produce ballots every node rejects.
 *
 * @param client The public client.
 * @param crispProgram The CRISP program address.
 * @param e3Id The round the ballot belongs to.
 * @param slot The slot address the ballot is written to.
 * @param ciphertextCommitment The commitment from `prepareBallot`.
 * @returns The digest to sign.
 */
export const getBallotDigest = async (
  client: PublicClient,
  crispProgram: Address,
  e3Id: bigint,
  slot: Address,
  ciphertextCommitment: `0x${string}`
): Promise<`0x${string}`> => {
  return client.readContract({
    address: crispProgram,
    abi: crispProgramAbi,
    functionName: "ballotDigest",
    args: [e3Id, slot, ciphertextCommitment],
  });
};

/**
 * The EIP-712 domain and type a ballot signature covers.
 *
 * Must match `CRISPProgram`'s `EIP712("CRISP", "1")` and `BALLOT_TYPEHASH`. A wallet signs this
 * through `signTypedData`, which produces a signature over the same digest `ballotDigest` returns.
 * `signMessage` would add the EIP-191 prefix and sign a different one, and every ballot would fail
 * for a reason that looks like a bad signature.
 *
 * @param chainId The chain the program is deployed on.
 * @param crispProgram The CRISP program address.
 * @returns The domain, types and primary type for `signTypedData`.
 */
export const ballotTypedData = (chainId: number, crispProgram: Address) =>
  ({
    domain: { name: "CRISP", version: "1", chainId, verifyingContract: crispProgram },
    types: {
      Ballot: [
        { name: "e3Id", type: "uint256" },
        { name: "slot", type: "address" },
        { name: "ciphertextCommitment", type: "bytes32" },
      ],
    },
    primaryType: "Ballot",
  }) as const;

/**
 * The census a round was requested with, read from the program that will verify its ballots.
 *
 * @param client The public client.
 * @param crispProgram The CRISP program address.
 * @param e3Id The round.
 * @returns The census mode.
 */
export const getCensusMode = async (client: PublicClient, crispProgram: Address, e3Id: bigint): Promise<number> => {
  return client.readContract({
    address: crispProgram,
    abi: crispProgramAbi,
    functionName: "censusModeOf",
    args: [e3Id],
  });
};

/**
 * The voting power a slot may spend in an on-chain-census round, in ballot units.
 *
 * Read from the contract rather than recomputed. `publishInput` scales the raw token power by the
 * round's divisor and hands the result to the circuit as a public input, then verifies the proof
 * against it — so a client that re-derived the snapshot, the divisor or the rounding even slightly
 * differently would produce ballots that fail with nothing naming the cause.
 *
 * @param client The public client.
 * @param crispProgram The CRISP program address.
 * @param e3Id The round.
 * @param slot The slot the ballot is written to.
 * @returns The spendable voting power in ballot units.
 */
export const getOnchainVotingPower = async (
  client: PublicClient,
  crispProgram: Address,
  e3Id: bigint,
  slot: Address
): Promise<bigint> => {
  return client.readContract({
    address: crispProgram,
    abi: crispProgramAbi,
    functionName: "votingPowerOf",
    args: [e3Id, slot],
  });
};

/**
 * The human-facing round number for an E3 id.
 *
 * Interfold namespaces ids: the high 160 bits are the coordinator's own address and the low 96 a
 * per-contract counter (`nexte3Id` starts at `address << 96`, and `E3IdSpaceExhausted` fires when
 * the low `uint96` saturates). Rendered whole, an id is a 77-digit number that is identical across
 * every round bar its last few digits — unreadable, and impossible to compare at a glance.
 *
 * The full id is still what every contract call and API request must use; this is for display.
 *
 * @param e3Id The full 256-bit E3 id.
 * @returns The round counter.
 */
export const e3RoundNumber = (e3Id: bigint): bigint => e3Id & ((1n << 96n) - 1n);
