import { Button } from "@aragon/ods";
import { unixTimestampToDate } from "../../utils/formatProposalDate";
import type { VotingStep } from "../../utils/types";
import { PleaseWaitSpinner } from "@/components/please-wait";
import { useState } from "react";
import VotingStepIndicator from "./voteProgress";

export interface VoteCardProps {
  error?: string;
  options: string[];
  voteStartDate: number;
  voteEndDate: number;
  disabled: boolean;
  isLoading: boolean;
  proposalId: bigint;
  votingStep: VotingStep;
  lastActiveStep: VotingStep | null;
  stepMessage: string;
  isCommitteeReady: boolean;
  txHash: string | null;
  onClickVote: (voteOption: number) => void;
  onClickMask: () => void;
}

// Interfold earth-tone palette — readable on the cream canvas
const OPTION_COLORS = ["#2f8a4f", "#a84932", "#7a7d77", "#355a8a", "#8a6a40", "#5a4a8a", "#2f7a6a", "#9a7a30"];

function getColor(index: number): string {
  return OPTION_COLORS[index % OPTION_COLORS.length];
}

export const VoteCard = ({
  error,
  options,
  voteStartDate,
  disabled,
  isLoading,
  onClickVote,
  onClickMask,
  votingStep,
  lastActiveStep,
  stepMessage,
  isCommitteeReady,
  txHash,
}: VoteCardProps) => {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isMasking, setIsMasking] = useState<boolean>(false);
  const [hasVoted, setHasVoted] = useState<boolean>(false);

  const handleVote = () => {
    if (selectedOption === null) return;
    setIsMasking(false);
    setHasVoted(true);
    onClickVote(selectedOption);
  };

  const handleMask = () => {
    setSelectedOption(null);
    setIsMasking(true);
    setHasVoted(true);
    onClickMask();
  };

  const isDisabled = disabled || isLoading;
  const notStarted = voteStartDate > Math.round(Date.now() / 1000);
  const started = voteStartDate < Math.round(Date.now() / 1000);

  return (
    <div className="vote-panel">
      <div className="vp-head">
        <h3>Cast ballot</h3>
      </div>

      <div className="vp-body">
        {error && <p className="text-sm text-critical-500">{error}</p>}

        <p className="vp-note">
          Submit your vote to the CRISP server. You can override it any time during the voting window. Results are
          tallied by the Enclave network after the period ends.
        </p>

        {(isLoading || txHash || votingStep === "error" || votingStep === "complete") && (
          <VotingStepIndicator
            step={txHash && !isLoading ? "complete" : votingStep}
            lastActiveStep={lastActiveStep}
            message={txHash && !isLoading ? "Vote submitted successfully!" : stepMessage}
            txHash={txHash}
          />
        )}

        {notStarted && (
          <p className="vp-foot-note" style={{ textAlign: "left" }}>
            The vote will start on {unixTimestampToDate(voteStartDate)}
          </p>
        )}

        {started && !isCommitteeReady && (
          <div className="border px-4 py-3" style={{ borderColor: "var(--rule)", background: "var(--mint-pale)" }}>
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              The ciphernode committee is being formed. Voting will be available once the committee is ready.
            </p>
          </div>
        )}

        {/* Choices */}
        <div className="vote-choices">
          {options.map((option, index) => {
            const isSelected = selectedOption === index;
            return (
              <button
                key={index}
                type="button"
                disabled={isDisabled}
                onClick={() => setSelectedOption(index)}
                className={`vote-choice ${isSelected ? "selected" : ""}`}
              >
                <span className="label">
                  <span className="swatch" style={{ background: getColor(index) }} />
                  <span className="truncate">{option}</span>
                </span>
                <span className="mark">{isSelected ? "●" : "○"}</span>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="vp-cta">
          <Button
            className="w-full"
            size="lg"
            variant="primary"
            disabled={isDisabled || selectedOption === null}
            onClick={handleVote}
          >
            {isLoading && hasVoted && !isMasking ? (
              <PleaseWaitSpinner fullMessage="Encrypting ballot…" />
            ) : selectedOption !== null ? (
              `Submit encrypted ballot · ${options[selectedOption]}`
            ) : (
              "Select an option"
            )}
          </Button>

          <button
            type="button"
            disabled={isDisabled}
            onClick={handleMask}
            className="vp-foot-note flex items-center justify-center gap-2 py-1"
            style={{ cursor: isDisabled ? "not-allowed" : "pointer", background: "none", border: 0 }}
          >
            {isLoading && isMasking ? (
              <PleaseWaitSpinner fullMessage="Masking…" />
            ) : (
              <>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                <span>Mask vote instead</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="privacy">
        <span className="dot" />
        <div>
          Ballots are encrypted client-side and tallied inside a committee-controlled enclave. Individual votes are{" "}
          <em>never</em> revealed.
        </div>
      </div>
    </div>
  );
};
