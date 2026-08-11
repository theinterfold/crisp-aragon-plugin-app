import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Server-side Pinata proxy.
 *
 * The pinning credential MUST NOT be a `NEXT_PUBLIC_*` variable: Next inlines
 * those into the client bundle, which would hand every visitor a token that can
 * pin arbitrary content to (and burn the quota of) this account. `PINATA_JWT` is
 * read here, on the server, and never reaches the browser.
 */
const PINATA_JWT = process.env.PINATA_JWT ?? "";
const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

/** Proposal metadata is a small JSON blob; anything larger is not ours. */
const MAX_BODY_BYTES = 512 * 1024;

export const config = {
  api: {
    bodyParser: { sizeLimit: "512kb" },
  },
};

type PinResponse = { uri: string } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<PinResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!PINATA_JWT) {
    console.error("PINATA_JWT is not configured on the server");
    return res.status(500).json({ error: "Pinning is not configured" });
  }

  const { content, name } = (req.body ?? {}) as { content?: unknown; name?: unknown };

  if (typeof content !== "string" || content.length === 0) {
    return res.status(400).json({ error: "Expected a non-empty string `content`" });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "Content too large" });
  }

  // Filename is cosmetic on Pinata's side; keep it to a safe, bounded slug so a
  // caller cannot inject arbitrary metadata into the pin record.
  const fileName = typeof name === "string" ? name.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64) : "";
  const safeName = fileName || "metadata.json";

  try {
    const form = new FormData();
    form.append("file", new Blob([content], { type: "text/plain" }), safeName);
    form.append("pinataMetadata", JSON.stringify({ name: safeName }));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const pinRes = await fetch(PINATA_PIN_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });

    const data = (await pinRes.json()) as { IpfsHash?: string; error?: unknown };

    if (!pinRes.ok || !data.IpfsHash) {
      // Deliberately not forwarding Pinata's body — it can echo account details.
      console.error("Pinata pin failed", pinRes.status, data.error);
      return res.status(502).json({ error: "Could not pin the metadata" });
    }

    return res.status(200).json({ uri: `ipfs://${data.IpfsHash}` });
  } catch (err) {
    console.error("Pinata pin threw", err);
    return res.status(502).json({ error: "Could not pin the metadata" });
  }
}
