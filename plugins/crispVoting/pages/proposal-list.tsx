import { useAccount, useBlockNumber } from "wagmi";
import { useCallback, useEffect, useRef, useState } from "react";
import ProposalCard from "../components/proposal";
import {
  Button,
  DataList,
  IconType,
  ProposalDataListItemSkeleton,
  ProposalStatus,
  type DataListState,
} from "@aragon/ods";
import classNames from "classnames";
import { useCanCreateProposal } from "../hooks/useCanCreateProposal";
import Link from "next/link";
import { Else, If, Then } from "@/components/if";
import { PUB_CRISP_VOTING_PLUGIN_ADDRESS, PUB_DEPLOYMENT_BLOCK } from "@/constants";
import { MainSection } from "@/components/layout/main-section";
import { MissingContentView } from "@/components/MissingContentView";
import { ProposalCreatedEvent } from "../hooks/useProposal";
import type { RawAction } from "@/utils/types";
import type { Hex } from "viem";
import { publicClient } from "../utils/client";

const DEFAULT_PAGE_SIZE = 6;

const FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: ProposalStatus.ACTIVE },
  { label: "Accepted", value: ProposalStatus.ACCEPTED },
  { label: "Executable", value: ProposalStatus.EXECUTABLE },
  { label: "Executed", value: ProposalStatus.EXECUTED },
  { label: "Failed", value: ProposalStatus.FAILED },
  { label: "Rejected", value: ProposalStatus.REJECTED },
];

interface ProposalCreatedLog {
  proposalId: bigint;
  creator: string;
  startDate: bigint;
  endDate: bigint;
  metadata: Hex;
  actions: RawAction[];
  allowFailureMap: bigint;
}

export default function Proposals() {
  const { isConnected } = useAccount();
  const canCreate = useCanCreateProposal();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const [proposalIds, setProposalIds] = useState<bigint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const lastFetchedBlock = useRef<bigint | null>(null);

  const fetchProposals = useCallback(async () => {
    if (!publicClient || !blockNumber || !PUB_DEPLOYMENT_BLOCK || !ProposalCreatedEvent) {
      return;
    }

    const fromBlock = lastFetchedBlock.current ? lastFetchedBlock.current + 1n : BigInt(PUB_DEPLOYMENT_BLOCK);

    // Nothing new to fetch
    if (lastFetchedBlock.current && fromBlock > blockNumber) return;

    try {
      const logs = await publicClient
        .getLogs({
          address: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
          event: ProposalCreatedEvent,
          fromBlock,
          toBlock: blockNumber,
        })
        .catch((err) => {
          console.error("Could not fetch the proposals", err);
        });

      lastFetchedBlock.current = blockNumber;

      if (!logs || !Array.isArray(logs) || !logs.length) {
        // Only clear on initial fetch, not on incremental updates
        if (!lastFetchedBlock.current || fromBlock === BigInt(PUB_DEPLOYMENT_BLOCK)) {
          setProposalIds((prev) => (prev.length ? prev : []));
        }
        return;
      }

      const newIds = logs
        .map((log) => {
          const args = log.args as unknown as ProposalCreatedLog;
          return args?.proposalId;
        })
        .filter((id): id is bigint => id !== undefined);

      if (newIds.length > 0) {
        setProposalIds((prev) => {
          const existingSet = new Set(prev.map((id) => id.toString()));
          const unique = newIds.filter((id) => !existingSet.has(id.toString()));
          // New proposals go to the front (newest first)
          return [...unique.reverse(), ...prev];
        });
      }
    } catch (err) {
      setError(`Could not fetch proposals`);
    } finally {
      setIsLoading(false);
    }
  }, [blockNumber]);

  useEffect(() => {
    fetchProposals();
  }, [blockNumber, fetchProposals]);

  const proposalCount = proposalIds.length;
  const entityLabel = proposalCount === 1 ? "Proposal" : "Proposals";

  let dataListState: DataListState = "idle";
  if (isLoading && !proposalCount) {
    dataListState = "initialLoading";
  } else if (error) {
    dataListState = "error";
  } else if (isLoading) {
    dataListState = "loading";
  }

  return (
    <MainSection narrow={true}>
      <div className="page-head w-full">
        <div>
          <div className="kicker mb-3">02 · Governance</div>
          <h1 className="display-title">Proposals</h1>
        </div>
        <div className="justify-self-end">
          <If true={isConnected && canCreate}>
            <Link href="#/new">
              <Button iconLeft={IconType.PLUS} size="md" variant="primary">
                Submit Proposal
              </Button>
            </Link>
          </If>
        </div>
      </div>

      <If not={proposalCount}>
        <Then>
          <MissingContentView>
            No proposals have been created yet. Here you will see the available proposals.{" "}
            <If true={canCreate}>Create your first proposal.</If>
          </MissingContentView>
        </Then>
        <Else>
          <div className="chips">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={classNames("chip", { on: statusFilter === f.value })}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <DataList.Root
            entityLabel={entityLabel}
            itemsCount={proposalCount}
            pageSize={DEFAULT_PAGE_SIZE}
            state={dataListState}
          >
            <DataList.Container layoutClassName="proposal-list" SkeletonElement={ProposalDataListItemSkeleton}>
              {proposalIds.map((proposalId) => (
                <ProposalCard
                  key={proposalId}
                  proposalId={proposalId}
                  statusFilter={statusFilter !== "all" ? (statusFilter as ProposalStatus) : undefined}
                />
              ))}
            </DataList.Container>
            <DataList.Pagination />
          </DataList.Root>
        </Else>
      </If>
    </MainSection>
  );
}
