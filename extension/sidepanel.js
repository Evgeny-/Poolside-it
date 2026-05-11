import {
  BUILT_IN_MODELS,
  CONFIRMATION_MODE_LABELS,
  CONFIRMATION_MODE_TITLES,
  CONFIRMATION_MODES,
  DEFAULT_SETTINGS,
  MESSAGE_TYPES,
  UI_MESSAGE_TYPES
} from "./shared/protocol.js";
import { createCompactTraceExport } from "./shared/trace-export.js";
import { createTaskId } from "./shared/trace.js";

const OPTIONAL_SITE_ORIGINS = ["http://*/*", "https://*/*"];

const state = {
  settings: null,
  latestSnapshot: null,
  latestTrace: null,
  history: [],
  conversations: [],
  activeConversation: null,
  availableModels: [...BUILT_IN_MODELS],
  currentTaskId: null,
  pendingConfirmation: null,
  pendingSiteAccessRetry: null,
  running: false
};

const elements = {
  statusLine: document.getElementById("statusLine"),
  newChatButton: document.getElementById("newChatButton"),
  openPlaygroundButton: document.getElementById("openPlaygroundButton"),
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  conversationSelect: document.getElementById("conversationSelect"),
  confirmationPanel: document.getElementById("confirmationPanel"),
  confirmationTitle: document.getElementById("confirmationTitle"),
  confirmationDetails: document.getElementById("confirmationDetails"),
  approveActionButton: document.getElementById("approveActionButton"),
  rejectActionButton: document.getElementById("rejectActionButton"),
  chatLog: document.getElementById("chatLog"),
  taskForm: document.getElementById("taskForm"),
  taskInput: document.getElementById("taskInput"),
  startTaskButton: document.getElementById("startTaskButton"),
  stopTaskButton: document.getElementById("stopTaskButton"),
  siteAccessPanel: document.getElementById("siteAccessPanel"),
  siteAccessText: document.getElementById("siteAccessText"),
  grantSiteAccessButton: document.getElementById("grantSiteAccessButton"),
  settingsForm: document.getElementById("settingsForm"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  modelSelect: document.getElementById("modelSelect"),
  customModelInput: document.getElementById("customModelInput"),
  maxStepsInput: document.getElementById("maxStepsInput"),
  showActionPreviewInput: document.getElementById("showActionPreviewInput"),
  confirmationModeSelect: document.getElementById("confirmationModeSelect"),
  refreshModelsButton: document.getElementById("refreshModelsButton"),
  observePageButton: document.getElementById("observePageButton"),
  copyTraceButton: document.getElementById("copyTraceButton"),
  exportTraceButton: document.getElementById("exportTraceButton"),
  snapshotJson: document.getElementById("snapshotJson"),
  traceSummary: document.getElementById("traceSummary"),
  rawJson: document.getElementById("rawJson"),
  historyList: document.getElementById("historyList")
};

init();

async function init() {
  bindEvents();
  await loadAppState();
}

function bindEvents() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  elements.taskForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startTask();
  });

  elements.taskInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.taskForm.requestSubmit();
    }
  });

  elements.taskInput.addEventListener("input", () => {
    autoSizeComposer();
  });

  elements.stopTaskButton.addEventListener("click", () => stopTask());
  elements.approveActionButton.addEventListener("click", () => resolvePendingConfirmation(true));
  elements.rejectActionButton.addEventListener("click", () => resolvePendingConfirmation(false));
  elements.grantSiteAccessButton.addEventListener("click", () => grantSiteAccess());
  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettings();
  });

  elements.newChatButton.addEventListener("click", () => newChat());
  elements.conversationSelect.addEventListener("change", () => switchConversation(elements.conversationSelect.value));
  elements.modelSelect.addEventListener("change", () => saveSettings({ quiet: true }));
  elements.confirmationModeSelect.addEventListener("change", () => saveSettings({ quiet: true }));
  elements.refreshModelsButton.addEventListener("click", () => refreshModels());
  elements.observePageButton.addEventListener("click", () => observePage());
  elements.copyTraceButton.addEventListener("click", () => copyTrace());
  elements.exportTraceButton.addEventListener("click", () => exportTrace());
  elements.openPlaygroundButton.addEventListener("click", () => openPlayground());
  elements.chatLog.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-trace-id]");
    if (button) {
      openTraceDetails(button.dataset.openTraceId);
    }
  });
  elements.historyList.addEventListener("click", (event) => {
    const loadButton = event.target.closest("[data-task-id]");
    if (loadButton) {
      loadTrace(loadButton.dataset.taskId);
      return;
    }
    const openButton = event.target.closest("[data-open-trace-id]");
    if (openButton) {
      openTraceDetails(openButton.dataset.openTraceId);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === UI_MESSAGE_TYPES.REQUEST_CONFIRMATION) {
      requestActionConfirmation(message.payload || {})
        .then((approved) => sendResponse({
          ok: true,
          data: { approved }
        }));
      return true;
    }

    if (message?.type === UI_MESSAGE_TYPES.TASK_EVENT) {
      handleTaskEvent(message.payload || {});
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
}

async function loadAppState() {
  setStatus("Loading");
  const data = await sendMessage(MESSAGE_TYPES.GET_APP_STATE);
  state.settings = data.settings;
  state.latestSnapshot = data.latestSnapshot;
  state.latestTrace = data.latestTrace;
  state.history = data.history || [];
  state.conversations = data.conversations || [];
  state.activeConversation = data.activeConversation || state.conversations[0] || null;
  state.availableModels = mergeModels(data.model?.builtInModels || [], [data.settings?.model]);
  renderAll();
  setStatus("Idle");
}

async function newChat() {
  resolvePendingConfirmation(false);
  const data = await sendMessage(MESSAGE_TYPES.NEW_CONVERSATION);
  state.activeConversation = data.conversation;
  state.conversations = data.conversations || state.conversations;
  state.currentTaskId = null;
  renderConversations();
  renderChat();
  setStatus("New chat");
}

async function switchConversation(conversationId) {
  resolvePendingConfirmation(false);
  const data = await sendMessage(MESSAGE_TYPES.SET_ACTIVE_CONVERSATION, { conversationId });
  state.activeConversation = data.conversation;
  state.conversations = data.conversations || state.conversations;
  renderConversations();
  renderChat();
  setStatus("Chat loaded");
}

async function saveSettings({ quiet = false } = {}) {
  if (!quiet) {
    setStatus("Saving settings");
  }

  try {
    await saveSettingsFromForm();
    renderSettings();
    if (!quiet) {
      setStatus("Settings saved");
    }
  } catch (error) {
    addEphemeralMessage("error", error.message);
    setStatus("Settings failed");
  }
}

async function startTask(instructionOverride = "") {
  const instruction = (instructionOverride || elements.taskInput.value).trim();
  if (!instruction) {
    return;
  }

  const taskId = createTaskId();
  const conversationId = state.activeConversation?.conversationId || null;
  elements.taskInput.value = "";
  autoSizeComposer();
  setRunning(true, taskId);
  setStatus("Running");

  try {
    await saveSettings({ quiet: true });
    const data = await sendMessage(MESSAGE_TYPES.START_TASK, {
      taskId,
      instruction,
      conversationId
    });
    state.latestSnapshot = data.snapshot;
    state.latestTrace = data.trace;
    state.history = data.history || state.history;
    state.activeConversation = data.conversation || state.activeConversation;
    state.conversations = data.conversations || state.conversations;
    state.pendingSiteAccessRetry = null;
    renderAll();
    hideSiteAccessPanel();
    setStatus(`Task ${data.trace.status || "finished"}`);
  } catch (error) {
    handlePossibleSiteAccessError(error, {
      type: "task",
      instruction
    });
    addEphemeralMessage("error", error.message);
    setStatus("Task failed");
  } finally {
    setRunning(false, null);
  }
}

async function stopTask() {
  if (!state.currentTaskId) {
    return;
  }

  resolvePendingConfirmation(false);
  const taskId = state.currentTaskId;
  setStatus("Stopping");
  try {
    const data = await sendMessage(MESSAGE_TYPES.STOP_TASK, { taskId });
    state.latestTrace = data.trace || state.latestTrace;
    state.history = data.history || state.history;
    renderDebug();
    renderHistory();
    addEphemeralMessage("tool", "Stop requested.");
  } catch (error) {
    addEphemeralMessage("error", error.message);
  } finally {
    setRunning(false, null);
  }
}

async function observePage() {
  setStatus("Observing page");
  elements.observePageButton.disabled = true;
  try {
    const data = await sendMessage(MESSAGE_TYPES.OBSERVE_PAGE, {
      persist: true,
      instruction: "Manual observe_page"
    });
    state.latestSnapshot = data.snapshot;
    state.latestTrace = data.trace;
    state.history = data.history || state.history;
    state.pendingSiteAccessRetry = null;
    renderDebug();
    renderHistory();
    hideSiteAccessPanel();
    setStatus("Observed page");
  } catch (error) {
    handlePossibleSiteAccessError(error, {
      type: "observe"
    });
    addEphemeralMessage("error", error.message);
    setStatus("Observe failed");
  } finally {
    elements.observePageButton.disabled = false;
  }
}

async function openPlayground() {
  setStatus("Opening playground");
  try {
    await sendMessage(MESSAGE_TYPES.OPEN_PLAYGROUND);
    setStatus("Playground opened");
  } catch (error) {
    addEphemeralMessage("error", error.message);
    setStatus("Open failed");
  }
}

async function grantSiteAccess() {
  elements.grantSiteAccessButton.disabled = true;
  setStatus("Requesting access");
  try {
    const granted = await chrome.permissions.request({
      origins: OPTIONAL_SITE_ORIGINS
    });
    if (!granted) {
      throw new Error("Website access was not granted.");
    }
    hideSiteAccessPanel();
    const retry = state.pendingSiteAccessRetry;
    state.pendingSiteAccessRetry = null;
    if (retry?.type === "task" && retry.instruction) {
      addEphemeralMessage("tool", "Website access granted. Retrying the request.");
      await startTask(retry.instruction);
      return;
    }
    if (retry?.type === "observe") {
      addEphemeralMessage("tool", "Website access granted. Observing the page again.");
      await observePage();
      return;
    }
    addEphemeralMessage("tool", "Website access granted.");
    setStatus("Access granted");
  } catch (error) {
    addEphemeralMessage("error", error.message);
    setStatus("Access denied");
  } finally {
    elements.grantSiteAccessButton.disabled = false;
  }
}

async function refreshModels() {
  setStatus("Refreshing models");
  elements.refreshModelsButton.disabled = true;
  try {
    await saveSettingsFromForm();
    const data = await sendMessage(MESSAGE_TYPES.LIST_OPENAI_MODELS);
    state.availableModels = mergeModels(data.models || [], [getSelectedModel()]);
    renderModelOptions(getSelectedModel());
    setStatus("Models refreshed");
  } catch (error) {
    addEphemeralMessage("error", error.message);
    setStatus("Model refresh failed");
  } finally {
    elements.refreshModelsButton.disabled = false;
  }
}

async function saveSettingsFromForm() {
  const confirmationMode = elements.confirmationModeSelect.value;
  if (!Object.values(CONFIRMATION_MODES).includes(confirmationMode)) {
    throw new Error(`Unsupported confirmation mode: ${confirmationMode}`);
  }

  const data = await sendMessage(MESSAGE_TYPES.SAVE_SETTINGS, {
    apiKey: elements.apiKeyInput.value.trim(),
    confirmationMode,
    model: getSelectedModel(),
    maxSteps: Number(elements.maxStepsInput.value) || DEFAULT_SETTINGS.maxSteps,
    showActionPreview: elements.showActionPreviewInput.checked
  });
  state.settings = data.settings;
  return data.settings;
}

async function loadTrace(taskId) {
  const data = await sendMessage(MESSAGE_TYPES.GET_TRACE, { taskId });
  if (!data.trace) {
    setStatus("Trace not found");
    return;
  }
  state.latestTrace = data.trace;
  state.latestSnapshot = getLatestSnapshotFromTrace(data.trace);
  renderDebug();
  setActiveTab("advanced");
  setStatus("Trace loaded");
}

async function copyTrace() {
  if (!state.latestTrace) {
    setStatus("No trace");
    return;
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(createCompactTraceExport(state.latestTrace), null, 2));
    setStatus("Compact trace copied");
  } catch (error) {
    addEphemeralMessage("error", error.message);
    setStatus("Copy failed");
  }
}

function exportTrace() {
  if (!state.latestTrace) {
    setStatus("No trace");
    return;
  }
  const blob = new Blob([JSON.stringify(state.latestTrace, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.latestTrace.taskId || "browser-agent-trace"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Trace exported");
}

function handleTaskEvent(payload) {
  if (payload.conversation) {
    state.activeConversation = payload.conversation.conversationId === state.activeConversation?.conversationId
      ? payload.conversation
      : state.activeConversation;
    state.conversations = upsertLocalConversation(state.conversations, payload.conversation);
  }
  renderConversations();
  renderChat();
}

function renderAll() {
  renderSettings();
  renderConversations();
  renderChat();
  renderDebug();
  renderHistory();
}

function renderSettings() {
  const settings = state.settings || {};
  elements.apiKeyInput.value = settings.apiKey || "";
  renderModelOptions(settings.model || DEFAULT_SETTINGS.model);
  elements.maxStepsInput.value = settings.maxSteps || DEFAULT_SETTINGS.maxSteps;
  elements.showActionPreviewInput.checked = settings.showActionPreview !== false;
  renderModeOptions(settings.confirmationMode || CONFIRMATION_MODES.SMART_CONFIRMATION);
}

function renderModelOptions(selectedModel) {
  const options = mergeModels(state.availableModels, [selectedModel]);
  elements.modelSelect.replaceChildren();
  options.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    elements.modelSelect.append(option);
  });
  elements.modelSelect.value = options.includes(selectedModel) ? selectedModel : DEFAULT_SETTINGS.model;
  elements.customModelInput.value = options.includes(selectedModel) ? "" : selectedModel;
}

function renderModeOptions(selectedMode) {
  elements.confirmationModeSelect.replaceChildren();
  Object.entries(CONFIRMATION_MODE_LABELS).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.title = CONFIRMATION_MODE_TITLES[value] || label;
    elements.confirmationModeSelect.append(option);
  });
  elements.confirmationModeSelect.value = selectedMode;
}

function renderConversations() {
  elements.conversationSelect.replaceChildren();
  state.conversations.forEach((conversation) => {
    const option = document.createElement("option");
    option.value = conversation.conversationId;
    option.textContent = conversation.title || "New chat";
    elements.conversationSelect.append(option);
  });
  if (state.activeConversation) {
    elements.conversationSelect.value = state.activeConversation.conversationId;
  }
}

function renderChat() {
  elements.chatLog.replaceChildren();
  const messages = state.activeConversation?.messages || [];

  if (!messages.length) {
    appendMessageNode({
      role: "assistant",
      kind: "message",
      content: "Ask me to inspect this page, explain what it does, or operate the current tab."
    });
    return;
  }

  messages.forEach((message) => appendMessageNode(message));
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function renderDebug() {
  elements.snapshotJson.textContent = stringify(state.latestSnapshot || {});
  elements.rawJson.textContent = stringify(state.latestTrace || {});
  renderTraceSummary();
}

function renderTraceSummary() {
  elements.traceSummary.replaceChildren();

  const trace = state.latestTrace;
  if (!trace) {
    elements.traceSummary.append(emptyState("No trace recorded."));
    return;
  }

  const header = document.createElement("div");
  header.className = "trace-step";
  header.append(
    titleRow(trace.status || "unknown", trace.taskId || ""),
    metaLine(trace.summary || trace.instruction || "")
  );
  elements.traceSummary.append(header);

  (trace.steps || []).forEach((step) => {
    const item = document.createElement("div");
    item.className = "trace-step";
    item.append(
      titleRow(`${step.step}. ${step.tool || step.type}`, step.timestamp || ""),
      metaLine(step.observationSummary || step.toolCall?.summary || step.recovery?.summary || step.error?.message || step.execution?.status || step.url || "")
    );
    elements.traceSummary.append(item);
  });
}

function renderHistory() {
  elements.historyList.replaceChildren();

  if (!state.history.length) {
    elements.historyList.append(emptyState("No task history."));
    return;
  }

  state.history.forEach((record) => {
    const item = document.createElement("article");
    item.className = "history-item";
    item.append(
      titleRow(record.status, record.instruction || record.taskId),
      metaLine(`${formatDate(record.updatedAt)} · ${record.title || record.url || "active tab"}`),
      metaLine(record.summary || `${record.stepCount || 0} trace steps`)
    );

    const button = document.createElement("button");
    button.className = "secondary-button";
    button.type = "button";
    button.dataset.taskId = record.taskId;
    button.textContent = "Load trace";
    item.append(button);

    const openButton = document.createElement("button");
    openButton.className = "secondary-button";
    openButton.type = "button";
    openButton.dataset.openTraceId = record.taskId;
    openButton.textContent = "Open details";
    item.append(openButton);

    elements.historyList.append(item);
  });
}

function appendMessageNode(message) {
  const item = document.createElement("div");
  item.className = [
    "message",
    message.role || "assistant",
    message.kind || "",
    message.role === "user" && message.traceId ? "run-root" : ""
  ].filter(Boolean).join(" ");

  const roleElement = document.createElement("div");
  roleElement.className = "message-role";
  roleElement.textContent = labelForMessage(message);

  const bodyElement = document.createElement("div");
  bodyElement.className = "message-body";
  bodyElement.textContent = getVisibleMessageContent(message);

  item.append(roleElement, bodyElement);
  if (shouldShowRunDetails(message)) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const button = document.createElement("button");
    button.className = "link-button";
    button.type = "button";
    button.dataset.openTraceId = message.traceId;
    button.textContent = "Run details";
    actions.append(button);
    item.append(actions);
  }
  elements.chatLog.append(item);
}

function shouldShowRunDetails(message) {
  return Boolean(message.traceId && message.role === "user");
}

function getVisibleMessageContent(message) {
  if (message.role !== "assistant" || !message.traceId) {
    return message.content || "";
  }
  const traceResponse = getAssistantResponseFromLatestTrace(message.traceId);
  return traceResponse || message.content || "";
}

function getAssistantResponseFromLatestTrace(traceId) {
  if (state.latestTrace?.taskId !== traceId) {
    return "";
  }
  const responseStep = (state.latestTrace.steps || []).find((step) => (
    step.toolCall?.tool === "respond_to_user" && step.toolCall?.text
  ));
  return responseStep?.toolCall?.text || "";
}

function addEphemeralMessage(role, body) {
  appendMessageNode({
    role,
    kind: role === "tool" ? "progress" : "message",
    content: body
  });
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function requestActionConfirmation(payload) {
  const toolCall = payload.toolCall || {};
  if (state.pendingConfirmation) {
    resolvePendingConfirmation(false);
  }

  elements.confirmationTitle.textContent = toolCall.summary || humanizeTool(toolCall.tool);
  elements.confirmationDetails.replaceChildren(
    compactConfirmationLine(payload.deterministic?.reason || toolCall.reason || "This action may have side effects."),
    compactConfirmationMeta([
      humanizeRisk(toolCall.riskCategory),
      toolCall.elementId || "",
      CONFIRMATION_MODE_LABELS[payload.mode] || payload.mode || ""
    ])
  );
  elements.confirmationPanel.classList.remove("hidden");
  setActiveTab("chat");
  addEphemeralMessage("tool", `Approval needed: ${toolCall.summary || toolCall.tool || "action"}`);

  return new Promise((resolve) => {
    state.pendingConfirmation = {
      resolve,
      toolCall
    };
  });
}

function resolvePendingConfirmation(approved) {
  if (!state.pendingConfirmation) {
    return;
  }
  const { resolve, toolCall } = state.pendingConfirmation;
  state.pendingConfirmation = null;
  elements.confirmationPanel.classList.add("hidden");
  elements.confirmationDetails.replaceChildren();
  addEphemeralMessage(
    "tool",
    `${approved ? "Approved" : "Rejected"} ${toolCall.summary || toolCall.tool || "action"}`
  );
  resolve(approved);
}

function handlePossibleSiteAccessError(error, retry = null) {
  if (!isSiteAccessError(error)) {
    return;
  }
  state.pendingSiteAccessRetry = retry;
  elements.siteAccessText.textContent = "Chrome blocked page access for this site. Grant website access and the panel will retry the blocked action.";
  elements.siteAccessPanel.classList.remove("hidden");
}

function hideSiteAccessPanel() {
  elements.siteAccessPanel.classList.add("hidden");
}

function isSiteAccessError(error) {
  const message = error?.message || String(error || "");
  return (
    message.includes("Cannot access contents of the page") ||
    message.includes("Extension manifest must request permission") ||
    message.includes("Cannot access a chrome") ||
    message.includes("The extensions gallery cannot be scripted")
  );
}

function setActiveTab(tabName) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });
}

function setRunning(isRunning, taskId) {
  state.running = isRunning;
  state.currentTaskId = taskId;
  elements.startTaskButton.disabled = isRunning;
  elements.stopTaskButton.classList.toggle("hidden", !isRunning);
  if (isRunning) {
    setStatus("Running");
  }
}

function autoSizeComposer() {
  elements.taskInput.style.height = "auto";
  elements.taskInput.style.height = `${Math.min(elements.taskInput.scrollHeight, 140)}px`;
}

function getSelectedModel() {
  return elements.customModelInput.value.trim() || elements.modelSelect.value || DEFAULT_SETTINGS.model;
}

function labelForMessage(message) {
  if (message.role === "user") {
    return "You";
  }
  if (message.role === "tool") {
    return "Agent step";
  }
  if (message.kind === "error" || message.role === "error") {
    return "Error";
  }
  return "Agent";
}

function confirmationLine(label, value) {
  const row = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.append(strong, document.createTextNode(value || ""));
  return row;
}

function compactConfirmationLine(text) {
  const row = document.createElement("div");
  row.className = "confirmation-reason";
  row.textContent = text || "This action needs approval.";
  return row;
}

function compactConfirmationMeta(items) {
  const row = document.createElement("div");
  row.className = "confirmation-meta";
  items.filter(Boolean).forEach((item) => {
    const pill = document.createElement("span");
    pill.textContent = item;
    row.append(pill);
  });
  return row;
}

function humanizeRisk(riskCategory) {
  const labels = {
    external_submit: "Sends data",
    destructive: "Destructive",
    financial: "Financial",
    auth_sensitive: "Account-sensitive",
    unknown: "Unknown risk",
    data_entry: "Data entry",
    safe_navigation: "Navigation"
  };
  return labels[riskCategory] || "";
}

function humanizeTool(tool) {
  return String(tool || "Approve action").replace(/_/g, " ");
}

function titleRow(left, right) {
  const row = document.createElement("div");
  row.className = "trace-step-title";

  const leftElement = document.createElement("span");
  leftElement.textContent = left || "";

  const rightElement = document.createElement("span");
  rightElement.textContent = right || "";

  row.append(leftElement, rightElement);
  return row;
}

function metaLine(text) {
  const line = document.createElement("div");
  line.className = "trace-step-body";
  line.textContent = text || "";
  return line;
}

function emptyState(text) {
  const node = document.createElement("div");
  node.className = "trace-step";
  node.textContent = text;
  return node;
}

function getLatestSnapshotFromTrace(trace) {
  const steps = trace.steps || [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].snapshot) {
      return steps[index].snapshot;
    }
  }
  return null;
}

function upsertLocalConversation(conversations, conversation) {
  return [
    conversation,
    ...conversations.filter((item) => item.conversationId !== conversation.conversationId)
  ];
}

function openTraceDetails(taskId) {
  if (!taskId) {
    return;
  }
  chrome.tabs.create({
    url: chrome.runtime.getURL(`trace.html?taskId=${encodeURIComponent(taskId)}`)
  });
}

function mergeModels(...groups) {
  const models = groups
    .flat()
    .filter(Boolean)
    .map((model) => String(model).trim())
    .filter(Boolean);
  return Array.from(new Set(models));
}

function setStatus(value) {
  elements.statusLine.textContent = value;
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(response?.error?.message || "Extension message failed.");
  }
  return response.data;
}
