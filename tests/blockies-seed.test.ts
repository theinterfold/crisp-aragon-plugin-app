import { expect, test, describe } from "bun:test";
import { createImageData, parseOptions } from "blockies-ts";
import { getAddress } from "viem";

import { blockieDataUrl } from "../utils/blockies";

/**
 * INV: an address icon in this app must match the icon a block explorer draws for the same
 * account, because every address in the UI links straight to that explorer.
 *
 * The reference is Etherscan's own script. `etherscan.io/jss/blockies.js` defines
 * `window.blockies.create`, and `assets/js/custom/combine-js-bottom2.js` calls it as:
 *
 *     blockies.create({ seed: item.value.toLowerCase(), size: 8, scale: 16 })
 *
 * `blockies-ts` is a port of that same script — byte-identical PRNG, `createColor`,
 * `createImageData`, and the same call order — so it reproduces an Etherscan icon exactly when
 * the inputs match. Neither normalises the seed, so the icon is a pure function of (seed, size):
 *
 *   - seed MUST be lowercase. A checksummed seed gives a completely different icon.
 *   - size MUST be 8. `size` is the grid dimension, not a display scale: changing it changes how
 *     much randomness `createImageData` draws. `scale` is cosmetic and may differ freely.
 *
 * The trap this guards: ODS `MemberAvatar` seeds its OWN fallback with `getChecksum(address)`,
 * so relying on that default silently disagrees with every explorer. Components must pass an
 * explorer-seeded data URL into `src` to override it.
 */

/** Reproduces the Etherscan generator, seeding exactly as its call site does. */
function pattern(seed: string, size: number): number[] {
  // Re-seeds the shared PRNG and burns the three colour draws, matching Etherscan's call order.
  parseOptions({ seed, size, scale: 16 });
  return createImageData(size);
}

const ETHERSCAN_SIZE = 8;

/** What `votes-section.tsx` and `useBlockieDataUrl` must hand to the generator. */
const toSeed = (address: string | undefined) => (address ?? "").toLowerCase();

const CHECKSUMMED = "0x8837e47c4Bb520ADE83AAB761C3B60679443af1B";
const LOWERCASE = "0x8837e47c4bb520ade83aab761c3b60679443af1b";

/** The icon Etherscan renders for CHECKSUMMED. */
const etherscanReference = () => pattern(LOWERCASE, ETHERSCAN_SIZE);

describe("blockies seeding (INV: our icons must match the block explorer's)", () => {
  test("our seed + size reproduce the Etherscan icon exactly", () => {
    expect(pattern(toSeed(CHECKSUMMED), ETHERSCAN_SIZE)).toEqual(etherscanReference());
  });

  test("a checksummed input is normalised down to the explorer's seed", () => {
    expect(toSeed(CHECKSUMMED)).toEqual(LOWERCASE);
  });

  /** The original bug: seeding with viem's checksummed value straight from the logs. */
  test("a checksummed seed does NOT match Etherscan", () => {
    expect(pattern(CHECKSUMMED, ETHERSCAN_SIZE)).not.toEqual(etherscanReference());
  });

  /**
   * The second half of the bug, and the easier one to miss: `size` is the grid dimension, so
   * size 9 draws a different amount of randomness and yields a different pattern.
   */
  test("size 9 does NOT match Etherscan, even with the correct lowercase seed", () => {
    expect(pattern(LOWERCASE, 9)).not.toEqual(etherscanReference());
  });

  /** `scale` only affects the rendered pixel size, never which cells are filled. */
  test("scale does not affect the pattern", () => {
    parseOptions({ seed: LOWERCASE, size: ETHERSCAN_SIZE, scale: 4 });
    const atScale4 = createImageData(ETHERSCAN_SIZE);
    expect(atScale4).toEqual(etherscanReference());
  });

  /**
   * Guards the ODS trap directly: if this ever starts passing, ODS changed its seeding and the
   * `src` overrides in WalletContainer/ensMember/votesDataListItemStructure can be dropped.
   */
  test("ODS MemberAvatar's checksum-seeded default disagrees with Etherscan", () => {
    expect(pattern(getAddress(CHECKSUMMED), ETHERSCAN_SIZE)).not.toEqual(etherscanReference());
  });

  test("the generator is case-sensitive — if this fails, it started normalising", () => {
    expect(pattern(CHECKSUMMED, ETHERSCAN_SIZE)).not.toEqual(pattern(LOWERCASE, ETHERSCAN_SIZE));
  });

  test("a missing voter yields a stable empty seed instead of throwing", () => {
    expect(() => toSeed(undefined)).not.toThrow();
    expect(toSeed(undefined)).toEqual("");
    expect(toSeed("")).toEqual("");
  });

  test("different accounts still produce different icons", () => {
    const other = "0x652a31c669f9AB37f6040f279139a75D04F2679e";
    expect(pattern(toSeed(other), ETHERSCAN_SIZE)).not.toEqual(etherscanReference());
  });
});

/**
 * `blockieDataUrl` is the helper every avatar call site uses. It must be SYNCHRONOUS and
 * canvas-free: an effect-driven value leaves `src` empty on the first paint, and ODS
 * `MemberAvatar` fills an empty `src` with its own CHECKSUM-seeded blockie — so the user sees the
 * wrong icon briefly and then watches it change. That visible swap was the reported symptom.
 */
describe("blockieDataUrl (INV: correct on the first frame, never swaps)", () => {
  test("returns a data URL synchronously, with no canvas and no effect", () => {
    const url = blockieDataUrl(CHECKSUMMED);
    expect(url).toBeDefined();
    expect(url?.startsWith("data:image/svg+xml,")).toBe(true);
  });

  test("is deterministic — repeated calls give byte-identical output", () => {
    expect(blockieDataUrl(CHECKSUMMED)).toEqual(blockieDataUrl(CHECKSUMMED));
  });

  test("casing of the input does not matter — both normalise to the explorer seed", () => {
    expect(blockieDataUrl(CHECKSUMMED)).toEqual(blockieDataUrl(LOWERCASE));
  });

  test("encodes the explorer's own grid, not a checksum-seeded one", () => {
    const url = decodeURIComponent(blockieDataUrl(CHECKSUMMED)!);
    // One <rect> per filled cell, plus one for the background.
    const rects = (url.match(/<rect /g) ?? []).length;
    const filled = etherscanReference().filter((v) => v !== 0).length;
    expect(rects).toBe(filled + 1);
  });

  test("different accounts yield different data URLs", () => {
    expect(blockieDataUrl(CHECKSUMMED)).not.toEqual(blockieDataUrl("0x652a31c669f9AB37f6040f279139a75D04F2679e"));
  });

  test("a missing or malformed address yields undefined instead of a garbage icon", () => {
    expect(blockieDataUrl(undefined)).toBeUndefined();
    expect(blockieDataUrl("")).toBeUndefined();
    expect(blockieDataUrl("0x")).toBeUndefined();
    expect(blockieDataUrl("0x8837e47c4Bb520ADE83AAB761C3B60679443af")).toBeUndefined();
    expect(blockieDataUrl("not-an-address")).toBeUndefined();
  });

  test("generating one icon does not disturb the next — shared PRNG is re-seeded each call", () => {
    const first = blockieDataUrl(CHECKSUMMED);
    blockieDataUrl("0x652a31c669f9AB37f6040f279139a75D04F2679e");
    expect(blockieDataUrl(CHECKSUMMED)).toEqual(first);
  });
});
