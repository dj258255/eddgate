import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import chalk from "chalk";
import { loadWorkflow, loadPrompt } from "../../config/loader.js";
import { executeWorkflow } from "../../core/workflow-engine.js";
import { TraceEmitter } from "../../trace/emitter.js";
import type { WorkflowResult } from "../../types/index.js";

interface ServeOptions {
  port: number;
  host: string;
  workflowsDir: string;
  promptsDir: string;
}

// In-memory store for running/completed workflows
const runs = new Map<string, {
  status: "running" | "completed" | "failed";
  workflow: string;
  startedAt: string;
  completedAt?: string;
  result?: WorkflowResult;
  error?: string;
}>();

export async function serveCommand(options: ServeOptions): Promise<void> {
  const { port, host, workflowsDir, promptsDir } = options;

  const server = createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    try {
      // GET /health
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { status: "ok", version: "0.1.0", uptime: process.uptime() });
        return;
      }

      // GET /workflows -- list available workflows
      if (req.method === "GET" && url.pathname === "/workflows") {
        const files = await readdir(resolve(workflowsDir));
        const workflows = files
          .filter(f => extname(f) === ".yaml" || extname(f) === ".yml")
          .map(f => basename(f, extname(f)));
        json(res, 200, { workflows });
        return;
      }

      // POST /run -- start a workflow execution
      if (req.method === "POST" && url.pathname === "/run") {
        const body = await readBody(req);
        const { workflow: wfName, input, model, dryRun } = body as {
          workflow?: string;
          input?: string;
          model?: string;
          dryRun?: boolean;
        };

        if (!wfName || !input) {
          json(res, 400, { error: "workflow and input are required" });
          return;
        }

        const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Start async execution
        runs.set(runId, {
          status: "running",
          workflow: wfName,
          startedAt: new Date().toISOString(),
        });

        // Don't await -- return runId immediately
        executeWorkflowAsync(runId, wfName, input, model, dryRun, workflowsDir, promptsDir);

        json(res, 202, { runId, status: "running", message: "Workflow started" });
        return;
      }

      // GET /runs -- list all runs
      if (req.method === "GET" && url.pathname === "/runs") {
        const list = [...runs.entries()].map(([id, r]) => ({
          runId: id,
          status: r.status,
          workflow: r.workflow,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
        }));
        json(res, 200, { runs: list });
        return;
      }

      // GET /runs/:id -- get run status and result
      if (req.method === "GET" && url.pathname.startsWith("/runs/")) {
        const runId = url.pathname.slice(6); // remove "/runs/"
        const run = runs.get(runId);
        if (!run) {
          json(res, 404, { error: "Run not found" });
          return;
        }
        json(res, 200, {
          runId,
          ...run,
          result: run.result ? {
            status: run.result.status,
            totalDurationMs: run.result.totalDurationMs,
            totalTokens: run.result.totalTokens,
            totalCostEstimate: run.result.totalCostEstimate,
            steps: run.result.steps.map(s => ({
              stepId: s.stepId,
              status: s.status,
              durationMs: s.durationMs,
              tokenUsage: s.tokenUsage,
              evaluation: s.evaluation,
              error: s.error,
            })),
          } : undefined,
        });
        return;
      }

      // 404
      json(res, 404, { error: "Not found", endpoints: [
        "GET  /health",
        "GET  /workflows",
        "POST /run { workflow, input, model?, dryRun? }",
        "GET  /runs",
        "GET  /runs/:id",
      ]});
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(port, host, () => {
    console.log(chalk.bold(`\neddgate API server running on http://${host}:${port}\n`));
    console.log(chalk.dim("Endpoints:"));
    console.log(chalk.cyan("  GET  /health      ") + "Health check");
    console.log(chalk.cyan("  GET  /workflows   ") + "List available workflows");
    console.log(chalk.cyan("  POST /run         ") + "Start workflow execution");
    console.log(chalk.cyan("  GET  /runs        ") + "List all runs");
    console.log(chalk.cyan("  GET  /runs/:id    ") + "Get run status and result");
    console.log(chalk.dim("\nPress Ctrl+C to stop.\n"));
  });
}

async function executeWorkflowAsync(
  runId: string,
  wfName: string,
  input: string,
  model: string | undefined,
  dryRun: boolean | undefined,
  workflowsDir: string,
  promptsDir: string,
): Promise<void> {
  try {
    const wfPath = resolve(workflowsDir, `${wfName}.yaml`);
    const workflow = await loadWorkflow(wfPath);
    if (model) workflow.config.defaultModel = model;

    // Load role prompts
    const rolePrompts = new Map<string, string>();
    for (const step of workflow.steps) {
      const role = step.context.identity.role;
      if (!rolePrompts.has(role)) {
        try {
          rolePrompts.set(role, await loadPrompt(resolve(promptsDir, `${role}.md`)));
        } catch { /* no prompt file */ }
      }
    }

    const tracer = new TraceEmitter();

    if (dryRun) {
      runs.set(runId, {
        ...runs.get(runId)!,
        status: "completed",
        completedAt: new Date().toISOString(),
        result: {
          workflowName: wfName,
          traceId: tracer.getTraceId(),
          status: "success",
          steps: workflow.steps.map(s => ({
            stepId: s.id,
            status: "skipped" as const,
            output: "[dry-run]",
            trace: [],
            durationMs: 0,
            tokenUsage: { input: 0, output: 0 },
          })),
          totalDurationMs: 0,
          totalTokens: { input: 0, output: 0 },
          totalCostEstimate: 0,
        },
      });
      return;
    }

    const result = await executeWorkflow({
      workflow,
      input,
      rolePrompts,
      tracer,
    });

    runs.set(runId, {
      ...runs.get(runId)!,
      status: result.status === "failed" ? "failed" : "completed",
      completedAt: new Date().toISOString(),
      result,
    });
  } catch (err) {
    runs.set(runId, {
      ...runs.get(runId)!,
      status: "failed",
      completedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}
