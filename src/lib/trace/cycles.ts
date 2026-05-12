export type TraceCycleStatus = "ok" | "blocked" | "failed" | "confirmed" | "recovery" | "done" | "observed";

export type TraceCycle = {
  cycleNumber: number;
  observationStep?: any;
  actionStep?: any;
  standaloneStep?: any;
  recoverySteps: any[];
  rawStepNumbers: number[];
  status: TraceCycleStatus;
};

export function buildTraceCycles(trace: any): TraceCycle[] {
  const cycles: TraceCycle[] = [];
  let pendingObservation: any = null;
  let pendingRecoveries: any[] = [];

  for (const step of trace?.steps || []) {
    if (step?.type === "observe") {
      if (pendingObservation) {
        cycles.push(createObservationCycle(cycles.length + 1, pendingObservation, pendingRecoveries));
        pendingRecoveries = [];
      }
      pendingObservation = step;
      continue;
    }

    if (step?.type === "model_action") {
      cycles.push(createActionCycle(cycles.length + 1, pendingObservation, step, pendingRecoveries));
      pendingObservation = null;
      pendingRecoveries = [];
      continue;
    }

    if (step?.type === "recovery") {
      if (cycles.length > 0) {
        const previous = cycles[cycles.length - 1];
        previous.recoverySteps = [...previous.recoverySteps, step];
        previous.rawStepNumbers = [...previous.rawStepNumbers, step.step].filter(Boolean);
        previous.status = "recovery";
      } else {
        pendingRecoveries = [...pendingRecoveries, step];
      }
      continue;
    }

    cycles.push(createStandaloneCycle(cycles.length + 1, step, pendingRecoveries));
    pendingRecoveries = [];
  }

  if (pendingObservation) {
    cycles.push(createObservationCycle(cycles.length + 1, pendingObservation, pendingRecoveries));
  } else if (pendingRecoveries.length) {
    for (const recovery of pendingRecoveries) {
      cycles.push(createStandaloneCycle(cycles.length + 1, recovery, []));
    }
  }

  return cycles;
}

export function cycleTitle(cycle: TraceCycle): string {
  const toolCall = getToolCall(cycle.actionStep);
  if (toolCall.tool) {
    return formatToolLabel(toolCall.tool);
  }
  if (cycle.observationStep) {
    return "Observe page";
  }
  if (cycle.standaloneStep?.type === "recovery") {
    return "Recovery";
  }
  return cycle.standaloneStep?.tool || cycle.standaloneStep?.type || "Trace step";
}

export function cycleSummary(cycle: TraceCycle): string {
  const toolCall = getToolCall(cycle.actionStep);
  return toolCall.summary ||
    cycle.standaloneStep?.recovery?.summary ||
    cycle.standaloneStep?.observationSummary ||
    cycle.observationStep?.observationSummary ||
    cycle.actionStep?.execution?.status ||
    "";
}

export function cycleTimestamp(cycle: TraceCycle): string {
  return cycle.actionStep?.timestamp ||
    cycle.observationStep?.timestamp ||
    cycle.standaloneStep?.timestamp ||
    "";
}

export function getToolCall(actionStep: any): any {
  return actionStep?.toolCall || actionStep?.decision || {};
}

export function getCycleSnapshot(cycle: TraceCycle): any {
  return cycle.observationStep?.snapshot || {};
}

export function findElementInSnapshot(snapshot: any, elementId: string | null | undefined): any {
  if (!elementId) {
    return null;
  }
  return (snapshot?.elements || []).find((element: any) => element?.id === elementId) || null;
}

export function formatToolLabel(tool: string): string {
  const labels: Record<string, string> = {
    click_element: "Click element",
    fill_element: "Fill field",
    clear_element: "Clear field",
    select_option: "Select option",
    submit_form: "Submit form",
    press_key: "Press key",
    scroll: "Scroll",
    read_page_text: "Read page text",
    respond_to_user: "Reply to user",
    finish: "Finish",
    abort: "Abort"
  };
  return labels[tool] || tool || "";
}

export function formatElementLabel(element: any, fallbackId = ""): string {
  if (!element && !fallbackId) {
    return "";
  }

  const label = element?.label ||
    element?.name ||
    element?.text ||
    element?.placeholder ||
    element?.href ||
    fallbackId;
  const role = element?.role ? `${element.role}` : "";
  const tag = element?.tagName ? `${element.tagName}`.toLowerCase() : "";
  const id = element?.id || fallbackId;
  const frame = element?.frame?.isTopFrame === false
    ? `iframe ${element.frame.index || element.frameId || ""}`.trim()
    : "";
  return [id, role || tag, label, frame].filter(Boolean).join(" - ");
}

export function observationPageLabel(step: any): string {
  const snapshot = step?.snapshot || {};
  return snapshot.title || step?.title || snapshot.url || step?.url || "";
}

export function formatStepRange(numbers: number[]): string {
  const safeNumbers = numbers.filter((number) => Number.isFinite(number));
  if (!safeNumbers.length) {
    return "";
  }
  if (safeNumbers.length === 1) {
    return `step ${safeNumbers[0]}`;
  }
  return `steps ${safeNumbers.join(", ")}`;
}

function createActionCycle(
  cycleNumber: number,
  observationStep: any,
  actionStep: any,
  recoverySteps: any[]
): TraceCycle {
  return {
    cycleNumber,
    observationStep: observationStep || undefined,
    actionStep,
    recoverySteps,
    rawStepNumbers: [
      observationStep?.step,
      actionStep?.step,
      ...recoverySteps.map((step) => step?.step)
    ].filter(Boolean),
    status: deriveActionStatus(actionStep, recoverySteps)
  };
}

function createObservationCycle(cycleNumber: number, observationStep: any, recoverySteps: any[]): TraceCycle {
  return {
    cycleNumber,
    observationStep,
    recoverySteps,
    rawStepNumbers: [
      observationStep?.step,
      ...recoverySteps.map((step) => step?.step)
    ].filter(Boolean),
    status: recoverySteps.length ? "recovery" : "observed"
  };
}

function createStandaloneCycle(cycleNumber: number, step: any, recoverySteps: any[]): TraceCycle {
  return {
    cycleNumber,
    standaloneStep: step,
    recoverySteps,
    rawStepNumbers: [
      step?.step,
      ...recoverySteps.map((recovery) => recovery?.step)
    ].filter(Boolean),
    status: step?.type === "recovery" || recoverySteps.length ? "recovery" : "ok"
  };
}

function deriveActionStatus(actionStep: any, recoverySteps: any[]): TraceCycleStatus {
  if (recoverySteps.length) {
    return "recovery";
  }

  const toolCall = getToolCall(actionStep);
  const executionStatus = actionStep?.execution?.status || "";
  if (executionStatus === "failed" || executionStatus === "aborted") {
    return "failed";
  }
  if (executionStatus === "blocked" || actionStep?.validation?.ok === false) {
    return "blocked";
  }
  if (actionStep?.confirmation?.required) {
    return actionStep.confirmation.decision === "approved" ? "confirmed" : "blocked";
  }
  if (toolCall.tool === "respond_to_user" || toolCall.tool === "finish") {
    return "done";
  }
  return "ok";
}
