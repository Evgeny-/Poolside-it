import { CONFIRMATION_MODE_LABELS, STORAGE_KEYS, normalizeConfirmationMode } from "./shared/protocol.js";
import { createCompactTraceExport } from "./shared/trace-export.js";

const params = new URLSearchParams(location.search);
const taskId = params.get("taskId");
const elements = {
  runMeta: document.getElementById("runMeta"),
  summaryGrid: document.getElementById("summaryGrid"),
  stepsNav: document.getElementById("stepsNav"),
  stepsList: document.getElementById("stepsList"),
  copyJsonButton: document.getElementById("copyJsonButton"),
  copyFullJsonButton: document.getElementById("copyFullJsonButton")
};

let currentTrace = null;

init();

async function init() {
  elements.copyJsonButton.addEventListener("click", copyTraceJson);
  elements.copyFullJsonButton.addEventListener("click", copyFullTraceJson);
  if (!taskId) {
    renderError("No taskId provided.");
    return;
  }

  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.TASK_TRACES]: []
  });
  currentTrace = (stored[STORAGE_KEYS.TASK_TRACES] || [])
    .find((trace) => trace.taskId === taskId);

  if (!currentTrace) {
    renderError("Trace not found. It may have been capped out of local storage.");
    return;
  }

  renderTrace(currentTrace);
}

function renderTrace(trace) {
  document.title = `Poolside it for me Run Details - ${trace.taskId}`;
  elements.runMeta.textContent = `${trace.status} · ${trace.taskId}`;
  elements.summaryGrid.replaceChildren(
    summaryItem("Instruction", trace.instruction),
    summaryItem("Status", trace.status),
    summaryItem("Model", trace.model),
    summaryItem("Confirmation", formatConfirmationMode(trace.confirmationMode)),
    summaryItem("Action preview", trace.actionPreview === false ? "off" : "on"),
    summaryItem("Page", trace.activeTab?.title || trace.activeTab?.url || ""),
    summaryItem("Created", formatDate(trace.createdAt)),
    summaryItem("Completed", formatDate(trace.completedAt)),
    summaryItem("Steps", String(trace.steps?.length || 0))
  );

  elements.stepsList.replaceChildren();
  elements.stepsNav.replaceChildren();
  (trace.steps || []).forEach((step) => {
    elements.stepsNav.append(renderStepNav(step));
    elements.stepsList.append(renderStep(step));
  });
}

function formatConfirmationMode(mode) {
  const normalizedMode = normalizeConfirmationMode(mode, mode || "");
  return CONFIRMATION_MODE_LABELS[normalizedMode] || mode || "";
}

function renderStep(step) {
  const card = document.createElement("article");
  card.className = "step-card";
  card.id = `step-${step.step}`;

  const header = document.createElement("div");
  header.className = "step-header";
  const title = document.createElement("h3");
  title.textContent = `${step.step}. ${step.tool || step.type}`;
  const meta = document.createElement("span");
  meta.className = "pill";
  meta.textContent = formatDate(step.timestamp);
  header.append(title, meta);
  card.append(header);

  if (step.type === "observe") {
    card.append(renderObservation(step));
  } else if (step.type === "model_action") {
    card.append(renderModelAction(step));
  } else if (step.type === "recovery") {
    card.append(renderRecovery(step));
  }

  card.append(detailsBlock("Raw step JSON", step));
  return card;
}

function renderStepNav(step) {
  const link = document.createElement("a");
  link.className = "step-nav-link";
  link.href = `#step-${step.step}`;
  link.textContent = `${step.step}. ${stepNavLabel(step)}`;
  return link;
}

function renderObservation(step) {
  const fragment = document.createDocumentFragment();
  const snapshot = step.snapshot || {};
  fragment.append(kvGrid([
    ["URL", snapshot.url || step.url || ""],
    ["Title", snapshot.title || step.title || ""],
    ["Frames", String(snapshot.frames?.length || 1)],
    ["Elements", String(snapshot.elements?.length || 0)],
    ["Text snippets", String(snapshot.pageText?.length || 0)]
  ]));

  if (snapshot.frames?.length) {
    const framesSection = section("Frames");
    framesSection.append(expandableList(snapshot.frames, {
      initialLimit: 12,
      formatItem: formatFrameSummary
    }));
    fragment.append(framesSection);
  }

  if (snapshot.embeddedFrames?.length) {
    const embeddedFramesSection = section("Embedded frames");
    embeddedFramesSection.append(expandableList(snapshot.embeddedFrames, {
      initialLimit: 12,
      formatItem: formatEmbeddedFrameSummary
    }));
    fragment.append(embeddedFramesSection);
  }

  const textSection = section("Visible text");
  textSection.append(expandableList(snapshot.pageText || [], {
    initialLimit: 12
  }));
  fragment.append(textSection);

  const elementsSection = section("Actionable elements");
  elementsSection.append(expandableList(snapshot.elements || [], {
    initialLimit: 18,
    formatItem: formatElementSummary
  }));
  fragment.append(elementsSection);
  return fragment;
}

function formatElementSummary(element) {
  const label = element.name || element.text || element.placeholder || element.attributes?.href || "";
  const form = element.form?.canSubmit
    ? ` · form ${element.form.intent || "submit"} ${element.form.method || ""}`.trimEnd()
    : "";
  const frame = element.frame?.isTopFrame === false
    ? ` · iframe ${element.frame.index || element.frameId || ""}`.trimEnd()
    : "";
  return `${element.id}: ${element.role}${frame} · ${label}${form}`;
}

function formatFrameSummary(frame) {
  const label = frame.title || frame.url || "untitled";
  const kind = frame.isTopFrame ? "top" : "iframe";
  return `${frame.index || frame.frameId}. ${kind} · ${label} · ${frame.elementCount || 0} elements`;
}

function formatEmbeddedFrameSummary(frame) {
  const source = frame.src || frame.dataSrc || "";
  const label = frame.title || frame.name || source || frame.id || "iframe";
  const owner = frame.ownerFrameIndex ? ` · owner frame ${frame.ownerFrameIndex}` : "";
  return `${label}${owner} · ${frame.access || "unknown"} · ${source}`;
}

function renderModelAction(step) {
  const fragment = document.createDocumentFragment();
  const toolCall = step.toolCall || step.decision || {};
  fragment.append(kvGrid([
    ["Tool", toolCall.tool || ""],
    ["Element", toolCall.elementId || ""],
    ["Summary", toolCall.summary || ""],
    ["Risk", toolCall.riskCategory || ""],
    ["Validation", step.validation?.ok ? "ok" : step.validation?.reason || ""],
    ["Preview", step.preview?.status || ""],
    ["Confirmation", step.confirmation?.decision || ""],
    ["Execution", step.execution?.status || ""],
    ["Frame", step.execution?.frameId === undefined ? "" : String(step.execution.frameId)]
  ]));

  if (toolCall.text) {
    const response = section("Assistant response");
    response.append(paragraph(toolCall.text));
    fragment.append(response);
  }

  if (toolCall.tool === "read_page_text" && step.execution?.textPage) {
    const textPage = step.execution.textPage;
    const textSection = section("Read visible page text");
    textSection.append(kvGrid([
      ["Cursor", textPage.cursor || ""],
      ["Next cursor", textPage.nextCursor || ""],
      ["Included items", String(textPage.includedItems || 0)],
      ["Truncated", textPage.truncated ? "yes" : "no"]
    ]));
    textSection.append(list(textPage.items || []));
    fragment.append(textSection);
  }

  if (toolCall.reason) {
    const reason = section("Reason");
    reason.append(paragraph(toolCall.reason));
    fragment.append(reason);
  }

  if (step.modelRequest) {
    fragment.append(detailsBlock("Model request context", step.modelRequest));
  }
  if (step.rawModelText) {
    fragment.append(detailsBlock("Raw model text", step.rawModelText));
  }
  return fragment;
}

function renderRecovery(step) {
  const fragment = document.createDocumentFragment();
  fragment.append(kvGrid([
    ["Strategy", step.recovery?.strategy || ""],
    ["Attempt", step.recovery?.attempt ? `${step.recovery.attempt}/${step.recovery.maxAttempts || ""}` : ""],
    ["Summary", step.recovery?.summary || ""],
    ["Error", step.error?.message || ""]
  ]));

  if (step.modelRequest) {
    fragment.append(detailsBlock("Model request context", step.modelRequest));
  }
  if (step.rawModelText) {
    fragment.append(detailsBlock("Raw model text", step.rawModelText));
  }
  return fragment;
}

function summaryItem(label, value) {
  const item = document.createElement("div");
  item.className = "summary-item";
  const labelNode = document.createElement("div");
  labelNode.className = "label";
  labelNode.textContent = label;
  const valueNode = document.createElement("div");
  valueNode.className = "value";
  valueNode.textContent = value || "";
  item.append(labelNode, valueNode);
  return item;
}

function kvGrid(items) {
  const grid = document.createElement("div");
  grid.className = "kv-grid";
  items.forEach(([label, value]) => {
    grid.append(summaryItem(label, value));
  });
  return grid;
}

function section(title) {
  const node = document.createElement("section");
  node.className = "section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  node.append(heading);
  return node;
}

function list(items) {
  const listNode = document.createElement("ul");
  listNode.className = "text-list";
  appendListItems(listNode, items);
  return listNode;
}

function appendListItems(listNode, items) {
  if (!items.length) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = "None";
    listNode.append(item);
    return;
  }
  items.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    listNode.append(item);
  });
}

function expandableList(items, {
  initialLimit,
  formatItem = (item) => item
} = {}) {
  const allItems = Array.isArray(items) ? items : [];
  const safeInitialLimit = Number.isFinite(initialLimit)
    ? Math.max(0, Math.floor(initialLimit))
    : allItems.length;
  const container = document.createElement("div");
  container.className = "expandable-list";
  const listNode = document.createElement("ul");
  listNode.className = "text-list";
  container.append(listNode);

  if (allItems.length <= safeInitialLimit) {
    appendListItems(listNode, allItems.map(formatItem));
    return container;
  }

  let expanded = false;
  const controls = document.createElement("div");
  controls.className = "list-controls";
  const count = document.createElement("span");
  count.className = "muted list-count";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button compact-button";
  controls.append(count, button);
  container.append(controls);

  function render() {
    const visibleItems = expanded ? allItems : allItems.slice(0, safeInitialLimit);
    listNode.replaceChildren();
    appendListItems(listNode, visibleItems.map(formatItem));
    count.textContent = `Showing ${visibleItems.length} of ${allItems.length}`;
    button.textContent = expanded ? `Show first ${safeInitialLimit}` : `Show all ${allItems.length}`;
    button.setAttribute("aria-expanded", String(expanded));
  }

  button.addEventListener("click", () => {
    expanded = !expanded;
    render();
  });
  render();
  return container;
}

function paragraph(text) {
  const node = document.createElement("p");
  node.textContent = text;
  return node;
}

function detailsBlock(label, value) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  details.append(summary, pre);
  return details;
}

async function copyTraceJson() {
  if (!currentTrace) {
    return;
  }
  await copyJsonToClipboard({
    button: elements.copyJsonButton,
    value: createCompactTraceExport(currentTrace),
    copiedLabel: "Copied",
    defaultLabel: "Copy JSON"
  });
}

async function copyFullTraceJson() {
  if (!currentTrace) {
    return;
  }
  await copyJsonToClipboard({
    button: elements.copyFullJsonButton,
    value: currentTrace,
    copiedLabel: "Copied full",
    defaultLabel: "Copy full JSON"
  });
}

async function copyJsonToClipboard({ button, value, copiedLabel, defaultLabel }) {
  await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  button.textContent = copiedLabel;
  window.setTimeout(() => {
    button.textContent = defaultLabel;
  }, 1200);
}

function renderError(message) {
  elements.runMeta.textContent = message;
  elements.summaryGrid.replaceChildren();
  elements.stepsNav.replaceChildren();
  elements.stepsList.replaceChildren();
}

function stepNavLabel(step) {
  if (step.type === "observe") {
    return step.title || step.snapshot?.title || "Observe page";
  }
  if (step.type === "recovery") {
    return step.recovery?.summary || "Recovery";
  }
  const toolCall = step.toolCall || step.decision || {};
  return toolCall.summary || toolCall.tool || step.tool || step.type || "Step";
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
