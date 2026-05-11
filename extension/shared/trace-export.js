const COMPACT_TRACE_SCHEMA_VERSION = 1;
const OBSERVATION_TEXT_LIMIT = 8;
const OBSERVATION_ELEMENT_LIMIT = 8;
const READ_TEXT_ITEM_LIMIT = 24;
const SHORT_TEXT_LIMIT = 220;
const LONG_TEXT_LIMIT = 4000;
const HINT_LIMIT = 4;

export function createCompactTraceExport(trace) {
  const steps = [];
  let latestSnapshot = null;

  for (const step of trace?.steps || []) {
    if (step.type === "observe") {
      latestSnapshot = step.snapshot || null;
      steps.push(compactObservationStep(step));
    } else if (step.type === "model_action") {
      steps.push(compactModelActionStep(step, latestSnapshot));
    } else if (step.type === "recovery") {
      steps.push(compactRecoveryStep(step));
    } else {
      steps.push(compactGenericStep(step));
    }
  }

  return removeEmpty({
    exportType: "browser_agent_trace_compact",
    schemaVersion: COMPACT_TRACE_SCHEMA_VERSION,
    copiedAt: new Date().toISOString(),
    omissions: [
      "Full PageSnapshot objects are omitted; observation steps keep counts and short previews only.",
      "Full model request text previews are omitted; model request entries keep sizes and context-management metadata.",
      "Full raw OpenAI responses are omitted; response entries keep id, model, status, usage, and error."
    ],
    task: compactTask(trace),
    metrics: compactTraceMetrics(trace),
    steps
  });
}

function compactTask(trace) {
  return removeEmpty({
    taskId: trace?.taskId || "",
    status: trace?.status || "",
    source: trace?.source || "",
    instruction: trace?.instruction || "",
    summary: trace?.summary || "",
    createdAt: trace?.createdAt || "",
    updatedAt: trace?.updatedAt || "",
    completedAt: trace?.completedAt || "",
    modelProvider: trace?.modelProvider || "",
    model: trace?.model || "",
    confirmationMode: trace?.confirmationMode || "",
    actionPreview: trace?.actionPreview,
    activeTab: compactTab(trace?.activeTab),
    error: compactError(trace?.error)
  });
}

function compactTraceMetrics(trace) {
  const steps = trace?.steps || [];
  const observationSteps = steps.filter((step) => step.type === "observe");
  return removeEmpty({
    stepCount: steps.length,
    observationCount: observationSteps.length,
    modelActionCount: steps.filter((step) => step.type === "model_action").length,
    recoveryCount: steps.filter((step) => step.type === "recovery").length,
    observedElementTotal: observationSteps.reduce((total, step) => (
      total + (step.snapshot?.elements?.length || 0)
    ), 0),
    observedTextSnippetTotal: observationSteps.reduce((total, step) => (
      total + (step.snapshot?.pageText?.length || 0)
    ), 0),
    observedFrameTotal: observationSteps.reduce((total, step) => (
      total + (step.snapshot?.frames?.length || 1)
    ), 0)
  });
}

function compactObservationStep(step) {
  const snapshot = step.snapshot || {};
  const pageText = snapshot.pageText || [];
  const elements = snapshot.elements || [];
  return compactGenericStep(step, {
    url: snapshot.url || step.url || "",
    title: snapshot.title || step.title || "",
    observationSummary: step.observationSummary || "",
    snapshot: removeEmpty({
      capturedAt: snapshot.capturedAt || "",
      url: snapshot.url || "",
      title: snapshot.title || "",
      viewport: compactViewport(snapshot.viewport),
      counts: {
        elements: elements.length,
        textSnippets: pageText.length
      },
      pageTextMeta: compactPageTextMeta(snapshot.pageTextMeta),
      pageTextPreview: pageText.slice(0, OBSERVATION_TEXT_LIMIT).map((item) => truncateText(item)),
      pageTextOmitted: omittedCount(pageText, OBSERVATION_TEXT_LIMIT),
      framesPreview: (snapshot.frames || []).slice(0, OBSERVATION_ELEMENT_LIMIT).map(compactFrame),
      frameObservation: compactFrameObservation(snapshot.frameObservation),
      embeddedFramesPreview: (snapshot.embeddedFrames || []).slice(0, OBSERVATION_ELEMENT_LIMIT).map(compactEmbeddedFrame),
      embeddedFramesOmitted: omittedCount(snapshot.embeddedFrames || [], OBSERVATION_ELEMENT_LIMIT),
      elementsPreview: elements.slice(0, OBSERVATION_ELEMENT_LIMIT).map(compactElement),
      elementsOmitted: omittedCount(elements, OBSERVATION_ELEMENT_LIMIT)
    })
  });
}

function compactModelActionStep(step, latestSnapshot) {
  const toolCall = step.toolCall || step.decision || {};
  const targetElement = findElement(latestSnapshot, toolCall.elementId);
  return compactGenericStep(step, {
    toolCall: compactToolCall(toolCall),
    targetElement: compactElement(targetElement),
    validation: compactValidation(step.validation),
    confirmation: compactConfirmation(step.confirmation),
    preview: compactPreview(step.preview),
    execution: compactExecution(step.execution),
    modelRequest: compactModelRequest(step.modelRequest),
    modelResponse: compactModelResponse(step.rawModelResponse, step.rawModelText)
  });
}

function compactRecoveryStep(step) {
  return compactGenericStep(step, {
    recovery: removeEmpty({
      strategy: step.recovery?.strategy || "",
      attempt: step.recovery?.attempt,
      maxAttempts: step.recovery?.maxAttempts,
      summary: step.recovery?.summary || ""
    }),
    error: compactError(step.error),
    modelRequest: compactModelRequest(step.modelRequest),
    modelResponse: compactModelResponse(step.rawModelResponse, step.rawModelText),
    rawModelText: truncateText(step.rawModelText, LONG_TEXT_LIMIT)
  });
}

function compactGenericStep(step, extra = {}) {
  return removeEmpty({
    step: step?.step,
    timestamp: step?.timestamp || "",
    type: step?.type || "",
    tool: step?.tool || "",
    ...extra
  });
}

function compactToolCall(toolCall) {
  return removeEmpty({
    tool: toolCall?.tool || "",
    elementId: toolCall?.elementId || null,
    text: truncateText(toolCall?.text, LONG_TEXT_LIMIT),
    value: truncateText(toolCall?.value, SHORT_TEXT_LIMIT),
    key: toolCall?.key || null,
    direction: toolCall?.direction || null,
    amount: toolCall?.amount ?? null,
    cursor: toolCall?.cursor || null,
    summary: truncateText(toolCall?.summary, SHORT_TEXT_LIMIT),
    reason: truncateText(toolCall?.reason, LONG_TEXT_LIMIT),
    requiresConfirmation: toolCall?.requiresConfirmation,
    riskCategory: toolCall?.riskCategory || ""
  });
}

function compactValidation(validation) {
  if (!validation) {
    return null;
  }
  return removeEmpty({
    ok: validation.ok,
    reason: validation.reason || ""
  });
}

function compactConfirmation(confirmation) {
  if (!confirmation) {
    return null;
  }
  return removeEmpty({
    required: confirmation.required,
    decision: confirmation.decision || "",
    mode: confirmation.mode || "",
    reason: truncateText(confirmation.reason, SHORT_TEXT_LIMIT),
    modelRequires: confirmation.modelRequires,
    deterministic: confirmation.deterministic
      ? removeEmpty({
          required: confirmation.deterministic.required,
          reason: truncateText(confirmation.deterministic.reason, SHORT_TEXT_LIMIT)
        })
      : null,
    userDecision: confirmation.userDecision
      ? removeEmpty({
          approved: confirmation.userDecision.approved,
          source: confirmation.userDecision.source || "",
          error: truncateText(confirmation.userDecision.error, SHORT_TEXT_LIMIT)
        })
      : null
  });
}

function compactPreview(preview) {
  if (!preview) {
    return null;
  }
  return removeEmpty({
    status: preview.status || "",
    tool: preview.tool || "",
    elementId: preview.elementId || "",
    url: preview.url || "",
    reason: truncateText(preview.reason, SHORT_TEXT_LIMIT),
    error: compactError(preview.error),
    bbox: compactBbox(preview.bbox)
  });
}

function compactExecution(execution) {
  if (!execution) {
    return null;
  }
  return removeEmpty({
    status: execution.status || "",
    tool: execution.tool || "",
    url: execution.url || "",
    previousUrl: execution.previousUrl || "",
    href: execution.href || "",
    navigation: execution.navigation || "",
    frameId: execution.frameId,
    frameUrl: execution.frameUrl || "",
    frameTitle: execution.frameTitle || "",
    elementId: execution.elementId || "",
    frameLocalElementId: execution.frameLocalElementId || "",
    key: execution.key || "",
    valueLength: execution.valueLength,
    result: truncateText(execution.result, LONG_TEXT_LIMIT),
    reason: truncateText(execution.reason, SHORT_TEXT_LIMIT),
    error: compactError(execution.error),
    textPage: compactTextPage(execution.textPage)
  });
}

function compactTextPage(textPage) {
  if (!textPage) {
    return null;
  }
  const items = textPage.items || [];
  return removeEmpty({
    source: textPage.source || "",
    cursor: textPage.cursor || "",
    nextCursor: textPage.nextCursor || "",
    startIndex: textPage.startIndex,
    endIndex: textPage.endIndex,
    totalCapturedItems: textPage.totalCapturedItems,
    includedItems: textPage.includedItems,
    charCount: textPage.charCount,
    truncated: textPage.truncated,
    itemsPreview: items.slice(0, READ_TEXT_ITEM_LIMIT).map((item) => truncateText(item)),
    itemsOmitted: omittedCount(items, READ_TEXT_ITEM_LIMIT)
  });
}

function compactModelRequest(request) {
  if (!request) {
    return null;
  }

  const input = (request.input || []).map((message) => {
    const content = (message.content || []).map((item) => removeEmpty({
      type: item.type || "",
      textChars: item.textChars,
      contextManagement: item.contextManagement || null
    }));
    return removeEmpty({
      role: message.role || "",
      content
    });
  });

  return removeEmpty({
    model: request.model || "",
    responseFormat: request.responseFormat || "",
    maxOutputTokens: request.maxOutputTokens,
    input
  });
}

function compactModelResponse(response, rawModelText) {
  if (!response) {
    return null;
  }
  return removeEmpty({
    id: response.id || "",
    object: response.object || "",
    status: response.status || "",
    model: response.model || "",
    createdAt: unixSecondsToIso(response.created_at),
    completedAt: unixSecondsToIso(response.completed_at),
    error: compactError(response.error),
    incompleteDetails: response.incomplete_details || null,
    usage: response.usage || null,
    outputTextChars: typeof rawModelText === "string" ? rawModelText.length : null
  });
}

function compactElement(element) {
  if (!element) {
    return null;
  }
  const attributes = element.attributes || {};
  const label = element.label || element.name || element.text || element.placeholder ||
    attributes.ariaLabel || attributes.title || attributes.alt || "";
  return removeEmpty({
    id: element.id || "",
    role: element.role || "",
    tagName: element.tagName || "",
    type: element.type || "",
    label: truncateText(label),
    text: label === element.text ? "" : truncateText(element.text),
    value: element.type === "password" && element.value ? "[password omitted]" : truncateText(element.value),
    placeholder: truncateText(element.placeholder),
    href: attributes.href || "",
    enabled: element.enabled,
    visible: element.visible,
    checked: element.checked,
    selected: element.selected,
    bbox: compactBbox(element.bbox),
    frame: compactFrame(element.frame),
    semanticHints: (element.semanticHints || []).slice(0, HINT_LIMIT)
  });
}

function compactFrame(frame) {
  if (!frame) {
    return null;
  }
  return removeEmpty({
    frameId: frame.frameId,
    index: frame.index,
    isTopFrame: frame.isTopFrame,
    url: frame.url || "",
    title: truncateText(frame.title),
    elementCount: frame.elementCount,
    textSnippetCount: frame.textSnippetCount,
    embeddedFrameCount: frame.embeddedFrameCount
  });
}

function compactEmbeddedFrame(frame) {
  if (!frame) {
    return null;
  }
  return removeEmpty({
    id: frame.id || "",
    title: truncateText(frame.title),
    name: frame.name || "",
    src: frame.src || "",
    dataSrc: frame.dataSrc || "",
    access: frame.access || "",
    bbox: compactBbox(frame.bbox),
    ownerFrameId: frame.ownerFrameId,
    ownerFrameIndex: frame.ownerFrameIndex,
    ownerFrameUrl: frame.ownerFrameUrl || ""
  });
}

function compactFrameObservation(frameObservation) {
  if (!frameObservation) {
    return null;
  }
  return removeEmpty({
    accessibleFrameCount: frameObservation.accessibleFrameCount,
    inaccessibleFrameCount: frameObservation.inaccessibleFrameCount,
    note: truncateText(frameObservation.note),
    errors: (frameObservation.errors || []).slice(0, HINT_LIMIT).map((entry) => removeEmpty({
      frameId: entry.frameId,
      message: truncateText(entry.error?.message)
    })),
    injectionError: compactError(frameObservation.injectionError)
  });
}

function compactTab(tab) {
  if (!tab) {
    return null;
  }
  return removeEmpty({
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url || "",
    title: tab.title || "",
    status: tab.status || ""
  });
}

function compactViewport(viewport) {
  if (!viewport) {
    return null;
  }
  return removeEmpty({
    width: viewport.width,
    height: viewport.height,
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    devicePixelRatio: viewport.devicePixelRatio
  });
}

function compactPageTextMeta(meta) {
  if (!meta) {
    return null;
  }
  return removeEmpty({
    scope: meta.scope || "",
    includedSnippets: meta.includedSnippets,
    maxSnippets: meta.maxSnippets,
    truncated: meta.truncated,
    frameCount: meta.frameCount
  });
}

function compactBbox(bbox) {
  if (!bbox) {
    return null;
  }
  return removeEmpty({
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height
  });
}

function compactError(error) {
  if (!error) {
    return null;
  }
  return removeEmpty({
    name: error.name || "",
    message: error.message || String(error),
    stack: truncateText(error.stack, LONG_TEXT_LIMIT)
  });
}

function findElement(snapshot, elementId) {
  if (!snapshot || !elementId) {
    return null;
  }
  return (snapshot.elements || []).find((element) => element.id === elementId) || null;
}

function omittedCount(items, includedCount) {
  return Math.max(0, (items?.length || 0) - includedCount);
}

function truncateText(value, limit = SHORT_TEXT_LIMIT) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 15))}...[truncated]`;
}

function unixSecondsToIso(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return new Date(value * 1000).toISOString();
}

function removeEmpty(input) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      continue;
    }
    output[key] = value;
  }
  return output;
}
