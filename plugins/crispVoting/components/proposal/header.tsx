import { ProposalStatus } from "@aragon/ods";
import Link from "next/link";
import type { Proposal } from "../../utils/types";
import { useProposalStatus } from "../../hooks/useProposalStatus";
import { HeaderSection } from "@/components/layout/header-section";
import { capitalizeFirstLetter } from "@/utils/text";
import { AddressText } from "@/components/text/address";
import { useEffect, useState } from "react";

const DEFAULT_PROPOSAL_TITLE = "(No proposal title)";
const DEFAULT_PROPOSAL_SUMMARY = "(No proposal summary)";

interface ProposalHeaderProps {
  proposalIdx: bigint;
  proposal: Proposal;
  totalVotingPower?: bigint;
}

const ProposalHeader: React.FC<ProposalHeaderProps> = ({ proposalIdx, proposal, totalVotingPower }) => {
  const proposalStatus = useProposalStatus(proposal, totalVotingPower);
  const countdown = useCountdown(Number(proposal.parameters.endDate) * 1000);

  const statusClass = (proposalStatus ?? "").toString().toLowerCase();
  const isEmergency = proposal.parameters.startDate === 0n;
  const endDateIsInThePast = Number(proposal.parameters.endDate) * 1000 < Date.now();

  let endLabel: string;
  if (proposalStatus === ProposalStatus.ACCEPTED) endLabel = "Accepted";
  else if (proposalStatus === ProposalStatus.REJECTED) endLabel = "Rejected";
  else if (endDateIsInThePast) endLabel = "Voting closed";
  else endLabel = `Ends in ${countdown}`;

  return (
    <div className="flex w-full justify-center bg-neutral-0">
      <HeaderSection>
        {/* Breadcrumb / kicker */}
        <div className="flex items-center gap-3">
          <Link href="#/" className="detail-kicker hover:text-neutral-800">
            Proposals
          </Link>
          <span className="detail-kicker">/</span>
          <span className="detail-kicker">E3 · {proposal.e3Id.toString()}</span>
        </div>

        <div className="flex w-full flex-col">
          <div className="flex flex-wrap items-center gap-3">
            {proposalStatus && <span className={`badge ${statusClass}`}>{capitalizeFirstLetter(proposalStatus)}</span>}
            {isEmergency && <span className="badge failed">Emergency</span>}
          </div>
          <h1 className="detail-title">{proposal.title || DEFAULT_PROPOSAL_TITLE}</h1>
          <p className="detail-summary">{proposal.summary || DEFAULT_PROPOSAL_SUMMARY}</p>
        </div>

        {/* Metadata */}
        <div className="detail-meta">
          <div className="item">
            <div className="lbl">Proposer</div>
            <div className="val">
              <AddressText bold={false}>{proposal.creator}</AddressText>
            </div>
          </div>
          <div className="item">
            <div className="lbl">Status</div>
            <div className="val">{proposalStatus ? capitalizeFirstLetter(proposalStatus) : "—"}</div>
          </div>
          <div className="item">
            <div className="lbl">{endDateIsInThePast ? "Window" : "Ends"}</div>
            <div className="val">{endLabel}</div>
          </div>
        </div>
      </HeaderSection>
    </div>
  );
};

export default ProposalHeader;

function useCountdown(endTimestampMs: number): string {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const remaining = endTimestampMs - Date.now();
    if (remaining <= 0) return;

    // Update every second when < 1 minute, every minute otherwise
    const intervalMs = remaining < 60_000 ? 1_000 : 60_000;
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [endTimestampMs, now < endTimestampMs]);

  const diff = endTimestampMs - now;
  if (diff <= 0) return "0 seconds";

  const seconds = Math.floor(diff / 1_000) % 60;
  const minutes = Math.floor(diff / 60_000) % 60;
  const hours = Math.floor(diff / 3_600_000) % 24;
  const days = Math.floor(diff / 86_400_000);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
