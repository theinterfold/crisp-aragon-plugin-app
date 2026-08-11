import { expect, test, describe } from "bun:test";
import { whatsabi } from "@shazow/whatsabi";

/**
 * Guards the chainid smuggling in `getEtherscanAbiLoader` (hooks/useAbi.ts).
 *
 * Etherscan's V2 endpoint requires a `chainid` param, but whatsabi 0.14 has no field for one.
 * The loader rides it in on the `apiKey` value, which whatsabi appends verbatim, so the request
 * ends up with TWO separate params: `apikey=ignored` and `chainid=<id>`. The `/api/etherscan`
 * proxy then strips `apikey` (never letting a caller override the server key) and forwards
 * everything else — `chainid` included.
 *
 * That is an unwritten contract across three components. Any of them can break it silently: a
 * whatsabi version that URL-encodes the apiKey would collapse both params into one useless
 * `apikey` value, and the upstream request would fail with no chain selected. These tests pin
 * each half.
 */

const CHAIN_ID = 11155111;
const ADDRESS = "0x0000000000000000000000000000000000000001";

/** The query whatsabi actually builds, captured by stubbing fetch. */
async function captureLoaderQuery(apiKey: string): Promise<URLSearchParams> {
  const loader = new whatsabi.loaders.EtherscanABILoader({ apiKey, baseURL: "/api/etherscan" });

  let captured = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    captured = typeof input === "string" ? input : input.toString();
    return new Response(JSON.stringify({ status: "1", result: "[]" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await loader.loadABI(ADDRESS).catch(() => undefined);
  } finally {
    globalThis.fetch = realFetch;
  }

  // The baseURL is relative, so give it an origin purely to parse the query.
  return new URL(captured, "http://localhost").searchParams;
}

/** What `pages/api/etherscan.ts` forwards upstream, given the caller's query. */
function proxyForward(incoming: URLSearchParams, serverKey: string): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of incoming.entries()) {
    if (key === "apikey") continue;
    out.set(key, value);
  }
  out.set("apikey", serverKey);
  return out;
}

describe("Etherscan proxy query", () => {
  test("whatsabi splits the smuggled chainid into its own query parameter", async () => {
    const params = await captureLoaderQuery(`ignored&chainid=${CHAIN_ID}`);

    // If whatsabi ever encodes the apiKey, this collapses to one param and the test fails here.
    expect(params.get("chainid")).toBe(String(CHAIN_ID));
    expect(params.get("apikey")).toBe("ignored");
    expect(params.get("action")).toBe("getabi");
  });

  test("the proxy replaces apikey but preserves chainid", async () => {
    const params = await captureLoaderQuery(`ignored&chainid=${CHAIN_ID}`);
    const forwarded = proxyForward(params, "SERVER_KEY");

    expect(forwarded.get("chainid")).toBe(String(CHAIN_ID));
    expect(forwarded.get("apikey")).toBe("SERVER_KEY");
  });

  test("a caller cannot override the server key", () => {
    const incoming = new URLSearchParams({
      module: "contract",
      action: "getabi",
      address: ADDRESS,
      chainid: String(CHAIN_ID),
      apikey: "ATTACKER_KEY",
    });

    expect(proxyForward(incoming, "SERVER_KEY").get("apikey")).toBe("SERVER_KEY");
  });
});
