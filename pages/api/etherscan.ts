import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side Etherscan V2 proxy.
 *
 * Keeps `ETHERSCAN_API_KEY` off the client (a `NEXT_PUBLIC_*` key is inlined into
 * the bundle and trivially scraped, and Etherscan keys are rate-limited per key).
 * The browser calls this route with the same query params it would have sent to
 * Etherscan; the key is appended here.
 *
 * Only the read-only endpoints the app actually needs are allowed through, so the
 * route cannot be repurposed as an open Etherscan relay.
 */
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";
const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";

/** `module` → allowed `action`s. Everything else is rejected. */
const ALLOWED: Record<string, Set<string>> = {
  contract: new Set(["getabi", "getsourcecode"]),
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ status: "0", message: "NOTOK", result: "Method not allowed" });
  }

  if (!ETHERSCAN_API_KEY) {
    console.error("ETHERSCAN_API_KEY is not configured on the server");
    return res.status(500).json({ status: "0", message: "NOTOK", result: "Etherscan is not configured" });
  }

  const scanModule = String(req.query.module ?? "");
  const action = String(req.query.action ?? "").toLowerCase();

  if (!ALLOWED[scanModule]?.has(action)) {
    return res.status(400).json({ status: "0", message: "NOTOK", result: "Unsupported module/action" });
  }

  const url = new URL(ETHERSCAN_V2);
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "apikey") continue; // never let a caller override the server key
    url.searchParams.set(key, Array.isArray(value) ? (value[0] ?? "") : String(value ?? ""));
  }
  url.searchParams.set("apikey", ETHERSCAN_API_KEY);

  try {
    const upstream = await fetch(url, { headers: { accept: "application/json" } });
    const body = await upstream.text();

    // ABIs are immutable for a given address; let the CDN absorb repeat lookups.
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("Content-Type", "application/json");
    return res.status(upstream.ok ? 200 : 502).send(body);
  } catch (err) {
    console.error("Etherscan proxy failed", err);
    return res.status(502).json({ status: "0", message: "NOTOK", result: "Upstream request failed" });
  }
}
