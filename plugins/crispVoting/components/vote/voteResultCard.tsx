"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@aragon/ods";
import { useProposalExecute } from "../../hooks/useProposalExecute";

interface IResult {
  option: string;
  value: string;
}

interface VoteResultCardProps {
  results?: IResult[];
  proposalId: bigint;
  isSignalling?: boolean;
  isTallied?: boolean;
}

// Interfold earth-tone palette — matches the vote card option colors
const OPTION_COLORS = ["#2f8a4f", "#a84932", "#7a7d77", "#355a8a", "#8a6a40", "#5a4a8a", "#2f7a6a", "#9a7a30"];

function getColor(index: number): string {
  return OPTION_COLORS[index % OPTION_COLORS.length];
}

export const VoteResultCard = ({ results, proposalId, isSignalling, isTallied = true }: VoteResultCardProps) => {
  const { executeProposal, canExecute, isConfirming: isConfirmingExecution } = useProposalExecute(proposalId);
  const [isVisible, setIsVisible] = useState(false);

  const parsedResults = useMemo(() => {
    if (!results) return [];
    return results.map((r, idx) => ({ option: r.option, value: Number(r.value), index: idx }));
  }, [results]);

  const total = useMemo(() => parsedResults.reduce((sum, r) => sum + r.value, 0), [parsedResults]);

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
            Results are being tallied by the Enclave network. This may take a few minutes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vote-panel" style={{ opacity: isVisible ? 1 : 0, transition: "opacity 500ms" }}>
      <div className="vp-head">
        <h3>Result</h3>
        <span className="vp-meta">{total.toLocaleString()} votes</span>
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
              <span className="pct">{result.percentage.toFixed(1)}%</span>
            </div>
          );
        })}

        <div
          className="vp-foot-note"
          style={{ textAlign: "left", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--rule)" }}
        >
          {total === 0 ? (
            "No votes were cast"
          ) : winner ? (
            <span style={{ color: getColor(winner.index) }}>
              {winner.option} won with{" "}
              {resultsWithPercentage.find((r) => r.index === winner.index)?.percentage.toFixed(1)}%
            </span>
          ) : (
            "Tied — no clear winner"
          )}
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
