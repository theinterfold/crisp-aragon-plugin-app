import Link from "next/link";
import { ProposalStatus } from "@aragon/ods";
import { PleaseWaitSpinner } from "@/components/please-wait";
import { useProposal } from "../../hooks/useProposal";
import { useProposalStatus } from "../../hooks/useProposalStatus";
import { unixTimestampToDate } from "../../utils/formatProposalDate";
import { AddressText } from "@/components/text/address";

const DEFAULT_PROPOSAL_METADATA_TITLE = "(No proposal title)";
const DEFAULT_PROPOSAL_METADATA_SUMMARY = "(The metadata of the proposal is not available)";

// Interfold earth-tone palette — matches the vote card option colors
const OPTION_COLORS = ["#2f8a4f", "#a84932", "#7a7d77", "#355a8a", "#8a6a40", "#5a4a8a", "#2f7a6a", "#9a7a30"];

type ProposalInputs = {
  proposalId: bigint;
  statusFilter?: ProposalStatus;
};

function LoadingRow({ proposalId, message }: { proposalId: bigint; message: string }) {
  return (
    <Link href={`#/proposals/${proposalId}`} className="proposal-row">
      <div className="num">E3 · …</div>
      <div className="body">
        <PleaseWaitSpinner fullMessage={message} />
      </div>
      <div className="right" />
    </Link>
  );
}

export default function ProposalCard(props: ProposalInputs) {
  const { proposal, e3Failed, status: proposalFetchStatus } = useProposal(props.proposalId);
  const proposalStatus = useProposalStatus(proposal!, e3Failed);

  const showLoading = getShowProposalLoading(proposal, proposalFetchStatus);
  const e3Label = proposal ? `E3 · ${proposal.e3Id.toString()}` : "E3 · …";

  // Hide row if it doesn't match the active filter (only once status is resolved)
  if (props.statusFilter && proposal && proposalStatus !== props.statusFilter) {
    return null;
  }

  if (!proposal && showLoading) {
    return <LoadingRow proposalId={props.proposalId} message="Loading proposal…" />;
  } else if (!proposal?.title && !proposal?.summary) {
    return <LoadingRow proposalId={props.proposalId} message="Loading metadata…" />;
  } else if (proposalFetchStatus.metadataReady && !proposal?.title) {
    return (
      <Link href={`#/proposals/${props.proposalId}`} className="proposal-row">
        <div className="num">{e3Label}</div>
        <div className="body">
          <h3 className="!text-neutral-300">{DEFAULT_PROPOSAL_METADATA_TITLE}</h3>
          <p className="summary !text-neutral-300">{DEFAULT_PROPOSAL_METADATA_SUMMARY}</p>
        </div>
        <div className="right" />
      </Link>
    );
  }

  const tally = Array.from(proposal?.tally ?? []);
  const options = proposal?.options ?? ["Yes", "No"];
  const totalVotes = tally.reduce((sum, count) => sum + (count ?? BigInt(0)), BigInt(0));
  const statusClass = (proposalStatus ?? "").toString().toLowerCase();
  const isActive = proposalStatus === ProposalStatus.ACTIVE;
  const endDate = Number(proposal!.parameters.endDate) * 1000;

  return (
    <Link href={`#/proposals/${props.proposalId}`} className="proposal-row">
      <div className="num">{e3Label}</div>
      <div className="body">
        <div className="meta">
          <span className={`badge ${statusClass}`}>{capitalize(proposalStatus)}</span>
        </div>
        <h3>{proposal!.title}</h3>
        <p className="summary line-clamp-2">{proposal!.summary}</p>
        <div className="author">
          <em>By</em>
          <AddressText bold={false}>{proposal!.creator}</AddressText>
        </div>
      </div>
      <div className="right">
        <span className="time">
          {isActive && endDate > Date.now()
            ? `Ends ${unixTimestampToDate(Math.round(endDate / 1000))}`
            : capitalize(proposalStatus)}
        </span>
        {totalVotes > BigInt(0) && (
          <div className="mini-bar" aria-hidden="true">
            {options.map((_, i) => {
              const v = tally[i] ?? BigInt(0);
              const width = Number((v * BigInt(10_000)) / totalVotes) / 100;
              if (width <= 0) return null;
              return (
                <span key={i} style={{ width: `${width}%`, background: OPTION_COLORS[i % OPTION_COLORS.length] }} />
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}

function capitalize(s?: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function getShowProposalLoading(
  proposal: ReturnType<typeof useProposal>["proposal"],
  status: ReturnType<typeof useProposal>["status"]
) {
  if (!proposal || status.proposalLoading) return true;
  else if (status.metadataLoading && !status.metadataError) return true;
  else if (!proposal?.title && !status.metadataError) return true;

  return false;
}
