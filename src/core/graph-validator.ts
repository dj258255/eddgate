import type { WorkflowDefinition } from "../types/index.js";

/**
 * Workflow Graph Validator
 *
 * Validates:
 * 1. No circular dependencies
 * 2. All dependsOn references point to existing step IDs
 * 3. No orphaned steps (steps with deps that don't exist)
 * 4. At least one step has no dependencies (entry point)
 */
export function validateWorkflowGraph(
  workflow: WorkflowDefinition,
): string[] {
  const errors: string[] = [];
  const stepIds = new Set(workflow.steps.map((s) => s.id));

  // Check for duplicate step IDs
  const seen = new Set<string>();
  for (const step of workflow.steps) {
    if (seen.has(step.id)) {
      errors.push(`Duplicate step ID: "${step.id}"`);
    }
    seen.add(step.id);
  }

  // Check dangling references
  for (const step of workflow.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!stepIds.has(dep)) {
        errors.push(
          `Step "${step.id}" depends on "${dep}" which does not exist`,
        );
      }
    }
  }

  // Check for cycles (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of workflow.steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const step of workflow.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (stepIds.has(dep)) {
        adjacency.get(dep)!.push(step.id);
        inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  // Must have at least one entry point
  if (queue.length === 0 && workflow.steps.length > 0) {
    errors.push("No entry point: all steps have dependencies (circular)");
    return errors;
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;

    for (const next of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDegree);
      if (newDegree === 0) queue.push(next);
    }
  }

  if (processed < workflow.steps.length) {
    const cycleSteps = workflow.steps
      .filter((s) => (inDegree.get(s.id) ?? 0) > 0)
      .map((s) => s.id);
    errors.push(`Circular dependency detected: ${cycleSteps.join(" -> ")}`);
  }

  return errors;
}
