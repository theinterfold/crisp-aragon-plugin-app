import type { NextApiRequest, NextApiResponse } from "next";
import { buildEtherscanUpstreamQuery } from "@/utils/etherscan-query";

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

/** How long to wait on Etherscan before giving up and freeing the slot. */
const UPSTREAM_TIMEOUT_MS = 10_000;

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
  for (const [key, value] of buildEtherscanUpstreamQuery(req.query, ETHERSCAN_API_KEY)) {
    url.searchParams.set(key, value);
  }

  // Bound the upstream call. Without a deadline a stalled Etherscan response holds this function
  // open until the platform's own, much longer, timeout — and enough concurrent stalls exhaust the
  // available concurrency for every other request.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const body = await upstream.text();

    res.setHeader("Content-Type", "application/json");

    if (!upstream.ok) {
      // Never cache a failure. The 502 below is OUR translation of an upstream error, and a shared
      // cache holding it for an hour would keep serving the failure long after Etherscan recovered.
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).send(body);
    }

    // ABIs are immutable for a given address; let the CDN absorb repeat lookups.
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return res.status(200).send(body);
  } catch (err) {
    const timedOut = (err as { name?: string })?.name === "AbortError";
    console.error("Etherscan proxy failed", timedOut ? `timed out after ${UPSTREAM_TIMEOUT_MS}ms` : err);
    // Same reasoning as the non-OK branch: a transient timeout must not be cached.
    res.setHeader("Cache-Control", "no-store");
    return res.status(timedOut ? 504 : 502).json({
      status: "0",
      message: "NOTOK",
      result: timedOut ? "Upstream request timed out" : "Upstream request failed",
    });
  } finally {
    clearTimeout(deadline);
  }
}
