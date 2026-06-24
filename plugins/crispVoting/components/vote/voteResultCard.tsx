"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, ProposalStatus } from "@aragon/ods";
import { useProposalExecute } from "../../hooks/useProposalExecute";
import { useToken } from "../../hooks/useToken";
import { usePastSupply } from "../../hooks/usePastSupply";
import { computeQuorum, isSignalingOnly, tallyCountToTokens } from "../../utils/quorum";
import { CreditsMode } from "../../utils/types";
import { describeE3Failure, type E3FailureReason } from "../../hooks/useE3Status";

interface IResult {
  option: string;
  value: string;
}

interface VoteResultCardProps {
  results?: IResult[];
  proposalId: bigint;
  isSignalling?: boolean;
  isTallied?: boolean;
  /** Authoritative status from useProposalStatus (already factors in quorum). */
  proposalStatus?: ProposalStatus;
  /** Quorum requirement (minParticipation) as a percentage (0-100) of total voting power. */
  minParticipation?: number;
  /** Snapshot block — used to read the total voting power the quorum is measured against. */
  snapshotBlock?: bigint;
  /** Number of options — together with creditMode determines whether this is a signaling-only poll. */
  numOptions?: number;
  /** Credit mode — controls whether the tally is scaled (token mode) or raw (CONSTANT). */
  creditMode?: CreditsMode;
  /** The encrypted vote round failed on-chain (e.g. committee/DKG failure). */
  e3Failed?: boolean;
  /** The on-chain failure reason, when `e3Failed` is set. */
  e3FailureReason?: E3FailureReason;
}

// Interfold earth-tone palette — matches the vote card option colors
const OPTION_COLORS = ["#2f8a4f", "#a84932", "#7a7d77", "#355a8a", "#8a6a40", "#5a4a8a", "#2f7a6a", "#9a7a30"];

function getColor(index: number): string {
  return OPTION_COLORS[index % OPTION_COLORS.length];
}

/** Compact human-friendly amount: trims trailing zeros, keeps up to 4 decimals. */
function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

interface OutcomeArgs {
  total: number;
  winner: { option: string; index: number } | null;
  resultsWithPercentage: { index: number; percentage: number }[];
  proposalStatus?: ProposalStatus;
  quorum: { reached: boolean } | null;
}

/** Footer message that reflects the authoritative status, not just the raw vote leader. */
function getOutcome({ total, winner, resultsWithPercentage, proposalStatus, quorum }: OutcomeArgs) {
  if (total === 0) return "No votes were cast";

  const winnerPct = winner ? resultsWithPercentage.find((r) => r.index === winner.index)?.percentage.toFixed(1) : null;

  // Quorum failed: the leading option may have 100% of votes cast, but turnout
  // was too low for the proposal to pass.
  if (proposalStatus === ProposalStatus.FAILED || (quorum && !quorum.reached)) {
    return winner ? (
      <span style={{ color: "var(--muted-ink, #9a9a9a)" }}>
        Failed — quorum not reached ({winner.option} led with {winnerPct}% of votes cast)
      </span>
    ) : (
      "Failed — quorum not reached"
    );
  }

  if (proposalStatus === ProposalStatus.REJECTED) {
    return <span style={{ color: "var(--muted-ink, #9a9a9a)" }}>Rejected</span>;
  }

  if (!winner) return "Tied — no clear winner";

  return (
    <span style={{ color: getColor(winner.index) }}>
      {winner.option} won with {winnerPct}%
    </span>
  );
}

export const VoteResultCard = ({
  results,
  proposalId,
  isSignalling,
  isTallied = true,
  proposalStatus,
  minParticipation,
  snapshotBlock,
  numOptions,
  creditMode,
  e3Failed,
  e3FailureReason,
}: VoteResultCardProps) => {
  const { executeProposal, canExecute, isConfirming: isConfirmingExecution } = useProposalExecute(proposalId);
  const { decimals, symbol } = useToken();
  const pastSupply = usePastSupply(snapshotBlock);
  const [isVisible, setIsVisible] = useState(false);

  const tokenDecimals = Number(decimals ?? 18);
  const unitLabel = creditMode === CreditsMode.CONSTANT ? "credits" : symbol && symbol.length > 0 ? symbol : "tokens";

  const parsedResults = useMemo(() => {
    if (!results) return [];
    return results.map((r, idx) => ({
      option: r.option,
      value: Number(r.value),
      tokens: tallyCountToTokens(BigInt(r.value || "0"), creditMode, tokenDecimals),
      index: idx,
    }));
  }, [results, creditMode, tokenDecimals]);

  const total = useMemo(() => parsedResults.reduce((sum, r) => sum + r.value, 0), [parsedResults]);
  const totalTokens = useMemo(() => parsedResults.reduce((sum, r) => sum + r.tokens, 0), [parsedResults]);

  // Quorum mirrors the contract: turnout (scaled votes) vs. minParticipation% of
  // the total voting power at the snapshot block. Signaling-only polls have none.
  const quorum = useMemo(() => {
    const signaling = isSignalingOnly(numOptions ?? results?.length ?? 0, creditMode);
    if (signaling || minParticipation == null || !pastSupply || !results) return null;

    const totalVotes = results.reduce((sum, r) => sum + BigInt(r.value || "0"), 0n);
    return computeQuorum(totalVotes, pastSupply, minParticipation, creditMode, tokenDecimals);
  }, [numOptions, minParticipation, pastSupply, results, creditMode, tokenDecimals]);

  const resultsWithPercentage = useMemo(() => {
    return parsedResults
      .map((r) => ({ ...r, percentage: total > 0 ? (r.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [parsedResults, total]);

  const winner = useMemo(() => {
    if (total === 0) return null;
    const sorted = [...parsedResults].sort((a, b) => b.value - a.value);
    if (sorted.length < 2) return sorted[0] ?? null;
    if (sorted[0].value === sorted[1].value) return null; // tie
    return sorted[0];
  }, [parsedResults, total]);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  if (!results || results.length === 0) {
    return null;
  }

  if (e3Failed) {
    return (
      <div className="vote-panel">
        <div className="vp-head">
          <h3>Result</h3>
          <span className="vp-meta" style={{ color: "var(--critical, #a84932)" }}>
            Failed
          </span>
        </div>
        <div className="vp-body items-center text-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ color: "var(--critical, #a84932)" }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
            <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="vp-note text-center" style={{ fontWeight: 600 }}>
            The encrypted vote round failed
          </p>
          <p className="vp-note text-center">
            {describeE3Failure(e3FailureReason)} This proposal could not be tallied or executed.
          </p>
        </div>
      </div>
    );
  }

  if (!isTallied) {
    return (
      <div className="vote-panel">
        <div className="vp-head">
          <h3>Result</h3>
          <span className="vp-meta">Tallying</span>
        </div>
        <div className="vp-body items-center text-center">
          <svg
            className="animate-spin"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            style={{ color: "var(--accent)" }}
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <p className="vp-note text-center">
            Results are being tallied by the committee. This may take a few minutes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vote-panel" style={{ opacity: isVisible ? 1 : 0, transition: "opacity 500ms" }}>
      <div className="vp-head">
        <h3>Result</h3>
        <span className="vp-meta">
          {formatAmount(totalTokens)} {unitLabel}
        </span>
      </div>

      <div className="vp-body" style={{ gap: 0 }}>
        {resultsWithPercentage.map((result) => {
          const isWinner = winner?.index === result.index;
          return (
            <div key={result.index} className="tally-row">
              <span className="key">
                <span className="swatch" style={{ background: getColor(result.index) }} />
                <span className="truncate" style={{ color: isWinner ? "var(--ink)" : undefined }}>
                  {result.option}
                </span>
              </span>
              <span className="bar">
                <span style={{ width: `${Math.max(result.percentage, 0)}%`, background: getColor(result.index) }} />
              </span>
              <span className="pct" title={`${formatAmount(result.tokens)} ${unitLabel}`}>
                {result.percentage.toFixed(1)}%
              </span>
            </div>
          );
        })}

        {quorum && (
          <div className="tally-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--rule)" }}>
            <span className="key">
              <span className="truncate">Quorum {quorum.reached ? "✓" : ""}</span>
            </span>
            <span className="bar">
              <span
                style={{
                  width: `${Math.min(quorum.requiredPct > 0 ? (quorum.turnoutPct / quorum.requiredPct) * 100 : 0, 100)}%`,
                  background: quorum.reached ? "var(--accent)" : "var(--muted-ink, #9a9a9a)",
                }}
              />
            </span>
            <span className="pct">
              {quorum.turnoutPct.toFixed(1)}% / {quorum.requiredPct}%
            </span>
          </div>
        )}

        <div
          className="vp-foot-note"
          style={{ textAlign: "left", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--rule)" }}
        >
          {getOutcome({ total, winner, resultsWithPercentage, proposalStatus, quorum })}
        </div>

        {canExecute && !isSignalling && (
          <Button
            className="mt-4 w-full"
            size="lg"
            variant="primary"
            disabled={isConfirmingExecution}
            onClick={executeProposal}
          >
            Execute proposal
          </Button>
        )}
      </div>
    </div>
  );
};
