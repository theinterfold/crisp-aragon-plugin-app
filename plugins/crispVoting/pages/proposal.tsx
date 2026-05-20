import { useProposal } from "../hooks/useProposal";
import ProposalHeader from "../components/proposal/header";
import { PleaseWaitSpinner } from "@/components/please-wait";
import { BodySection } from "@/components/proposal/proposalBodySection";
import { useProposalStatus } from "../hooks/useProposalStatus";
import { ProposalActions } from "@/components/proposalActions/proposalActions";
import { CardResources } from "@/components/proposal/cardResources";
import type { Address } from "viem";
import { ElseIf, If, Then } from "@/components/if";
import { AlertCard, ProposalStatus } from "@aragon/ods";
import { useAccount } from "wagmi";
import { useTokenVotes } from "@/hooks/useTokenVotes";
import { ADDRESS_ZERO } from "@/utils/evm";
import { AddressText } from "@/components/text/address";
import Link from "next/link";
import { useCanVote } from "../hooks/useCanVote";
import { VoteCard } from "../components/vote/voteCard";
import { useCrispServer } from "../hooks/useCrispServer";
import { VoteResultCard } from "../components/vote/voteResultCard";
import { useMemo } from "react";

const ZERO = BigInt(0);

export default function ProposalDetail({ index: proposalIdx }: { index: bigint }) {
  const { address } = useAccount();
  const { isLoading, error, postVote, votingStep, lastActiveStep, stepMessage, txHash } = useCrispServer();
  const { proposal, isCommitteeReady, totalVotingPower, status: proposalFetchStatus } = useProposal(proposalIdx);
  const canVote = useCanVote(proposalIdx);
  const { balance, delegatesTo } = useTokenVotes(address);

  const showProposalLoading = getShowProposalLoading(proposal, proposalFetchStatus);
  const proposalStatus = useProposalStatus(proposal!, totalVotingPower);

  const results = useMemo(() => {
    if (!proposal || !proposal.options || !proposal.tally) return undefined;

    return proposal.options.map((option, idx) => ({
      option,
      value: proposal.tally[idx]?.toString() ?? "0",
    }));
  }, [proposal]);

  const options = useMemo(() => {
    return proposal?.options ?? ["Yes", "No"];
  }, [proposal]);

  const onVote = (optionIndex: number) => {
    if (!proposal) {
      return;
    }

    postVote(BigInt(optionIndex), proposal.e3Id);
  };

  const onMask = () => {
    if (!proposal) return;
    // Mask uses the next index after the last option
    postVote(BigInt(options.length), proposal.e3Id, true);
  };

  const hasBalance = !!balance && balance > ZERO;
  const delegatingToSomeoneElse = !!delegatesTo && delegatesTo !== address && delegatesTo !== ADDRESS_ZERO;
  const delegatedToZero = !!delegatesTo && delegatesTo === ADDRESS_ZERO;

  if (!proposal || showProposalLoading) {
    return (
      <section className="justify-left items-left flex w-screen min-w-full max-w-full">
        <PleaseWaitSpinner />
      </section>
    );
  }

  return (
    <section className="flex w-screen min-w-full max-w-full flex-col items-center">
      <ProposalHeader proposalIdx={proposalIdx} proposal={proposal} totalVotingPower={totalVotingPower} />

      <div className="mx-auto w-full max-w-screen-xl px-4 py-6 md:px-16 md:pb-20 md:pt-10">
        <div className="flex w-full flex-col gap-x-12 gap-y-6 md:flex-row">
          <div className="flex flex-col gap-y-6 md:w-[63%] md:shrink-0">
            <BodySection body={proposal.description || "No description was provided"} />
            <If all={[hasBalance, delegatingToSomeoneElse || delegatedToZero]}>
              <NoVotePowerWarning
                delegatingToSomeoneElse={delegatingToSomeoneElse}
                delegatesTo={delegatesTo}
                delegatedToZero={delegatedToZero}
                address={address}
                canVote={!!canVote}
              />
            </If>
            <ProposalActions actions={proposal.actions} />
          </div>
          <div className="flex flex-col gap-y-6 md:sticky md:top-24 md:w-[33%] md:self-start">
            {proposalStatus === ProposalStatus.ACTIVE && (
              <VoteCard
                error={canVote === false ? "You cannot vote on this proposal" : undefined}
                voteStartDate={Number(proposal?.parameters.startDate)}
                voteEndDate={Number(proposal?.parameters.endDate)}
                isCommitteeReady={isCommitteeReady}
                options={options}
                disabled={
                  isCommitteeReady === false ||
                  canVote === false ||
                  proposalStatus !== ProposalStatus.ACTIVE ||
                  Number(proposal?.parameters.startDate) > Math.round(Date.now() / 1000)
                }
                isLoading={isLoading}
                onClickVote={onVote}
                onClickMask={onMask}
                proposalId={proposalIdx}
                votingStep={votingStep}
                lastActiveStep={lastActiveStep}
                stepMessage={stepMessage}
                txHash={txHash}
              />
            )}
            {error && (
              <div className="border border-critical-200 bg-critical-100 px-4 py-3">
                <p className="text-sm text-critical-600">{error}</p>
              </div>
            )}
            {proposalStatus !== ProposalStatus.ACTIVE && (
              <VoteResultCard
                isSignalling={proposal.actions && proposal.actions.length === 0}
                proposalId={proposalIdx}
                results={results}
                isTallied={proposal.isTallied}
              />
            )}
            <CardResources resources={proposal.resources} title="Resources" />
          </div>
        </div>
      </div>
    </section>
  );
}

const NoVotePowerWarning = ({
  delegatingToSomeoneElse,
  delegatesTo,
  delegatedToZero,
  address,
  canVote,
}: {
  delegatingToSomeoneElse: boolean;
  delegatesTo: Address | undefined;
  delegatedToZero: boolean;
  address: Address | undefined;
  canVote: boolean;
}) => {
  return (
    <AlertCard
      description={
        <span className="text-sm">
          <If true={delegatingToSomeoneElse}>
            <Then>
              You are currently delegating your voting power to <AddressText bold={false}>{delegatesTo}</AddressText>.
              If you wish to participate by yourself in future proposals,
            </Then>
            <ElseIf true={delegatedToZero}>
              You have not self delegated your voting power to participate in the DAO. If you wish to participate in
              future proposals,
            </ElseIf>
          </If>
          &nbsp;make sure that{" "}
          <Link href={`/plugins/members/#/delegates/${address}`} className="!text-sm text-primary-400 hover:underline">
            your voting power is self delegated
          </Link>
          .
        </span>
      }
      message={
        delegatingToSomeoneElse
          ? "Your voting power is currently delegated"
          : canVote
            ? "You cannot vote on new proposals"
            : "You cannot vote"
      }
      variant="info"
    />
  );
};

function getShowProposalLoading(
  proposal: ReturnType<typeof useProposal>["proposal"],
  status: ReturnType<typeof useProposal>["status"]
) {
  if (!proposal && status.proposalLoading) return true;
  else if (status.metadataLoading && !status.metadataError) return true;
  else if (!proposal?.title && !status.metadataError) return true;

  return false;
}
