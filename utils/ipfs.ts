import { PUB_IPFS_ENDPOINTS, PUB_APP_NAME } from "@/constants";
import { type Hex, fromHex, toBytes } from "viem";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

const IPFS_FETCH_TIMEOUT = 5000; // 1 second
const UPLOAD_FILE_NAME = `${PUB_APP_NAME.toLowerCase().trim().replaceAll(" ", "-")}.json`;

export function fetchIpfsAsJson(ipfsUri: string) {
  return fetchRawIpfs(ipfsUri).then((res) => res.json());
}

export function fetchIpfsAsText(ipfsUri: string) {
  return fetchRawIpfs(ipfsUri).then((res) => res.text());
}

export function fetchIpfsAsBlob(ipfsUri: string) {
  return fetchRawIpfs(ipfsUri).then((res) => res.blob());
}

export async function uploadToPinata(strBody: string) {
  // Pinned through our own `/api/ipfs/pin` route, which holds the credential
  // server-side. The JWT must never be a `NEXT_PUBLIC_*` var: Next inlines those
  // into the client bundle, handing every visitor a token that can pin arbitrary
  // content to — and burn the quota of — this account.
  const res = await fetch("/api/ipfs/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: strBody, name: UPLOAD_FILE_NAME }),
  });

  const resData = (await res.json()) as { uri?: string; error?: string };

  if (!res.ok || resData.error) throw new Error(resData.error ?? "Could not pin the metadata");
  else if (!resData.uri) throw new Error("Could not pin the metadata");
  return resData.uri;
}

export async function getContentCid(strMetadata: string) {
  const bytes = raw.encode(toBytes(strMetadata));
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, raw.code, hash);
  return `ipfs://${cid.toV1().toString()}`;
}

// Internal helpers

async function fetchRawIpfs(ipfsUri: string): Promise<Response> {
  if (!ipfsUri) throw new Error("Invalid IPFS URI");
  else if (ipfsUri.startsWith("0x")) {
    // fallback
    ipfsUri = fromHex(ipfsUri as Hex, "string");

    if (!ipfsUri) throw new Error("Invalid IPFS URI");
  }

  const uriPrefixes = PUB_IPFS_ENDPOINTS.split(",").filter((uri) => !!uri.trim());
  if (!uriPrefixes.length) throw new Error("No available IPFS endpoints to fetch from");

  const cid = resolvePath(ipfsUri);

  for (const uriPrefix of uriPrefixes) {
    const controller = new AbortController();
    const abortId = setTimeout(() => controller.abort(), IPFS_FETCH_TIMEOUT);
    const response = await fetch(`${uriPrefix}/${cid}`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(abortId);
    if (!response.ok) continue;

    return response; // .json(), .text(), .blob(), etc.
  }

  throw new Error("Could not connect to any of the IPFS endpoints");
}

function resolvePath(uri: string) {
  const path = uri.includes("ipfs://") ? uri.substring(7) : uri;
  return path;
}
