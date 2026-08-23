import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side JSON-RPC proxy so the provider API key never reaches the client bundle.
 *
 * The browser's viem transports point at `/api/rpc`; this forwards the JSON-RPC payload
 * verbatim to `WEB3_RPC_URL` (server-only env — no NEXT_PUBLIC_ prefix, so Next never
 * inlines it). Anything RPC-shaped passes through: the upstream node is the authority on
 * what is a valid request, and filtering methods here would only drift from it.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const upstream = process.env.WEB3_RPC_URL;
  if (!upstream) {
    return res.status(500).json({ error: "WEB3_RPC_URL is not configured" });
  }

  try {
    const response = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: "Upstream RPC request failed" });
  }
}
