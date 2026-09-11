import Blockies from "react-blockies";
import type { VoteCastEvent } from "../../utils/types";
import { formatUnits } from "viem";
import { AddressText } from "@/components/text/address";
import { Card } from "@aragon/ods";
import { compactNumber } from "@/utils/numbers";
import { If } from "@/components/if";

export default function VotesSection({ votes }: { votes: Array<VoteCastEvent> }) {
  return (
    <div className="mb-14 mt-2 grid grid-cols-1 lg:grid-cols-3">
      <div>
        <If not={votes.length}>
          <p>The proposal has no votes</p>
        </If>
        <div className="grid gap-2">
          {votes.map((veto, i) => (
            <VetoCard key={i} veto={veto} />
          ))}
        </div>
      </div>
    </div>
  );
}

const VetoCard = function ({ veto }: { veto: VoteCastEvent }) {
  return (
    <Card className="p-3">
      <div className="space-between flex flex-row">
        <div className="flex flex-grow">
          {/* Seeded with the LOWERCASED address at size 8, exactly how Etherscan draws its address
              icons (`etherscan.io/jss/blockies.js`, called from `assets/js/custom/addresspage4.js`
              as `blockies.create({ seed: address.toLowerCase(), size: 8, scale: 16 })`).

              react-blockies is a port of that same script and does not normalise the seed, so both
              inputs have to match: a checksummed seed yields a different icon, and `size` is the
              grid dimension rather than a display scale, so size 9 changes the pattern too.
              `scale` is the cosmetic knob and is free to differ. */}
          <Blockies className="rounded-3xl" size={8} seed={(veto?.voter ?? "").toLowerCase()} />
          <div className="px-2">
            <AddressText>{veto?.voter}</AddressText>
            <p className="text-sm text-neutral-600">
              {compactNumber(formatUnits(veto.votingPower || BigInt(0), 18))} votes
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
};
