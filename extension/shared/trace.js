export function createTaskTrace({
  taskId,
  instruction,
  tab,
  settings,
  source = "chat"
}) {
  const now = new Date().toISOString();
  return {
    taskId: taskId || createTaskId(),
    status: "running",
    source,
    instruction,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    activeTab: serializeTab(tab),
    modelProvider: "openai",
    model: settings.model || "not_configured",
    confirmationMode: settings.confirmationMode,
    actionPreview: settings.showActionPreview !== false,
    steps: [],
    summary: ""
  };
}

export function createTaskId(prefix = "task") {
  return createId(prefix);
}

export function createId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${suffix}`;
}

export function addTraceStep(trace, step) {
  const now = new Date().toISOString();
  const nextStepNumber = (trace.steps?.length || 0) + 1;
  trace.steps = [
    ...(trace.steps || []),
    {
      step: nextStepNumber,
      timestamp: now,
      ...step
    }
  ];
  trace.updatedAt = now;
  return trace;
}

export function createObservationStep({ tab, snapshot }) {
  return {
    type: "observe",
    tool: "observe_page",
    url: snapshot.url || tab?.url || "",
    title: snapshot.title || tab?.title || "",
    observationSummary: summarizeSnapshot(snapshot),
    snapshot
  };
}

export function hydrateTraceActiveTabFromSnapshot(trace, snapshot) {
  if (!snapshot) {
    return trace;
  }

  trace.activeTab = {
    ...(trace.activeTab || {}),
    url: trace.activeTab?.url || snapshot.url || "",
    title: trace.activeTab?.title || snapshot.title || ""
  };
  return trace;
}

export function finishTrace(trace, status, summary, error = null) {
  const now = new Date().toISOString();
  trace.status = status;
  trace.summary = summary;
  trace.updatedAt = now;
  trace.completedAt = now;
  if (error) {
    trace.error = serializeError(error);
  }
  return trace;
}

export function serializeError(error) {
  if (!error) {
    return null;
  }
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: error.stack || ""
  };
}

export function summarizeSnapshot(snapshot) {
  const elementCount = snapshot.elements?.length || 0;
  const textCount = snapshot.pageText?.length || 0;
  const frameCount = snapshot.frames?.length || 1;
  const url = snapshot.url || "";
  const frameSummary = frameCount > 1 ? ` across ${frameCount} frames` : "";
  return `Observed ${elementCount} actionable elements and ${textCount} text snippets${frameSummary} on ${url}.`;
}

function serializeTab(tab) {
  if (!tab) {
    return null;
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url || "",
    title: tab.title || "",
    status: tab.status || ""
  };
}
