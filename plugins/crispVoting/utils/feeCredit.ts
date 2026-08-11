import { BaseError, ContractFunctionRevertedError, type Address } from "viem";

export type FeeCreditShortfall = {
  /** The account whose credit the plugin tried to debit. */
  payer: Address;
  /** The E3 fee the proposal costs, as quoted by Interfold. */
  required: bigint;
  /** The credit that account currently has escrowed. */
  available: bigint;
  /** `required - available` — exactly what still needs depositing. */
  missing: bigint;
};

/**
 * Pulls the fee figures out of a `InsufficientFeeCredit(address,uint256,uint256)` revert.
 *
 * This is the only way the app can learn what a proposal costs. The fee comes from
 * `interfold.getE3Quote(...)`, whose parameters (committee size, param set, program address,
 * compute provider params) are all private plugin storage with no getters — so the quote cannot be
 * reproduced off-chain. Simulating the real `createProposal` and reading the error is exact by
 * construction: it is the same quote the transaction would have used.
 *
 * Returns `undefined` for any other revert, which the caller should surface as-is rather than
 * treating as a funding problem.
 */
export function readInsufficientFeeCredit(err: unknown): FeeCreditShortfall | undefined {
  if (!(err instanceof BaseError)) return undefined;

  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return undefined;
  if (revert.data?.errorName !== "InsufficientFeeCredit") return undefined;

  const [payer, required, available] = revert.data.args as readonly [Address, bigint, bigint];

  return { payer, required, available, missing: required - available };
}
