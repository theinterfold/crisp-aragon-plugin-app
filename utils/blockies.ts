import { createImageData, parseOptions } from "blockies-ts";
import { isAddress } from "viem";

/**
 * Identicons identical to the ones block explorers draw for the same account.
 *
 * Etherscan generates its address icon in `assets/js/custom/addresspage4.js`:
 *
 *     blockies.create({ seed: address.toLowerCase(), size: 8, scale: 16 })
 *
 * and never overrides it with an ENS avatar — the blockie is the icon, always. `blockies-ts` is a
 * port of the same `etherscan.io/jss/blockies.js` script (byte-identical PRNG, `createColor`,
 * `createImageData`, same call order), so reusing its helpers reproduces an explorer icon exactly.
 *
 * Neither library normalises the seed, so the icon is a pure function of (seed, size) and BOTH
 * inputs have to be right:
 *
 *   - seed MUST be lowercase. A checksummed address yields a completely different icon.
 *   - size MUST be 8. `size` is the grid dimension, not a display scale — changing it changes how
 *     much randomness is drawn. `scale` only sets the rendered pixel size and is free to differ.
 */
export const EXPLORER_BLOCKIE_SIZE = 8;
export const EXPLORER_BLOCKIE_SCALE = 16;

/** The seed an explorer uses for an address. Exported so every call site shares one definition. */
export const toExplorerBlockieSeed = (address?: string): string => (address ?? "").toLowerCase();

/**
 * The explorer-identical blockie for an address, as an SVG data URL.
 *
 * Deliberately SYNCHRONOUS and canvas-free. `blockies-ts`'s `create()` needs a real `<canvas>`, so
 * it only works in the browser and only after mount — which forces an effect, leaves `src` empty
 * on the first paint, and makes the icon visibly change once the effect lands. Worse, ODS
 * `MemberAvatar` renders its OWN checksum-seeded blockie as the fallback whenever `src` is empty,
 * so that first frame shows the wrong icon.
 *
 * `parseOptions` and `createImageData` are pure (they only touch the module-level PRNG), so
 * building the SVG by hand renders identically on the server and the client: no effect, no
 * hydration mismatch, no swap, and `src` is populated from the very first frame.
 *
 * @param address The account to draw. Anything that is not a well-formed address yields
 *   `undefined` rather than a garbage icon.
 */
export const blockieDataUrl = (address?: string): string | undefined => {
  if (!address || !isAddress(address)) {
    return undefined;
  }

  // Seeds the PRNG and draws color/bgcolor/spotcolor, then the grid — the exact order
  // `blockies.create()` uses, so the same randomness lands in the same place.
  const opts = parseOptions({
    seed: toExplorerBlockieSeed(address),
    size: EXPLORER_BLOCKIE_SIZE,
    scale: EXPLORER_BLOCKIE_SCALE,
  });
  const data = createImageData(opts.size);

  const cells = Math.sqrt(data.length);
  const extent = opts.size * opts.scale;

  let rects = "";
  for (let i = 0; i < data.length; i++) {
    // 0 leaves the background showing, 1 is the foreground, 2 is the spot colour.
    if (!data[i]) continue;
    const row = Math.floor(i / cells);
    const column = i % cells;
    const fill = data[i] === 1 ? opts.color : opts.spotcolor;
    rects += `<rect x="${column * opts.scale}" y="${row * opts.scale}" width="${opts.scale}" height="${opts.scale}" fill="${fill}"/>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${extent}" height="${extent}" shape-rendering="crispEdges">` +
    `<rect width="${extent}" height="${extent}" fill="${opts.bgcolor}"/>${rects}</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
