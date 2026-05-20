import React from "react";
import { PUB_CHAIN } from "@/constants";
import type { VotingStep } from "../../utils/types";

type VotingStepIndicatorProps = {
  step: VotingStep;
  message: string;
  lastActiveStep?: VotingStep | null;
  txHash?: string | null;
};

const steps: { key: VotingStep; label: string; icon: string }[] = [
  {
    key: "signing",
    label: "Signing",
    icon: "M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z",
  },
  {
    key: "generating_proof",
    label: "Proof",
    icon: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
  },
  {
    key: "broadcasting",
    label: "Broadcast",
    icon: "M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5",
  },
];

type StepStatus = "complete" | "active" | "error" | "pending";

const VotingStepIndicator: React.FC<VotingStepIndicatorProps> = ({ step, message, lastActiveStep, txHash }) => {
  const stepOrder = steps.map((s) => s.key);

  const getStepStatus = (stepKey: VotingStep): StepStatus => {
    const currentIndex = step === "error" ? stepOrder.indexOf(lastActiveStep ?? "signing") : stepOrder.indexOf(step);
    const stepIndex = stepOrder.indexOf(stepKey);

    if (step === "complete") return "complete";
    if (step === "error") return stepIndex <= currentIndex ? "error" : "pending";
    if (stepIndex < currentIndex) return "complete";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  const isComplete = step === "complete";
  const isError = step === "error";

  const currentStepIndex =
    step === "error"
      ? stepOrder.indexOf(lastActiveStep ?? "signing")
      : step === "complete"
        ? steps.length
        : stepOrder.indexOf(step);
  const progressPercent = step === "complete" ? 100 : ((currentStepIndex + 0.5) / steps.length) * 100;

  return (
    <div className="overflow-hidden border border-neutral-200">
      {/* Progress track */}
      <div className="relative h-1 w-full bg-neutral-100">
        <div
          className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
          style={{
            width: `${progressPercent}%`,
            background: isError
              ? "linear-gradient(90deg, var(--accent-soft), #a84932)"
              : isComplete
                ? "var(--accent)"
                : "linear-gradient(90deg, var(--ink-soft), var(--accent))",
          }}
        />
      </div>

      <div className="flex flex-col gap-4 px-5 py-4" style={{ background: "var(--cream)" }}>
        {/* Steps row */}
        <div className="flex items-start justify-between">
          {steps.map((s, index) => {
            const status = getStepStatus(s.key);

            return (
              <React.Fragment key={s.key}>
                <StepNode status={status} label={s.label} iconPath={s.icon} />
                {index < steps.length - 1 && (
                  <div className="mt-4 flex flex-1 items-center px-3">
                    <StepConnector
                      filled={
                        getStepStatus(steps[index + 1].key) === "complete" ||
                        getStepStatus(steps[index + 1].key) === "active" ||
                        getStepStatus(steps[index + 1].key) === "error"
                      }
                      isError={getStepStatus(steps[index + 1].key) === "error"}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Message */}
        <div
          className="font-medium flex items-center gap-2 px-3 py-2 text-xs"
          style={{
            backgroundColor: isError ? "#f3d6c8" : isComplete ? "var(--mint-pale)" : "var(--mint)",
            color: isError ? "#7a3322" : isComplete ? "var(--accent)" : "var(--ink-soft)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          {!isComplete && !isError && (
            <svg className="shrink-0 animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          )}
          {isComplete && (
            <svg
              className="shrink-0"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {isError && (
            <svg
              className="shrink-0"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          )}
          <span>{message}</span>
          {isComplete && txHash && (
            <a
              href={`${PUB_CHAIN.blockExplorers?.default?.url}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto shrink-0 underline hover:no-underline"
            >
              View transaction
            </a>
          )}
        </div>
      </div>

      <style>{`
        @keyframes step-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(47, 138, 79, 0.3); }
          50% { box-shadow: 0 0 0 6px rgba(47, 138, 79, 0); }
        }
        @keyframes step-pulse-error {
          0%, 100% { box-shadow: 0 0 0 0 rgba(168, 73, 50, 0.3); }
          50% { box-shadow: 0 0 0 6px rgba(168, 73, 50, 0); }
        }
        @keyframes dash-flow {
          to { stroke-dashoffset: -8; }
        }
      `}</style>
    </div>
  );
};

/* ─── Step node ─── */

const StepNode: React.FC<{
  status: StepStatus;
  label: string;
  iconPath: string;
}> = ({ status, label, iconPath }) => {
  const colors: Record<StepStatus, { bg: string; border: string; icon: string; label: string }> = {
    complete: { bg: "var(--mint-pale)", border: "var(--accent)", icon: "var(--accent)", label: "var(--accent)" },
    active: { bg: "var(--mint)", border: "var(--ink)", icon: "var(--ink)", label: "var(--ink-soft)" },
    error: { bg: "#f3d6c8", border: "#a84932", icon: "#a84932", label: "#7a3322" },
    pending: { bg: "transparent", border: "var(--cream-line)", icon: "var(--muted-2)", label: "var(--muted)" },
  };

  const c = colors[status];

  return (
    <div className="flex flex-col items-center gap-1.5" style={{ minWidth: 56 }}>
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-500"
        style={{
          backgroundColor: c.bg,
          borderColor: c.border,
          animation:
            status === "active"
              ? "step-pulse 2s ease-in-out infinite"
              : status === "error"
                ? "step-pulse-error 2s ease-in-out infinite"
                : "none",
        }}
      >
        {status === "complete" ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={c.icon}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : status === "error" ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={c.icon}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={c.icon}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={iconPath} />
          </svg>
        )}
      </div>
      <span className="font-medium text-center text-[11px] transition-all duration-300" style={{ color: c.label }}>
        {label}
      </span>
    </div>
  );
};

/* ─── Connector line ─── */

const StepConnector: React.FC<{ filled: boolean; isError: boolean }> = ({ filled, isError }) => {
  if (filled) {
    return (
      <div
        className="h-0.5 w-full rounded-full transition-all duration-700"
        style={{ backgroundColor: isError ? "#d89a85" : "var(--accent-soft)" }}
      />
    );
  }

  return (
    <svg width="100%" height="2" className="overflow-visible">
      <line
        x1="0"
        y1="1"
        x2="100%"
        y2="1"
        stroke="var(--cream-line)"
        strokeWidth="2"
        strokeDasharray="4 4"
        style={{ animation: "dash-flow 0.8s linear infinite" }}
      />
    </svg>
  );
};

export default VotingStepIndicator;
