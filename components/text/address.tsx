import { formatHexString } from "@/utils/evm";
import { getChildrenText } from "@/utils/content";
import { type ReactNode, useState, useEffect } from "react";
import { usePublicClient } from "wagmi";
// import { Link } from '@aragon/ods'

/**
 * An address, linked to the block explorer.
 *
 * `linked={false}` renders the same text without the anchor, for the one place it cannot have
 * one: inside another link. Nested `<a>` elements are invalid HTML — React warns about it, and
 * browsers recover by splitting the outer link, so the row stops being uniformly clickable. It is
 * also ambiguous to the reader, since clicking the author of a proposal row would leave the app
 * for the explorer rather than opening the proposal.
 */
export const AddressText = ({
  children,
  bold,
  linked = true,
}: {
  children: ReactNode;
  bold?: boolean;
  linked?: boolean;
}) => {
  const address = getChildrenText(children);
  const client = usePublicClient();
  const [link, setLink] = useState<string>();

  const useBold = bold === undefined ? true : bold;

  useEffect(() => {
    if (!client) return;

    setLink(`${client.chain.blockExplorers?.default.url}/address/${address}`);
  }, [address, client]);

  const formattedAddress = formatHexString(address.trim());
  // The unlinked branch is also what renders before the effect resolves `link`, which is why the
  // nesting warning only appeared after hydration rather than on first paint.
  if (!link || !linked) {
    return <span className={(useBold ? "font-semibold" : "") + " text-primary-400 underline"}>{formattedAddress}</span>;
  }
  return (
    <>
      <a href={link} target="_blank" className={(useBold ? "font-semibold" : "") + " text-primary-400 underline"}>
        {formattedAddress}
      </a>
    </>
  );
};
