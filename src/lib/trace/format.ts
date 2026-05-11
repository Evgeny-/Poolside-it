import { CONFIRMATION_MODE_LABELS, normalizeConfirmationMode } from "$extension/shared/protocol.js";
import { formatDate } from "$lib/utils";

export function formatConfirmationMode(mode: string) {
  const normalizedMode = normalizeConfirmationMode(mode as any, (mode || "") as any);
  return CONFIRMATION_MODE_LABELS[normalizedMode] || mode || "";
}

export function formatElementSummary(element: any) {
  const label = element?.name || element?.text || element?.placeholder || element?.attributes?.href || element?.href || "";
  const form = element?.form?.canSubmit
    ? ` - form ${element.form.intent || "submit"} ${element.form.method || ""}`.trimEnd()
    : "";
  const frame = element?.frame?.isTopFrame === false
    ? ` - iframe ${element.frame.index || element.frameId || ""}`.trimEnd()
    : "";
  return `${element?.id || ""}: ${element?.role || ""}${frame} - ${label}${form}`;
}

export function formatFrameSummary(frame: any) {
  const label = frame?.title || frame?.url || "untitled";
  const kind = frame?.isTopFrame ? "top" : "iframe";
  return `${frame?.index || frame?.frameId}. ${kind} - ${label} - ${frame?.elementCount || 0} elements`;
}

export function formatEmbeddedFrameSummary(frame: any) {
  const source = frame?.src || frame?.dataSrc || "";
  const label = frame?.title || frame?.name || source || frame?.id || "iframe";
  const owner = frame?.ownerFrameIndex ? ` - owner frame ${frame.ownerFrameIndex}` : "";
  return `${label}${owner} - ${frame?.access || "unknown"} - ${source}`;
}

export function stepNavLabel(step: any) {
  if (step?.type === "observe") {
    return step.title || step.snapshot?.title || "Observe page";
  }
  if (step?.type === "recovery") {
    return step.recovery?.summary || "Recovery";
  }
  const toolCall = step?.toolCall || step?.decision || {};
  return toolCall.summary || toolCall.tool || step?.tool || step?.type || "Step";
}

export function latestSnapshotFromTrace(trace: any) {
  const steps = trace?.steps || [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].snapshot) {
      return steps[index].snapshot;
    }
  }
  return null;
}

export function assistantResponseFromTrace(trace: any, traceId: string) {
  if (trace?.taskId !== traceId) {
    return "";
  }
  const responseStep = (trace.steps || []).find((step: any) => (
    step.toolCall?.tool === "respond_to_user" && step.toolCall?.text
  ));
  return responseStep?.toolCall?.text || "";
}

export function traceStepSummary(step: any) {
  return step?.observationSummary ||
    step?.toolCall?.summary ||
    step?.recovery?.summary ||
    step?.error?.message ||
    step?.execution?.status ||
    step?.url ||
    "";
}

export function traceStepTitle(step: any) {
  return `${step?.step || ""}. ${step?.tool || step?.type || ""}`;
}

export function traceTimestamp(step: any) {
  return formatDate(step?.timestamp);
}
