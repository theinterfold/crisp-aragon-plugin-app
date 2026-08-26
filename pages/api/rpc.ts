import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side JSON-RPC proxy so the provider API key never reaches the client bundle.
 *
 * The browser's viem transports point at `/api/rpc`; this forwards the JSON-RPC payload
 * verbatim to `WEB3_RPC_URL` (server-only env — no NEXT_PUBLIC_ prefix, so Next never
 * inlines it). Anything RPC-shaped passes through: the upstream node is the authority on
 * what is a valid request, and filtering methods here would only drift from it.
 */

/** How long to wait on the upstream provider before giving up, rather than holding the request. */
const UPSTREAM_TIMEOUT_MS = 20_000;

/**
 * Keep the provider URL — which carries the API key — out of anything sent to the client or
 * written to a log an operator might paste somewhere.
 */
function redact(value: unknown, upstream: string): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return text.split(upstream).join("<WEB3_RPC_URL>");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const upstream = process.env.WEB3_RPC_URL;
  if (!upstream) {
    // Server-only env, so this is invisible from the browser: say it plainly in both places or
    // a deployment that simply never had the variable set looks like a broken provider.
    console.error("[api/rpc] WEB3_RPC_URL is not set in this environment");
    return res.status(500).json({ error: "WEB3_RPC_URL is not configured" });
  }

  try {
    const response = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // Read as text, not JSON: a rate-limited or gateway-errored provider answers with HTML or an
    // empty body, and `response.json()` throwing on that turned every such reply into an opaque
    // 502 with the actual cause discarded.
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("json")) {
      res.setHeader("Content-Type", "application/json");
      return res.status(response.status).send(body);
    }

    console.error(
      `[api/rpc] upstream returned ${response.status} (${contentType || "no content-type"}): ${body.slice(0, 500)}`
    );
    return res.status(502).json({
      error: `Upstream RPC returned ${response.status} with a non-JSON body`,
    });
  } catch (error) {
    console.error(`[api/rpc] upstream request failed: ${redact(error, upstream)}`);
    return res.status(502).json({
      error: "Upstream RPC request failed",
      detail: redact(error, upstream),
    });
  }
}
