import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { WorkflowResult, StepResult, TraceEvent } from "../types/index.js";
import type { TraceEmitter } from "../trace/emitter.js";

interface DashboardProps {
  workflowName: string;
  steps: string[];
  tracer: TraceEmitter;
  model: string;
  effort: string;
}

interface StepState {
  id: string;
  status: "pending" | "running" | "success" | "failed" | "flagged" | "skipped";
  tokens: number;
  duration: number;
  evalScore?: number;
}

function Dashboard({ workflowName, steps, tracer, model, effort }: DashboardProps) {
  const [stepStates, setStepStates] = useState<Map<string, StepState>>(
    new Map(steps.map((id) => [id, { id, status: "pending", tokens: 0, duration: 0 }])),
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalCost, setTotalCost] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    tracer.onEvent((event: TraceEvent) => {
      setStepStates((prev) => {
        const next = new Map(prev);
        const existing = next.get(event.stepId);

        if (event.type === "step_start" && existing) {
          next.set(event.stepId, { ...existing, status: "running" });
        } else if (event.type === "step_end" && existing) {
          next.set(event.stepId, {
            ...existing,
            status: existing.status === "running" ? "success" : existing.status,
            duration: event.data.latencyMs ?? 0,
          });
        } else if (event.type === "llm_call" && existing) {
          const tokens = (event.data.inputTokens ?? 0) + (event.data.outputTokens ?? 0);
          next.set(event.stepId, { ...existing, tokens: existing.tokens + tokens });
          setTotalTokens((t) => t + tokens);
          setTotalCost((c) => c + (event.data.cost ?? 0));
        } else if (event.type === "validation" && existing) {
          if (event.data.validationResult && !event.data.validationResult.passed) {
            next.set(event.stepId, { ...existing, status: "failed" });
          }
        } else if (event.type === "evaluation" && existing) {
          const score = event.data.evaluationResult?.score;
          next.set(event.stepId, { ...existing, evalScore: score });
        } else if (event.type === "error" && existing) {
          next.set(event.stepId, { ...existing, status: "failed" });
        }

        return next;
      });

      // Log
      if (event.stepId !== "__workflow__") {
        const msg = formatLogEntry(event);
        if (msg) setLogs((prev) => [...prev.slice(-15), msg]);
      }
    });
  }, [tracer]);

  const stateArray = Array.from(stepStates.values());
  const currentStep = stateArray.find((s) => s.status === "running");

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="round" paddingX={2} paddingY={0} borderColor="cyan">
        <Text bold color="yellow">{"<|>"}</Text>
        <Text> </Text>
        <Text bold color="cyan">eddgate</Text>
        <Text> - </Text>
        <Text>{workflowName}</Text>
        <Text color="gray"> | </Text>
        <Text color="yellow">{model}</Text>
        <Text color="gray"> | </Text>
        <Text color="gray">{effort}</Text>
        <Text color="gray"> | </Text>
        <Text color="gray">{formatTime(elapsed)}</Text>
        <Text color="gray"> | </Text>
        <Text color="gray">{totalTokens.toLocaleString()} tok</Text>
        <Text color="gray"> | </Text>
        <Text color="green">${totalCost.toFixed(4)}</Text>
      </Box>

      <Box marginTop={1}>
        {/* Steps Panel */}
        <Box flexDirection="column" width="40%">
          <Text bold underline>Steps</Text>
          <Box marginTop={1} flexDirection="column">
            {stateArray.map((step, i) => (
              <Box key={step.id}>
                <Text>{statusIcon(step.status)} </Text>
                <Text
                  bold={step.status === "running"}
                  color={step.status === "running" ? "cyan" : step.status === "failed" ? "red" : step.status === "success" ? "green" : "gray"}
                >
                  {i + 1}. {step.id}
                </Text>
                {step.status === "running" && (
                  <Text color="cyan"> <Spinner type="dots" /></Text>
                )}
                {step.tokens > 0 && (
                  <Text color="gray"> {step.tokens.toLocaleString()}tok</Text>
                )}
                {step.evalScore !== undefined && (
                  <Text color={step.evalScore >= 0.7 ? "green" : "red"}>
                    {" "}[{step.evalScore.toFixed(2)}]
                  </Text>
                )}
                {step.duration > 0 && (
                  <Text color="gray"> {(step.duration / 1000).toFixed(1)}s</Text>
                )}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Log Panel */}
        <Box flexDirection="column" width="60%" marginLeft={2}>
          <Text bold underline>Log</Text>
          <Box marginTop={1} flexDirection="column">
            {logs.slice(-12).map((log, i) => (
              <Text key={i} color="gray" wrap="truncate">{log}</Text>
            ))}
            {currentStep && (
              <Box marginTop={1}>
                <Text color="cyan"><Spinner type="dots" /> </Text>
                <Text color="cyan">{currentStep.id}</Text>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function statusIcon(status: string): string {
  switch (status) {
    case "success": return "\u2713";
    case "failed": return "\u2717";
    case "flagged": return "!";
    case "running": return ">";
    case "skipped": return "-";
    default: return " ";
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatLogEntry(event: TraceEvent): string | null {
  switch (event.type) {
    case "step_start":
      return `[start] ${event.stepId} -> ${event.context?.identity.role ?? ""}`;
    case "step_end":
      return `[done]  ${event.stepId} (${((event.data.latencyMs ?? 0) / 1000).toFixed(1)}s)`;
    case "llm_call":
      return `[llm]   ${event.stepId} ${event.data.model} (${event.data.inputTokens}->${event.data.outputTokens})`;
    case "validation": {
      const passed = event.data.validationResult?.passed;
      return `[gate]  ${event.stepId} ${passed ? "PASS" : "FAIL"}`;
    }
    case "evaluation":
      return `[eval]  ${event.stepId} score=${event.data.evaluationResult?.score?.toFixed(2)}`;
    case "error":
      return `[err]   ${event.stepId} ${event.data.error?.slice(0, 60)}`;
    default:
      return null;
  }
}

/**
 * Render the Ink dashboard. Returns cleanup function.
 */
export function renderInkDashboard(
  workflowName: string,
  steps: string[],
  tracer: TraceEmitter,
  model: string,
  effort: string,
): { unmount: () => void } {
  const { unmount } = render(
    <Dashboard
      workflowName={workflowName}
      steps={steps}
      tracer={tracer}
      model={model}
      effort={effort}
    />,
  );
  return { unmount };
}
