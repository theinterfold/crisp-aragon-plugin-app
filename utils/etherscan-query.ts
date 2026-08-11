/** The query shape Next gives an API route (`req.query`). */
export type IncomingQuery = Record<string, string | string[] | undefined>;

/**
 * Builds the query the Etherscan proxy forwards upstream.
 *
 * Two rules, both load-bearing:
 *
 * 1. A caller-supplied `apikey` is always dropped and replaced with the server key, so the route
 *    cannot be used to smuggle in someone else's key or to read ours back.
 * 2. Everything else is forwarded verbatim — in particular `chainid`, which `getEtherscanAbiLoader`
 *    (hooks/useAbi.ts) smuggles through whatsabi's `apiKey` field because whatsabi 0.14 has no
 *    chainid option. Dropping it would send a chainless request to the V2 endpoint.
 *
 * Lives here rather than inline in the route so the tests exercise the real implementation.
 */
export function buildEtherscanUpstreamQuery(incoming: IncomingQuery, serverKey: string): URLSearchParams {
  const out = new URLSearchParams();

  for (const [key, value] of Object.entries(incoming)) {
    // Belt and braces. What actually guarantees rule 1 is the `set` below overwriting any
    // caller-supplied value; this skip keeps that true if the loop ever moves to `append`, where
    // both values would survive and the caller's would be sent first.
    if (key === "apikey") continue;
    out.set(key, Array.isArray(value) ? (value[0] ?? "") : String(value ?? ""));
  }

  out.set("apikey", serverKey);

  return out;
}
