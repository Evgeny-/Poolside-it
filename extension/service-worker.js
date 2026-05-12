import {
  CONFIRMATION_MODES,
  CONTENT_MESSAGE_TYPES,
  DEFAULT_SETTINGS,
  MCP_BRIDGE,
  MAX_AGENT_STEPS,
  MESSAGE_TYPES,
  PORT_NAMES,
  UI_MESSAGE_TYPES,
  normalizeConfirmationMode,
  normalizeModel
} from "./shared/protocol.js";
import {
  appendConversationMessage,
  createConversationMessage,
  createNewConversation,
  getActiveConversation,
  getConversations,
  getConversation,
  getHistory,
  getLatestDebugState,
  getSettings,
  getTrace,
  persistTaskTrace,
  saveLatestSnapshot,
  saveSettings,
  setActiveConversation,
  updateConversation
} from "./shared/storage.js";
import {
  addTraceStep,
  createObservationStep,
  createId,
  createTaskTrace,
  finishTrace,
  hydrateTraceActiveTabFromSnapshot,
  serializeError
} from "./shared/trace.js";
import { AGENT_TOOLS, chooseNextAction, compactSnapshot, readSnapshotTextPage, RISK_CATEGORIES } from "./model/agent.js";
import { getOpenRouterModelStatus, listOpenRouterModels } from "./model/openrouter-client.js";

const knownPanelMessages = new Set(Object.values(MESSAGE_TYPES));
const runningTaskIds = new Set();
const stoppedTaskIds = new Set();
const pageObserverPortsByTabId = new Map();
const pageObserverPortsByUrl = new Map();
const playgroundUrlsByTabId = new Map();
const MAX_RECOVERY_STEPS = 3;
const ACTION_PREVIEW_DELAY_MS = 650;
const ACTION_PREVIEW_CLEAR_DELAY_MS = 250;
const CONTENT_SCRIPT_INJECTION_TIMEOUT_MS = 8000;
const CONTENT_MESSAGE_TIMEOUT_MS = 8000;
const PAGE_OBSERVATION_TIMEOUT_MS = 18000;
const MODEL_DECISION_TIMEOUT_MS = 120000;
const TOP_FRAME_ID = 0;
const MCP_BRIDGE_HOST = "127.0.0.1";
const MCP_BRIDGE_PORT_CANDIDATES = Array.from({ length: 11 }, (_, index) => MCP_BRIDGE.DEFAULT_PORT + index);
const MCP_BRIDGE_CLIENT_ID = `${MCP_BRIDGE.CLIENT_NAME}_${createId("client")}`;
const MCP_BRIDGE_FETCH_TIMEOUT_MS = MCP_BRIDGE.POLL_TIMEOUT_MS + 5000;
const MCP_SNAPSHOT_LIMITS = Object.freeze({
  pageTextCharLimit: 30000,
  elementLimit: 150
});
const mcpSnapshotsByTabId = new Map();
let mcpBridgeLoopStarted = false;
let mcpBridgeEndpoint = null;
let mcpBridgeState = {
  connected: false,
  clientId: MCP_BRIDGE_CLIENT_ID,
  url: "",
  port: MCP_BRIDGE.DEFAULT_PORT,
  controlledBy: "",
  lastConnectedAt: null,
  lastSeenAt: null,
  lastError: ""
};

chrome.runtime.onInstalled.addListener(() => {
  enableActionSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  enableActionSidePanel();
});

chrome.action.onClicked.addListener(async (tab) => {
  ensureMcpBridgeLoop();
  if (!chrome.sidePanel?.open || !tab.windowId) {
    return;
  }
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!knownPanelMessages.has(message?.type)) {
    return false;
  }

  handlePanelMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAMES.PAGE_OBSERVER) {
    return;
  }

  const tabId = port.sender?.tab?.id;
  const url = port.sender?.url || port.sender?.tab?.url || "";
  if (Number.isInteger(tabId)) {
    pageObserverPortsByTabId.set(tabId, port);
    if (isExtensionPlaygroundUrl(url)) {
      playgroundUrlsByTabId.set(tabId, url);
    }
  }
  if (url) {
    pageObserverPortsByUrl.set(url, port);
  }

  port.onDisconnect.addListener(() => {
    if (Number.isInteger(tabId) && pageObserverPortsByTabId.get(tabId) === port) {
      pageObserverPortsByTabId.delete(tabId);
    }
    if (url && pageObserverPortsByUrl.get(url) === port) {
      pageObserverPortsByUrl.delete(url);
    }
  });
});

async function enableActionSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function handlePanelMessage(message) {
  switch (message.type) {
    case MESSAGE_TYPES.GET_APP_STATE:
      return getAppState();
    case MESSAGE_TYPES.SAVE_SETTINGS:
      return {
        settings: await saveSettings(normalizeSettings(message.payload || {}))
      };
    case MESSAGE_TYPES.START_TASK:
      return startTask(message.payload || {});
    case MESSAGE_TYPES.STOP_TASK:
      return stopTask(message.payload || {});
    case MESSAGE_TYPES.OBSERVE_PAGE:
      return observePageForDebug(message.payload || {});
    case MESSAGE_TYPES.GET_HISTORY:
      return {
        history: await getHistory()
      };
    case MESSAGE_TYPES.GET_TRACE:
      return {
        trace: await getTrace(message.payload?.taskId)
      };
    case MESSAGE_TYPES.NEW_CONVERSATION:
      return newConversation();
    case MESSAGE_TYPES.SET_ACTIVE_CONVERSATION:
      return activateConversation(message.payload || {});
    case MESSAGE_TYPES.OPEN_PLAYGROUND:
      return openPlayground();
    case MESSAGE_TYPES.LIST_MODELS:
      return listModels();
    case MESSAGE_TYPES.MODEL_STATUS:
      return {
        model: getOpenRouterModelStatus()
      };
    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

async function getAppState() {
  ensureMcpBridgeLoop();
  const [settings, history, debugState, activeConversation] = await Promise.all([
    getSettings(),
    getHistory(),
    getLatestDebugState(),
    getActiveConversation()
  ]);
  const conversations = await getConversations();
  return {
    settings,
    history,
    conversations,
    activeConversation,
    ...debugState,
    mcpBridge: getMcpBridgeStatus(),
    model: getOpenRouterModelStatus()
  };
}

function ensureMcpBridgeLoop() {
  if (mcpBridgeLoopStarted) {
    return;
  }
  mcpBridgeLoopStarted = true;
  runMcpBridgeLoop();
}

async function runMcpBridgeLoop() {
  for (;;) {
    try {
      const command = await pollMcpBridge();
      updateMcpBridgeState({
        connected: true,
        controlledBy: "MCP",
        lastConnectedAt: mcpBridgeState.lastConnectedAt || new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        lastError: ""
      });

      if (command?.type === "command") {
        await handleMcpBridgeCommandWithResult(command);
      }
    } catch (error) {
      mcpBridgeEndpoint = null;
      updateMcpBridgeState({
        connected: false,
        controlledBy: "",
        lastError: error.message || String(error)
      });
      await sleep(MCP_BRIDGE.RETRY_DELAY_MS);
    }
  }
}

async function pollMcpBridge() {
  const endpoint = await resolveMcpBridgeEndpoint();
  const url = new URL("/extension/poll", endpoint.url);
  url.searchParams.set("clientId", MCP_BRIDGE_CLIENT_ID);
  url.searchParams.set("token", MCP_BRIDGE.TOKEN);
  const response = await fetchWithTimeout(url.href, {
    method: "GET",
    cache: "no-store"
  }, MCP_BRIDGE_FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`MCP bridge poll failed with HTTP ${response.status}.`);
  }
  return response.json();
}

async function handleMcpBridgeCommandWithResult(command) {
  try {
    const data = await handleMcpBridgeCommand(command);
    await postMcpBridgeResult({
      id: command.id,
      ok: true,
      data
    });
  } catch (error) {
    await postMcpBridgeResult({
      id: command.id,
      ok: false,
      error: serializeError(error)
    }).catch(() => {});
  }
}

async function postMcpBridgeResult(result) {
  const endpoint = await resolveMcpBridgeEndpoint();
  const response = await fetchWithTimeout(`${endpoint.url}/extension/result`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      clientId: MCP_BRIDGE_CLIENT_ID,
      token: MCP_BRIDGE.TOKEN,
      ...result
    })
  }, CONTENT_MESSAGE_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`MCP bridge result failed with HTTP ${response.status}.`);
  }
  return response.json();
}

async function resolveMcpBridgeEndpoint() {
  if (mcpBridgeEndpoint) {
    return mcpBridgeEndpoint;
  }

  const errors = [];
  for (const port of MCP_BRIDGE_PORT_CANDIDATES) {
    const url = `http://${MCP_BRIDGE_HOST}:${port}`;
    try {
      const response = await fetchWithTimeout(`${url}/health`, {
        method: "GET",
        cache: "no-store"
      }, 1000);
      if (!response.ok) {
        continue;
      }
      const health = await response.json();
      if (health?.name !== "poolside-browser") {
        continue;
      }
      mcpBridgeEndpoint = {
        url,
        port
      };
      updateMcpBridgeState({
        url,
        port
      });
      return mcpBridgeEndpoint;
    } catch (error) {
      errors.push(`${port}: ${error.message || String(error)}`);
    }
  }

  throw new Error(`No compatible local MCP bridge found on ports ${MCP_BRIDGE_PORT_CANDIDATES.join(", ")}. Start the poolside-browser MCP server from your MCP client. ${errors[0] || ""}`.trim());
}

async function handleMcpBridgeCommand(command) {
  const method = String(command.method || "");
  const params = command.params || {};
  switch (method) {
    case "browser_status":
      return getMcpBrowserStatus();
    case "open_url":
      return openUrlFromMcp(params);
    case "observe_active_tab":
      return observeActiveTabFromMcp(params);
    case "click_element":
    case "fill_element":
    case "clear_element":
    case "select_option":
    case "submit_form":
    case "press_key":
    case "scroll":
    case "read_page_text":
      return executeBrowserToolFromMcp(method, params);
    default:
      throw new Error(`Unsupported MCP bridge command: ${method}`);
  }
}

async function getMcpBrowserStatus() {
  const tab = await getActiveTab().catch(() => null);
  return {
    extensionConnected: true,
    bridge: getMcpBridgeStatus(),
    activeTab: tab ? serializeConversationTab(tab) : null,
    lastSnapshot: getMcpSnapshotSummaryForTab(tab?.id)
  };
}

async function openUrlFromMcp(params) {
  const url = normalizeMcpNavigationUrl(params.url);
  const newTab = params.newTab === true;
  let tab = null;
  let previousUrl = "";

  if (newTab) {
    tab = await chrome.tabs.create({
      active: true,
      url
    });
  } else {
    const activeTab = await getActiveTab().catch(() => null);
    previousUrl = activeTab?.url || "";
    if (activeTab?.id) {
      tab = await chrome.tabs.update(activeTab.id, {
        active: true,
        url
      });
    } else {
      tab = await chrome.tabs.create({
        active: true,
        url
      });
    }
  }

  const settledTab = Number.isInteger(tab?.id)
    ? await waitForTabNavigation(tab.id, url, previousUrl).catch(() => tab)
    : tab;
  clearMcpSnapshotForTab(tab?.id);
  return {
    status: "ok",
    tab: settledTab ? serializeConversationTab(settledTab) : null,
    url
  };
}

async function observeActiveTabFromMcp(params = {}) {
  const { tab, snapshot } = await observeActiveTab();
  if (params.persist !== false) {
    await saveLatestSnapshot(snapshot);
  }
  return storeAndFormatMcpSnapshot({ tab, snapshot });
}

async function executeBrowserToolFromMcp(tool, params = {}) {
  const { tab, snapshot, snapshotId } = await resolveMcpSnapshotForAction(params);
  const toolCall = normalizeMcpToolCall(tool, params);
  const validation = validateToolCall(toolCall, snapshot);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const settings = await getSettings();
  let preview = null;
  if (shouldPreviewAction(settings, toolCall)) {
    preview = await previewActionInTab(tab, toolCall, {
      delayMs: ACTION_PREVIEW_DELAY_MS
    }, snapshot);
    if (isStalePreviewFailure(preview)) {
      throw new Error(preview.error?.message || preview.reason || "Action target is no longer available.");
    }
  }

  const confirmation = await decideConfirmation({
    settings,
    tab,
    snapshot,
    toolCall,
    decision: toolCall,
    validation
  });
  if (confirmation.required && confirmation.decision !== "approved") {
    await clearActionPreviewInTab(tab);
    throw new Error("MCP browser action was not approved in the extension.");
  }

  const execution = await executeActionInTab(tab, toolCall, snapshot);
  await clearActionPreviewInTab(tab, { delayMs: ACTION_PREVIEW_CLEAR_DELAY_MS });
  return {
    status: execution.status || "ok",
    snapshotId,
    toolCall,
    validation,
    confirmation,
    preview,
    execution
  };
}

async function resolveMcpSnapshotForAction(params = {}) {
  const requestedSnapshotId = String(params.snapshotId || "");
  if (requestedSnapshotId) {
    const existing = findMcpSnapshotById(requestedSnapshotId);
    if (!existing) {
      throw new Error("Snapshot not found or expired. Call observe_active_tab again before taking browser actions.");
    }
    const tab = await chrome.tabs.get(existing.tabId).catch(() => null);
    if (!tab) {
      throw new Error("The tab for this snapshot is no longer available.");
    }
    return {
      tab,
      snapshot: existing.snapshot,
      snapshotId: existing.snapshotId
    };
  }

  const activeTab = await getActiveTab();
  const existing = mcpSnapshotsByTabId.get(activeTab.id);
  if (existing) {
    return {
      tab: activeTab,
      snapshot: existing.snapshot,
      snapshotId: existing.snapshotId
    };
  }

  if (requiresObservedElement(params)) {
    throw new Error("Call observe_active_tab first and use an elementId from that snapshot.");
  }

  const snapshot = await requestPageSnapshot(activeTab);
  return {
    tab: activeTab,
    ...storeMcpSnapshot({ tab: activeTab, snapshot })
  };
}

function requiresObservedElement(params) {
  return Boolean(params.elementId);
}

function normalizeMcpToolCall(tool, params = {}) {
  return normalizeToolCall({
    tool,
    elementId: params.elementId || null,
    text: params.text ?? null,
    value: params.value ?? null,
    key: params.key ?? null,
    direction: params.direction ?? null,
    amount: Number.isFinite(Number(params.amount)) ? Number(params.amount) : null,
    cursor: params.cursor || null,
    summary: params.summary || defaultMcpActionSummary(tool, params),
    reason: params.reason || "Requested through the local MCP bridge.",
    requiresConfirmation: typeof params.requiresConfirmation === "boolean"
      ? params.requiresConfirmation
      : defaultMcpRequiresConfirmation(tool, params),
    riskCategory: params.riskCategory || defaultMcpRiskCategory(tool, params)
  });
}

function defaultMcpActionSummary(tool, params = {}) {
  if (tool === "fill_element") {
    return `Fill ${params.elementId || "element"}`;
  }
  if (tool === "click_element") {
    return `Click ${params.elementId || "element"}`;
  }
  if (tool === "clear_element") {
    return `Clear ${params.elementId || "element"}`;
  }
  if (tool === "select_option") {
    return `Select ${params.value || params.text || "option"}`;
  }
  if (tool === "submit_form") {
    return `Submit form from ${params.elementId || "element"}`;
  }
  if (tool === "press_key") {
    return `Press ${params.key || "key"}`;
  }
  if (tool === "scroll") {
    return `Scroll ${params.direction || "down"}`;
  }
  if (tool === "read_page_text") {
    return "Read visible page text";
  }
  return tool;
}

function defaultMcpRequiresConfirmation(tool, params = {}) {
  return tool === "submit_form" || (tool === "press_key" && params.key === "Enter");
}

function defaultMcpRiskCategory(tool, params = {}) {
  if (tool === "read_page_text" || tool === "scroll") {
    return "safe_navigation";
  }
  if (["fill_element", "clear_element", "select_option"].includes(tool)) {
    return "data_entry";
  }
  if (tool === "submit_form") {
    return "external_submit";
  }
  if (tool === "press_key" && params.key !== "Enter") {
    return "safe_navigation";
  }
  return "unknown";
}

function storeAndFormatMcpSnapshot({ tab, snapshot }) {
  const stored = storeMcpSnapshot({ tab, snapshot });
  return {
    snapshotId: stored.snapshotId,
    tab: serializeConversationTab(tab),
    snapshot: compactSnapshot(snapshot, MCP_SNAPSHOT_LIMITS),
    snapshotMeta: {
      url: snapshot.url || tab.url || "",
      title: snapshot.title || tab.title || "",
      elementCount: snapshot.elements?.length || 0,
      textSnippetCount: snapshot.pageText?.length || 0,
      frameCount: snapshot.frames?.length || 1,
      visibleTextTruncated: Boolean(snapshot.pageTextMeta?.truncated)
    }
  };
}

function storeMcpSnapshot({ tab, snapshot }) {
  const snapshotId = createId("mcp_snapshot");
  const record = {
    snapshotId,
    tabId: tab.id,
    url: snapshot.url || tab.url || "",
    title: snapshot.title || tab.title || "",
    snapshot,
    createdAt: new Date().toISOString()
  };
  if (Number.isInteger(tab.id)) {
    mcpSnapshotsByTabId.set(tab.id, record);
  }
  return {
    snapshotId,
    snapshot
  };
}

function findMcpSnapshotById(snapshotId) {
  return Array.from(mcpSnapshotsByTabId.values())
    .find((record) => record.snapshotId === snapshotId) || null;
}

function getMcpSnapshotSummaryForTab(tabId) {
  const record = Number.isInteger(tabId) ? mcpSnapshotsByTabId.get(tabId) : null;
  if (!record) {
    return null;
  }
  return {
    snapshotId: record.snapshotId,
    url: record.url,
    title: record.title,
    createdAt: record.createdAt
  };
}

function clearMcpSnapshotForTab(tabId) {
  if (Number.isInteger(tabId)) {
    mcpSnapshotsByTabId.delete(tabId);
  }
}

function normalizeMcpNavigationUrl(value) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) {
    throw new Error("open_url requires url.");
  }
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs can be opened through MCP.");
  }
  return parsed.href;
}

function getMcpBridgeStatus() {
  return {
    ...mcpBridgeState
  };
}

function updateMcpBridgeState(patch) {
  const previous = JSON.stringify(mcpBridgeState);
  mcpBridgeState = {
    ...mcpBridgeState,
    ...patch
  };
  if (JSON.stringify(mcpBridgeState) !== previous) {
    emitMcpBridgeStatus();
  }
}

async function emitMcpBridgeStatus() {
  try {
    await chrome.runtime.sendMessage({
      type: UI_MESSAGE_TYPES.MCP_BRIDGE_STATUS,
      payload: getMcpBridgeStatus()
    });
  } catch (error) {
    // Side panel may be closed; getAppState returns the latest status when it opens.
  }
}

async function startTask(payload) {
  const instruction = String(payload.instruction || "").trim();
  if (!instruction) {
    throw new Error("Task instruction is required.");
  }

  const storedSettings = await getSettings();
  const settings = Number.isFinite(Number(payload.maxSteps)) && Number(payload.maxSteps) > 0
    ? {
      ...storedSettings,
      maxSteps: clamp(Number(payload.maxSteps), 1, MAX_AGENT_STEPS)
    }
    : storedSettings;
  const tab = await getActiveTab();
  const conversation = await resolveConversation(payload.conversationId, tab);
  const trace = createTaskTrace({
    taskId: payload.taskId,
    instruction,
    tab,
    settings,
    source: payload.source || "chat"
  });

  runningTaskIds.add(trace.taskId);
  await persistTaskTrace(trace);
  await updateConversation(conversation.conversationId, {
    status: "running",
    tab: trace.activeTab,
    traceIds: Array.from(new Set([...(conversation.traceIds || []), trace.taskId])),
    title: conversation.title === "New chat" ? createConversationTitle(instruction) : conversation.title
  });
  await appendAndEmitConversationMessage(conversation.conversationId, createConversationMessage({
    role: "user",
    content: instruction,
    runId: trace.taskId,
    traceId: trace.taskId
  }));

  try {
    await runAgentLoop({ trace, tab, settings, conversationId: conversation.conversationId });
  } catch (error) {
    finishTrace(trace, "failed", "Agent task failed.", error);
    await appendAndEmitConversationMessage(conversation.conversationId, createConversationMessage({
      role: "assistant",
      kind: "error",
      content: `I ran into an error: ${error.message || String(error)}`,
      runId: trace.taskId,
      traceId: trace.taskId
    }));
    await updateConversation(conversation.conversationId, { status: "failed" });
    await persistTaskTrace(trace);
    throw error;
  } finally {
    runningTaskIds.delete(trace.taskId);
    stoppedTaskIds.delete(trace.taskId);
  }

  await persistTaskTrace(trace);
  await updateConversation(conversation.conversationId, { status: trace.status || "idle" });
  return {
    taskId: trace.taskId,
    trace,
    snapshot: latestSnapshotFromTrace(trace),
    conversation: await getConversation(conversation.conversationId),
    conversations: await getConversations(),
    history: await getHistory()
  };
}

async function runAgentLoop({ trace, tab, settings, conversationId }) {
  if (!settings.apiKey) {
    throw new Error("OpenRouter API key is required. Add it in Settings before starting a task.");
  }

  const maxSteps = clamp(Number(settings.maxSteps) || DEFAULT_SETTINGS.maxSteps, 1, MAX_AGENT_STEPS);
  let currentTab = tab;
  for (let iteration = 0; iteration < maxSteps; iteration += 1) {
    if (stoppedTaskIds.has(trace.taskId)) {
      finishTrace(trace, "stopped", "Task stopped by the user.");
      return trace;
    }

    currentTab = await getTaskTab(currentTab);
    let snapshot = null;
    try {
      snapshot = await requestPageSnapshot(currentTab);
    } catch (error) {
      const recovered = await recoverFromLoopError({
        trace,
        conversationId,
        error,
        strategy: "retry_observe",
        summary: "Observation failed; retrying after refreshing the page observer."
      });
      if (recovered) {
        continue;
      }
      finishTrace(trace, "failed", "Observation failed.", error);
      await appendAndEmitConversationMessage(conversationId, createConversationMessage({
        role: "assistant",
        kind: "error",
        content: `I could not observe the page: ${error.message || String(error)}`,
        runId: trace.taskId,
        traceId: trace.taskId
      }));
      await persistTaskTrace(trace);
      return trace;
    }
    hydrateTraceActiveTabFromSnapshot(trace, snapshot);
    addTraceStep(trace, createObservationStep({ tab: currentTab, snapshot }));
    await appendAndEmitConversationMessage(conversationId, createConversationMessage({
      role: "tool",
      kind: "progress",
      content: `Observed ${snapshot.title || "current page"}`,
      runId: trace.taskId,
      traceId: trace.taskId,
      tool: "observe_page"
    }));
    await persistTaskTrace(trace);
    const conversation = await getConversation(conversationId);

    let modelResult = null;
    try {
      modelResult = await withTimeout(
        chooseNextAction({
          apiKey: settings.apiKey,
          model: settings.model,
          instruction: trace.instruction,
          snapshot,
          trace,
          conversation
        }),
        MODEL_DECISION_TIMEOUT_MS,
        "Timed out waiting for the model decision."
      );
    } catch (error) {
      const recovered = await recoverFromLoopError({
        trace,
        conversationId,
        error,
        strategy: "retry_model_decision",
        summary: "The model returned an unusable decision; retrying with the latest page context."
      });
      if (recovered) {
        continue;
      }
      finishTrace(trace, "failed", "Model decision failed.", error);
      await appendAndEmitConversationMessage(conversationId, createConversationMessage({
        role: "assistant",
        kind: "error",
        content: `I could not recover from the model decision error: ${error.message || String(error)}`,
        runId: trace.taskId,
        traceId: trace.taskId
      }));
      await persistTaskTrace(trace);
      return trace;
    }

    const toolCall = normalizeToolCall(modelResult.decision);
    const validation = validateToolCall(toolCall, snapshot);
    const actionStep = {
      type: "model_action",
      tool: toolCall.tool,
      modelRequest: modelResult.request,
      rawModelResponse: modelResult.rawResponse,
      rawModelText: modelResult.rawText,
      decision: modelResult.decision,
      toolCall,
      validation,
      preview: null,
      confirmation: null,
      execution: null
    };

    if (!validation.ok) {
      actionStep.execution = {
        status: "blocked",
        reason: validation.reason
      };
      addTraceStep(trace, actionStep);
      const recovered = await recoverFromLoopError({
        trace,
        conversationId,
        error: new Error(`Model selected an invalid action: ${validation.reason}`),
        strategy: "retry_after_invalid_action",
        summary: "The model selected an invalid action; re-observing and asking for a different next step.",
        modelResult
      });
      if (recovered) {
        continue;
      }
      finishTrace(trace, "failed", `Model selected an invalid action: ${validation.reason}`);
      await persistTaskTrace(trace);
      return trace;
    }

    if (toolCall.tool === "finish") {
      actionStep.execution = {
        status: "ok",
        result: toolCall.summary
      };
      addTraceStep(trace, actionStep);
      finishTrace(trace, "completed", toolCall.summary || "Task completed.");
      await appendAndEmitConversationMessage(conversationId, createConversationMessage({
        role: "assistant",
        content: toolCall.summary || "Done.",
        runId: trace.taskId,
        traceId: trace.taskId
      }));
      await persistTaskTrace(trace);
      return trace;
    }

    if (toolCall.tool === "respond_to_user") {
      const responseText = getAssistantResponseText(toolCall);
      actionStep.execution = {
        status: "ok",
        result: responseText
      };
      addTraceStep(trace, actionStep);
      finishTrace(trace, "completed", responseText || "Answered.");
      await appendAndEmitConversationMessage(conversationId, createConversationMessage({
        role: "assistant",
        content: responseText || "",
        runId: trace.taskId,
        traceId: trace.taskId
      }));
      await persistTaskTrace(trace);
      return trace;
    }

    if (toolCall.tool === "abort") {
      actionStep.execution = {
        status: "aborted",
        result: toolCall.summary
      };
      addTraceStep(trace, actionStep);
      finishTrace(trace, "aborted", toolCall.summary || "Task aborted by the model.");
      await appendAndEmitConversationMessage(conversationId, createConversationMessage({
        role: "assistant",
        kind: "error",
        content: toolCall.summary || "I cannot complete that task.",
        runId: trace.taskId,
        traceId: trace.taskId
      }));
      await persistTaskTrace(trace);
      return trace;
    }

    if (shouldPreviewAction(settings, toolCall)) {
      actionStep.preview = await previewActionInTab(currentTab, toolCall, {
        delayMs: ACTION_PREVIEW_DELAY_MS
      }, snapshot);
      if (isStalePreviewFailure(actionStep.preview)) {
        actionStep.execution = {
          status: "blocked",
          reason: actionStep.preview.error?.message || actionStep.preview.reason || "Action target is no longer available."
        };
        addTraceStep(trace, actionStep);
        const recovered = await recoverFromLoopError({
          trace,
          conversationId,
          error: new Error(actionStep.execution.reason),
          strategy: "retry_after_stale_preview",
          summary: "The action target changed before execution; re-observing the page.",
          modelResult
        });
        if (recovered) {
          continue;
        }
        finishTrace(trace, "failed", `Action ${toolCall.tool} target changed before execution.`);
        await persistTaskTrace(trace);
        return trace;
      }
    }

    const confirmation = await decideConfirmation({
      settings,
      tab: currentTab,
      snapshot,
      toolCall,
      decision: modelResult.decision,
      validation
    });
    actionStep.confirmation = confirmation;

    if (confirmation.required && confirmation.decision !== "approved") {
      actionStep.execution = {
        status: "blocked",
        reason: "User rejected or confirmation was unavailable."
      };
      await clearActionPreviewInTab(currentTab);
      addTraceStep(trace, actionStep);
      finishTrace(trace, "stopped", "Task stopped because a required action was not approved.");
      await appendAndEmitConversationMessage(conversationId, createConversationMessage({
        role: "assistant",
        kind: "error",
        content: "I stopped because the required action was not approved.",
        runId: trace.taskId,
        traceId: trace.taskId
      }));
      await persistTaskTrace(trace);
      return trace;
    }

    try {
      actionStep.execution = await executeActionInTab(currentTab, toolCall, snapshot);
      await clearActionPreviewInTab(currentTab, { delayMs: ACTION_PREVIEW_CLEAR_DELAY_MS });
      await appendAndEmitConversationMessage(conversationId, createConversationMessage({
        role: "tool",
        kind: "progress",
        content: summarizeToolCall(toolCall),
        runId: trace.taskId,
        traceId: trace.taskId,
        tool: toolCall.tool
      }));
    } catch (error) {
      actionStep.execution = {
        status: "failed",
        error: serializeError(error)
      };
      await clearActionPreviewInTab(currentTab);
      addTraceStep(trace, actionStep);
      const recovered = await recoverFromLoopError({
        trace,
        conversationId,
        error,
        strategy: "retry_after_tool_error",
        summary: `The ${toolCall.tool} action failed; re-observing and trying another route.`,
        modelResult
      });
      if (recovered) {
        continue;
      }
      finishTrace(trace, "failed", `Action ${toolCall.tool} failed.`, error);
      await appendAndEmitConversationMessage(conversationId, createConversationMessage({
        role: "assistant",
        kind: "error",
        content: `The ${toolCall.tool} action failed: ${error.message || String(error)}`,
        runId: trace.taskId,
        traceId: trace.taskId
      }));
      await persistTaskTrace(trace);
      return trace;
    }

    addTraceStep(trace, actionStep);
    await persistTaskTrace(trace);
    await sleep(350);
  }

  finishTrace(trace, "failed", `Stopped after reaching the ${maxSteps} step limit.`);
  await appendAndEmitConversationMessage(conversationId, createConversationMessage({
    role: "assistant",
    kind: "error",
    content: `I stopped after reaching the ${maxSteps} step limit.`,
    runId: trace.taskId,
    traceId: trace.taskId
  }));
  await persistTaskTrace(trace);
  return trace;
}

async function stopTask(payload) {
  const taskId = String(payload.taskId || "");
  if (!taskId) {
    throw new Error("Task id is required.");
  }

  stoppedTaskIds.add(taskId);
  const trace = await getTrace(taskId);
  if (trace && trace.status === "running") {
    finishTrace(trace, "stopped", "Task stopped by the user.");
    await persistTaskTrace(trace);
  }

  return {
    taskId,
    stopped: true,
    wasRunning: runningTaskIds.has(taskId),
    trace: await getTrace(taskId),
    history: await getHistory()
  };
}

async function observePageForDebug(payload) {
  const { tab, snapshot } = await observeActiveTab();
  await saveLatestSnapshot(snapshot);

  if (payload.persist === false) {
    return {
      snapshot,
      trace: null,
      history: await getHistory()
    };
  }

  const settings = await getSettings();
  const trace = createTaskTrace({
    taskId: payload.taskId,
    instruction: payload.instruction || "Manual observe_page",
    tab,
    settings,
    source: "manual_observe"
  });
  hydrateTraceActiveTabFromSnapshot(trace, snapshot);
  addTraceStep(trace, createObservationStep({ tab, snapshot }));
  finishTrace(trace, "completed", "Manual observe_page completed.");
  await persistTaskTrace(trace);

  return {
    taskId: trace.taskId,
    snapshot,
    trace,
    history: await getHistory()
  };
}

async function observeActiveTab() {
  const tab = await getActiveTab();
  if (!tab.id) {
    throw new Error("Active tab does not have an id.");
  }

  const snapshot = await requestPageSnapshot(tab);
  return {
    tab,
    snapshot
  };
}

async function requestPageSnapshot(tab) {
  return withTimeout(
    requestPageSnapshotWithoutTimeout(tab),
    PAGE_OBSERVATION_TIMEOUT_MS,
    "Timed out while observing the page. The page may be too large or unresponsive."
  );
}

async function requestPageSnapshotWithoutTimeout(tab) {
  if (isExtensionPlaygroundTab(tab)) {
    return requestSnapshotFromPlayground(tab);
  }

  const injection = await ensureObserverInTab(tab, { allFrames: true });
  const frameSnapshots = await requestFrameSnapshots(tab, injection.frameIds);
  return mergeFrameSnapshots({
    tab,
    frameSnapshots,
    injectionError: injection.error || null
  });
}

async function previewActionInTab(tab, toolCall, options = {}, snapshot = null) {
  try {
    if (isExtensionPlaygroundTab(tab)) {
      const port = await waitForPlaygroundPort(tab);
      if (!port) {
        throw new Error("Playground previewer is not connected yet.");
      }
      const response = await requestPortResponse(port, {
        type: CONTENT_MESSAGE_TYPES.PREVIEW_ACTION,
        targetUrl: tab.url || "",
        action: toolCall,
        options
      });
      return unwrapExecutionResponse(response);
    }

    const target = resolveToolCallFrameTarget(snapshot, toolCall);
    await ensureObserverInTab(tab, { allFrames: true });
    const response = await sendContentMessage(tab, {
      type: CONTENT_MESSAGE_TYPES.PREVIEW_ACTION,
      action: target.action,
      options
    }, { frameId: target.frameId });
    return addFrameExecutionMetadata(unwrapExecutionResponse(response), target);
  } catch (error) {
    return {
      status: "failed",
      error: serializeError(error)
    };
  }
}

async function clearActionPreviewInTab(tab, { delayMs = 0 } = {}) {
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  try {
    if (isExtensionPlaygroundTab(tab)) {
      const port = await waitForPlaygroundPort(tab);
      if (!port) {
        return {
          status: "skipped",
          reason: "Playground previewer is not connected."
        };
      }
      const response = await requestPortResponse(port, {
        type: CONTENT_MESSAGE_TYPES.CLEAR_ACTION_PREVIEW
      });
      return unwrapExecutionResponse(response);
    }

    const injection = await ensureObserverInTab(tab, { allFrames: true });
    const responses = await Promise.allSettled(
      injection.frameIds.map((frameId) => sendContentMessage(tab, {
        type: CONTENT_MESSAGE_TYPES.CLEAR_ACTION_PREVIEW
      }, { frameId }))
    );
    const firstOk = responses.find((result) => result.status === "fulfilled" && result.value?.ok);
    if (firstOk) {
      return unwrapExecutionResponse(firstOk.value);
    }
    const firstFailure = responses.find((result) => result.status === "rejected");
    if (firstFailure) {
      throw firstFailure.reason;
    }
    return {
      status: "ok",
      hidden: true,
      url: tab.url || ""
    };
  } catch (error) {
    return {
      status: "failed",
      error: serializeError(error)
    };
  }
}

async function executeActionInTab(tab, toolCall, snapshot) {
  if (toolCall.tool === "read_page_text") {
    const textPage = readSnapshotTextPage(snapshot, toolCall.cursor);
    return {
      status: "ok",
      tool: "read_page_text",
      cursor: textPage.cursor,
      nextCursor: textPage.nextCursor,
      textPage,
      url: snapshot.url || tab.url || ""
    };
  }

  if (isExtensionPlaygroundTab(tab)) {
    const port = await waitForPlaygroundPort(tab);
    if (!port) {
      throw new Error("Playground executor is not connected yet.");
    }
    const response = await requestPortResponse(port, {
      type: CONTENT_MESSAGE_TYPES.EXECUTE_ACTION,
      targetUrl: tab.url || "",
      action: toolCall
    });
    return unwrapExecutionResponse(response);
  }

  const expectedNavigation = getExpectedNavigationTarget({ tab, snapshot, toolCall });
  const shouldWaitForNavigation = mayTriggerPageNavigation({ snapshot, toolCall });
  const previousUrl = tab.url || snapshot.url || "";
  const target = resolveToolCallFrameTarget(snapshot, toolCall);
  await ensureObserverInTab(tab, { allFrames: true });
  const response = await sendContentMessage(tab, {
    type: CONTENT_MESSAGE_TYPES.EXECUTE_ACTION,
    action: target.action
  }, { frameId: target.frameId });
  const result = addFrameExecutionMetadata(unwrapExecutionResponse(response), target);

  if (!expectedNavigation) {
    if (!shouldWaitForNavigation) {
      return result;
    }

    const settledTab = await waitForPossibleTabNavigation(tab.id, previousUrl);
    return {
      ...result,
      navigation: result.navigation || "possible_form_or_key_navigation",
      previousUrl,
      url: settledTab?.url || result.url || previousUrl
    };
  }

  const settledTab = await waitForTabNavigation(tab.id, expectedNavigation.href, tab.url || "");
  const finalUrl = settledTab?.url || result.url || "";
  if (
    normalizeUrlWithoutHash(finalUrl) !== normalizeUrlWithoutHash(expectedNavigation.href) &&
    normalizeUrlWithoutHash(finalUrl) === normalizeUrlWithoutHash(tab.url || "")
  ) {
    throw new Error(`Clicked link did not finish navigating to ${expectedNavigation.href}. Current URL is ${finalUrl || "unknown"}.`);
  }

  return {
    ...result,
    navigation: "dom_click_link",
    href: expectedNavigation.href,
    previousUrl: tab.url || "",
    url: finalUrl
  };
}

function mayTriggerPageNavigation({ snapshot, toolCall }) {
  if (toolCall.tool === "submit_form") {
    return true;
  }
  if (toolCall.tool === "press_key" && toolCall.key === "Enter") {
    return true;
  }
  if (toolCall.tool === "click_element") {
    return isFormSubmitSnapshotElement(findSnapshotElement(snapshot, toolCall.elementId));
  }
  return false;
}

async function ensureObserverInTab(tab, { allFrames = false } = {}) {
  try {
    const results = await withTimeout(
      chrome.scripting.executeScript({
        target: allFrames ? { tabId: tab.id, allFrames: true } : { tabId: tab.id },
        files: ["content/observer.js"]
      }),
      CONTENT_SCRIPT_INJECTION_TIMEOUT_MS,
      "Timed out injecting the page observer."
    );
    return {
      frameIds: extractInjectedFrameIds(results),
      error: null
    };
  } catch (error) {
    if (allFrames) {
      try {
        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content/observer.js"]
          }),
          CONTENT_SCRIPT_INJECTION_TIMEOUT_MS,
          "Timed out injecting the page observer into the top frame."
        );
        return {
          frameIds: extractInjectedFrameIds(results),
          error: serializeError(error)
        };
      } catch (topFrameError) {
        throw new Error(
          `${topFrameError.message} Grant website access from the side panel, or open the target page and click the Poolside it for me extension icon to grant temporary access for that tab.`
        );
      }
    }
    throw new Error(
      `${error.message} Grant website access from the side panel, or open the target page and click the Poolside it for me extension icon to grant temporary access for that tab.`
    );
  }
}

async function sendContentMessage(tab, message, options = {}) {
  const sendOptions = Number.isInteger(options.frameId) ? { frameId: options.frameId } : undefined;
  try {
    if (sendOptions) {
      return await withTimeout(
        chrome.tabs.sendMessage(tab.id, message, sendOptions),
        CONTENT_MESSAGE_TIMEOUT_MS,
        "Timed out waiting for the page observer to respond."
      );
    }
    return await withTimeout(
      chrome.tabs.sendMessage(tab.id, message),
      CONTENT_MESSAGE_TIMEOUT_MS,
      "Timed out waiting for the page observer to respond."
    );
  } catch (error) {
    if (!isMissingContentReceiverError(error)) {
      throw error;
    }
    await ensureObserverInTab(await chrome.tabs.get(tab.id), { allFrames: Number.isInteger(options.frameId) });
    if (sendOptions) {
      return withTimeout(
        chrome.tabs.sendMessage(tab.id, message, sendOptions),
        CONTENT_MESSAGE_TIMEOUT_MS,
        "Timed out waiting for the page observer to respond after reinjection."
      );
    }
    return withTimeout(
      chrome.tabs.sendMessage(tab.id, message),
      CONTENT_MESSAGE_TIMEOUT_MS,
      "Timed out waiting for the page observer to respond after reinjection."
    );
  }
}

async function requestFrameSnapshots(tab, frameIds) {
  const uniqueFrameIds = normalizeFrameIds(frameIds);
  const settled = await Promise.allSettled(
    uniqueFrameIds.map(async (frameId) => {
      const response = await sendContentMessage(tab, {
        type: CONTENT_MESSAGE_TYPES.OBSERVE_PAGE
      }, { frameId });
      return {
        frameId,
        snapshot: unwrapContentResponse(response)
      };
    })
  );

  const entries = [];
  const errors = [];
  for (let index = 0; index < settled.length; index += 1) {
    const frameId = uniqueFrameIds[index];
    const result = settled[index];
    if (result.status === "fulfilled") {
      entries.push(result.value);
      continue;
    }
    if (frameId === TOP_FRAME_ID) {
      throw result.reason;
    }
    errors.push({
      frameId,
      error: serializeError(result.reason)
    });
  }

  if (!entries.some((entry) => entry.frameId === TOP_FRAME_ID)) {
    throw new Error("Could not observe the top page frame.");
  }

  return {
    entries,
    errors
  };
}

function mergeFrameSnapshots({ tab, frameSnapshots, injectionError = null }) {
  const entries = frameSnapshots.entries || [];
  const topEntry = entries.find((entry) => entry.frameId === TOP_FRAME_ID);
  if (!topEntry?.snapshot) {
    throw new Error("Could not observe the top page frame.");
  }

  const frames = entries.map((entry, index) => buildFrameSummary(entry, index + 1));
  const elements = [];
  const pageText = [];
  const embeddedFrames = [];

  for (const frame of frames) {
    const entry = entries.find((candidate) => candidate.frameId === frame.frameId);
    const snapshot = entry?.snapshot || {};
    pageText.push(...prefixFrameTextItems(snapshot.pageText || [], frame));
    elements.push(...(snapshot.elements || []).map((element) => rewriteFrameElement(element, frame)));
    embeddedFrames.push(...(snapshot.embeddedFrames || []).map((embeddedFrame) => ({
      ...embeddedFrame,
      ownerFrameId: frame.frameId,
      ownerFrameIndex: frame.index,
      ownerFrameUrl: frame.url,
      ownerFrameTitle: frame.title
    })));
  }

  return {
    ...topEntry.snapshot,
    url: topEntry.snapshot.url || tab.url || "",
    title: topEntry.snapshot.title || tab.title || "",
    pageText,
    pageTextMeta: mergeFramePageTextMeta(entries, pageText.length),
    elements,
    frames,
    embeddedFrames,
    frameObservation: {
      accessibleFrameCount: frames.length,
      inaccessibleFrameCount: frameSnapshots.errors?.length || 0,
      errors: frameSnapshots.errors || [],
      injectionError,
      note: injectionError
        ? "Some frames may be missing because Chrome did not allow observer injection into every frame."
        : ""
    }
  };
}

function buildFrameSummary(entry, index) {
  const snapshot = entry.snapshot || {};
  const isTopFrame = entry.frameId === TOP_FRAME_ID || snapshot.frame?.isTopFrame === true;
  return {
    frameId: entry.frameId,
    index,
    isTopFrame,
    url: snapshot.url || snapshot.frame?.url || "",
    title: snapshot.title || snapshot.frame?.title || "",
    elementCount: snapshot.elements?.length || 0,
    textSnippetCount: snapshot.pageText?.length || 0,
    embeddedFrameCount: snapshot.embeddedFrames?.length || 0
  };
}

function rewriteFrameElement(element, frame) {
  const localId = element.id || "";
  const globalId = frame.isTopFrame ? localId : makeFrameElementId(frame.frameId, localId);
  return {
    ...element,
    id: globalId,
    frameId: frame.frameId,
    frameLocalId: localId,
    frame: compactFrameForElement(frame)
  };
}

function compactFrameForElement(frame) {
  return {
    frameId: frame.frameId,
    index: frame.index,
    isTopFrame: frame.isTopFrame,
    url: frame.url,
    title: frame.title
  };
}

function prefixFrameTextItems(items, frame) {
  if (frame.isTopFrame) {
    return items;
  }
  const label = frame.title || frame.url || `iframe ${frame.index}`;
  return items.map((item) => `[iframe ${frame.index}: ${label}] ${item}`);
}

function mergeFramePageTextMeta(entries, includedSnippets) {
  const truncated = entries.some((entry) => Boolean(entry.snapshot?.pageTextMeta?.truncated));
  return {
    scope: entries.length > 1 ? "visible_viewport_with_accessible_frames" : "visible_viewport",
    includedSnippets,
    maxSnippets: entries.reduce((total, entry) => (
      total + (entry.snapshot?.pageTextMeta?.maxSnippets || 0)
    ), 0),
    truncated,
    frameCount: entries.length
  };
}

function resolveToolCallFrameTarget(snapshot, toolCall) {
  const element = toolCall.elementId ? findSnapshotElement(snapshot, toolCall.elementId) : null;
  const frameId = Number.isInteger(element?.frameId) ? element.frameId : TOP_FRAME_ID;
  const localElementId = element?.frameLocalId || toolCall.elementId || null;
  const action = {
    ...toolCall,
    elementId: localElementId
  };
  return {
    frameId,
    action,
    element,
    originalElementId: toolCall.elementId || null,
    localElementId,
    frame: element?.frame || findSnapshotFrame(snapshot, frameId)
  };
}

function addFrameExecutionMetadata(result, target) {
  const output = {
    ...result,
    frameId: target.frameId,
    frameUrl: target.frame?.url || result.url || "",
    frameTitle: target.frame?.title || ""
  };
  if (target.originalElementId && result.elementId) {
    output.elementId = target.originalElementId;
    if (target.originalElementId !== result.elementId) {
      output.frameLocalElementId = result.elementId;
    }
  }
  return output;
}

function findSnapshotFrame(snapshot, frameId) {
  return (snapshot?.frames || []).find((frame) => frame.frameId === frameId) || null;
}

function makeFrameElementId(frameId, localId) {
  return `frame_${frameId}_${localId}`;
}

function extractInjectedFrameIds(results) {
  const frameIds = (results || [])
    .map((result) => result.frameId)
    .filter((frameId) => Number.isInteger(frameId));
  return normalizeFrameIds(frameIds);
}

function normalizeFrameIds(frameIds) {
  const unique = Array.from(new Set([
    TOP_FRAME_ID,
    ...(frameIds || []).filter((frameId) => Number.isInteger(frameId))
  ]));
  return unique.sort((a, b) => {
    if (a === TOP_FRAME_ID) {
      return -1;
    }
    if (b === TOP_FRAME_ID) {
      return 1;
    }
    return a - b;
  });
}

async function requestSnapshotFromPlayground(tab) {
  const port = await waitForPlaygroundPort(tab);
  if (!port) {
    throw new Error("Playground observer is not connected yet. Reload the playground tab or open it again from the side panel.");
  }

  const response = await requestPortResponse(port, {
    type: CONTENT_MESSAGE_TYPES.OBSERVE_PAGE,
    targetUrl: tab.url || ""
  });
  return unwrapContentResponse(response);
}

async function waitForPlaygroundPort(tab) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = getPlaygroundPort(tab);
    if (port) {
      return port;
    }
    await sleep(100);
  }
  return null;
}

function getPlaygroundPort(tab) {
  const url = tab.url || playgroundUrlsByTabId.get(tab.id) || "";
  const directPort = pageObserverPortsByTabId.get(tab.id) || pageObserverPortsByUrl.get(url);
  if (directPort) {
    return directPort;
  }

  const connectedPlaygroundPorts = Array.from(pageObserverPortsByUrl.entries())
    .filter(([connectedUrl]) => isExtensionPlaygroundUrl(connectedUrl))
    .map(([, port]) => port);
  if (connectedPlaygroundPorts.length === 1) {
    return connectedPlaygroundPorts[0];
  }
  return null;
}

function getExpectedNavigationTarget({ tab, snapshot, toolCall }) {
  if (toolCall.tool !== "click_element") {
    return null;
  }

  const element = findSnapshotElement(snapshot, toolCall.elementId);
  const href = element?.attributes?.href || "";
  if (!element || element.tagName !== "a" || !href || element.frameId !== TOP_FRAME_ID) {
    return null;
  }

  const currentUrl = snapshot.url || tab.url || "";
  if (!isHttpUrl(href) || !isHttpUrl(currentUrl)) {
    return null;
  }

  const target = normalizeUrlWithoutHash(href);
  const current = normalizeUrlWithoutHash(currentUrl);
  if (!target || target === current) {
    return null;
  }

  return {
    href,
    element
  };
}

async function waitForTabNavigation(tabId, expectedUrl, previousUrl = "") {
  const expected = normalizeUrlWithoutHash(expectedUrl);
  const previous = normalizeUrlWithoutHash(previousUrl);
  let latestTab = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    latestTab = await chrome.tabs.get(tabId).catch(() => null);
    if (!latestTab) {
      return null;
    }

    const current = normalizeUrlWithoutHash(latestTab.url || latestTab.pendingUrl || "");
    const reachedExpected = !expected || current === expected;
    const reachedRedirect = previous && current && current !== previous;
    if ((reachedExpected || reachedRedirect) && latestTab.status === "complete") {
      return latestTab;
    }
    await sleep(100);
  }
  return latestTab;
}

async function waitForPossibleTabNavigation(tabId, previousUrl = "") {
  const previous = normalizeUrlWithoutHash(previousUrl);
  let latestTab = null;
  let sawNavigation = false;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    latestTab = await chrome.tabs.get(tabId).catch(() => null);
    if (!latestTab) {
      return null;
    }

    const current = normalizeUrlWithoutHash(latestTab.url || latestTab.pendingUrl || "");
    if (latestTab.status === "loading" || latestTab.pendingUrl || (current && previous && current !== previous)) {
      sawNavigation = true;
    }
    if (sawNavigation && latestTab.status === "complete") {
      return latestTab;
    }
    if (!sawNavigation && attempt >= 8) {
      return latestTab;
    }
    await sleep(100);
  }

  return latestTab;
}

function isMissingContentReceiverError(error) {
  const message = error?.message || String(error || "");
  return message.includes("Receiving end does not exist");
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function normalizeUrlWithoutHash(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch (error) {
    return "";
  }
}

function requestPortResponse(port, message) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      port.onMessage.removeListener(handleMessage);
      reject(new Error("Timed out waiting for playground observer."));
    }, 5000);

    function handleMessage(response) {
      if (response?.requestId !== requestId) {
        return;
      }
      clearTimeout(timeoutId);
      port.onMessage.removeListener(handleMessage);
      resolve(response);
    }

    port.onMessage.addListener(handleMessage);
    port.postMessage({
      ...message,
      requestId
    });
  });
}

function unwrapContentResponse(response) {
  if (!response?.ok) {
    throw new Error(response?.error?.message || "Page observation failed.");
  }
  return response.snapshot;
}

function unwrapExecutionResponse(response) {
  if (!response?.ok) {
    throw new Error(response?.error?.message || "Action execution failed.");
  }
  return response.result;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  const tab = tabs[0];
  if (!tab) {
    throw new Error("No active tab found.");
  }
  return tab;
}

async function getTaskTab(tab) {
  if (!Number.isInteger(tab?.id)) {
    throw new Error("The task is not attached to a browser tab.");
  }

  try {
    return await chrome.tabs.get(tab.id);
  } catch (error) {
    throw new Error(`The task tab is no longer available: ${error.message || String(error)}`);
  }
}

async function openPlayground() {
  const url = chrome.runtime.getURL("playground/index.html");
  const tab = await chrome.tabs.create({
    active: true,
    url
  });
  if (Number.isInteger(tab.id)) {
    playgroundUrlsByTabId.set(tab.id, url);
  }
  return {
    url,
    tabId: tab.id
  };
}

async function listModels() {
  return {
    models: await listOpenRouterModels()
  };
}

async function newConversation() {
  const tab = await getActiveTab().catch(() => null);
  const conversation = await createNewConversation({
    title: "New chat",
    tab: tab ? serializeConversationTab(tab) : null
  });
  return {
    conversation,
    conversations: await getConversations()
  };
}

async function activateConversation(payload) {
  const conversation = await setActiveConversation(payload.conversationId);
  return {
    conversation,
    conversations: await getConversations()
  };
}

async function resolveConversation(conversationId, tab) {
  if (conversationId) {
    const existing = await getConversation(conversationId);
    if (existing) {
      await setActiveConversation(conversationId);
      return existing;
    }
  }

  const activeConversation = await getActiveConversation();
  if (activeConversation) {
    return activeConversation;
  }

  return createNewConversation({
    title: "New chat",
    tab: serializeConversationTab(tab)
  });
}

function normalizeSettings(settings) {
  const confirmationMode = normalizeConfirmationMode(settings.confirmationMode, DEFAULT_SETTINGS.confirmationMode);
  const maxSteps = clamp(Number(settings.maxSteps) || DEFAULT_SETTINGS.maxSteps, 1, MAX_AGENT_STEPS);

  return {
    ...DEFAULT_SETTINGS,
    apiKey: String(settings.apiKey || ""),
    confirmationMode,
    model: normalizeModel(settings.model),
    maxSteps,
    showActionPreview: typeof settings.showActionPreview === "boolean"
      ? settings.showActionPreview
      : DEFAULT_SETTINGS.showActionPreview
  };
}

function isExtensionPlaygroundUrl(url = "") {
  return url.startsWith(chrome.runtime.getURL("playground/"));
}

function isExtensionPlaygroundTab(tab) {
  return (
    isExtensionPlaygroundUrl(tab.url || "") ||
    isExtensionPlaygroundUrl(tab.pendingUrl || "") ||
    playgroundUrlsByTabId.has(tab.id)
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId = null;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function fetchWithTimeout(url, options = {}, milliseconds = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Timed out connecting to ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function recoverFromLoopError({
  trace,
  conversationId,
  error,
  strategy,
  summary,
  modelResult = null
}) {
  if (!isRecoverableAgentError(error)) {
    return false;
  }

  const attempt = countRecoverySteps(trace) + 1;
  if (attempt > MAX_RECOVERY_STEPS) {
    return false;
  }

  addTraceStep(trace, {
    type: "recovery",
    tool: "recover",
    recovery: {
      strategy,
      attempt,
      maxAttempts: MAX_RECOVERY_STEPS,
      summary
    },
    error: serializeError(error),
    modelRequest: error.request || modelResult?.request || null,
    rawModelResponse: error.rawResponse || modelResult?.rawResponse || null,
    rawModelText: error.rawText || modelResult?.rawText || ""
  });
  await appendAndEmitConversationMessage(conversationId, createConversationMessage({
    role: "tool",
    kind: "progress",
    content: summary,
    runId: trace.taskId,
    traceId: trace.taskId,
    tool: "recover"
  }));
  await persistTaskTrace(trace);
  await sleep(500);
  return true;
}

function countRecoverySteps(trace) {
  return (trace.steps || []).filter((step) => step.type === "recovery").length;
}

function isRecoverableAgentError(error) {
  const message = error?.message || String(error || "");
  if (
    message.includes("OpenRouter API key") ||
    message.includes("Website access was not granted") ||
    message.includes("Extension manifest must request permission") ||
    message.includes("Cannot access contents of the page") ||
    message.includes("required action was not approved") ||
    message.includes("Timed out")
  ) {
    return false;
  }
  return true;
}

function normalizeToolCall(decision) {
  return {
    tool: String(decision.tool || ""),
    elementId: decision.elementId || null,
    text: decision.text || null,
    value: decision.value || null,
    key: decision.key || null,
    direction: decision.direction || null,
    amount: Number.isFinite(decision.amount) ? decision.amount : null,
    cursor: decision.cursor || null,
    summary: String(decision.summary || ""),
    reason: String(decision.reason || ""),
    requiresConfirmation: Boolean(decision.requiresConfirmation),
    riskCategory: String(decision.riskCategory || "unknown")
  };
}

function getAssistantResponseText(toolCall) {
  if (toolCall.tool === "respond_to_user") {
    return toolCall.text || toolCall.summary || "";
  }
  return toolCall.summary || "";
}

function shouldPreviewAction(settings, toolCall) {
  return (
    settings.showActionPreview !== false &&
    Boolean(toolCall.elementId) &&
    ["click_element", "fill_element", "clear_element", "select_option", "submit_form"].includes(toolCall.tool)
  );
}

function isStalePreviewFailure(preview) {
  if (!preview || preview.status !== "failed") {
    return false;
  }
  const message = `${preview.error?.message || ""} ${preview.reason || ""}`.toLowerCase();
  return message.includes("stale") ||
    message.includes("no longer visible") ||
    message.includes("disabled");
}

function validateToolCall(toolCall, snapshot) {
  if (!AGENT_TOOLS.includes(toolCall.tool)) {
    return invalid(`Unsupported tool: ${toolCall.tool}`);
  }
  if (!RISK_CATEGORIES.includes(toolCall.riskCategory)) {
    return invalid(`Unsupported risk category: ${toolCall.riskCategory}`);
  }
  if (toolCall.tool === "respond_to_user") {
    return toolCall.text || toolCall.summary ? valid() : invalid("respond_to_user requires text or summary.");
  }
  if (toolCall.tool === "read_page_text") {
    return !toolCall.cursor || /^text:\d+$/.test(String(toolCall.cursor))
      ? valid()
      : invalid(`Unsupported page text cursor: ${toolCall.cursor}`);
  }
  if (["finish", "abort"].includes(toolCall.tool)) {
    return toolCall.summary ? valid() : invalid(`${toolCall.tool} requires a summary.`);
  }
  if (["click_element", "fill_element", "clear_element", "select_option", "submit_form"].includes(toolCall.tool)) {
    const element = findSnapshotElement(snapshot, toolCall.elementId);
    if (!element) {
      return invalid(`Unknown element id: ${toolCall.elementId}`);
    }
    if (!element.enabled) {
      return invalid(`Element ${toolCall.elementId} is disabled.`);
    }
    if (toolCall.tool === "fill_element" && !isFillableSnapshotElement(element)) {
      return invalid(`Element ${toolCall.elementId} is not fillable.`);
    }
    if (toolCall.tool === "fill_element" && typeof toolCall.text !== "string") {
      return invalid("fill_element requires text.");
    }
    if (toolCall.tool === "clear_element" && !isFillableSnapshotElement(element)) {
      return invalid(`Element ${toolCall.elementId} is not clearable.`);
    }
    if (toolCall.tool === "select_option" && element.tagName !== "select") {
      return invalid(`Element ${toolCall.elementId} is not a select element.`);
    }
    if (toolCall.tool === "select_option" && !toolCall.value && !toolCall.text) {
      return invalid("select_option requires a value or option text.");
    }
    if (toolCall.tool === "click_element" && isEmptySearchSubmitClick(element)) {
      const searchField = findVisibleEmptySearchField(snapshot, element);
      if (searchField) {
        return invalid(`Visible search field ${searchField.id} is available; fill that field with the search query before clicking the Search button.`);
      }
    }
    if (toolCall.tool === "submit_form" && !element.form?.canSubmit) {
      return invalid(`Element ${toolCall.elementId} is not inside a submittable form.`);
    }
  }
  if (toolCall.tool === "press_key" && toolCall.elementId) {
    const element = findSnapshotElement(snapshot, toolCall.elementId);
    if (!element) {
      return invalid(`Unknown element id: ${toolCall.elementId}`);
    }
    if (!element.enabled) {
      return invalid(`Element ${toolCall.elementId} is disabled.`);
    }
  }
  if (toolCall.tool === "press_key" && !isAllowedKey(toolCall.key)) {
    return invalid(`Unsupported key: ${toolCall.key}`);
  }
  if (toolCall.tool === "scroll" && !["up", "down", "left", "right"].includes(toolCall.direction)) {
    return invalid(`Unsupported scroll direction: ${toolCall.direction}`);
  }
  return valid();
}

async function decideConfirmation({ settings, tab, snapshot, toolCall, decision, validation }) {
  const deterministic = getDeterministicConfirmationRequirement({ tab, snapshot, toolCall });
  const modelRequires = Boolean(decision.requiresConfirmation);
  const riskyModelCategory = ["external_submit", "destructive", "financial", "auth_sensitive", "unknown"]
    .includes(toolCall.riskCategory);
  const reasons = [];

  if (!validation.ok) {
    return {
      required: false,
      decision: "not_requested",
      mode: settings.confirmationMode,
      reason: "Invalid action blocked before confirmation.",
      deterministic,
      modelRequires
    };
  }

  if (isNonExecutableTool(toolCall.tool) || toolCall.tool === "read_page_text") {
    return {
      required: false,
      decision: "auto_approved",
      mode: settings.confirmationMode,
      reason: "Read-only or terminal agent responses do not require confirmation.",
      deterministic,
      modelRequires
    };
  }

  let required = false;
  if (settings.confirmationMode === CONFIRMATION_MODES.ALLOW_ALL) {
    reasons.push(
      deterministic.required
        ? `allow_all mode bypassed confirmation: ${deterministic.reason}`
        : "allow_all mode"
    );
  } else if (settings.confirmationMode === CONFIRMATION_MODES.CONFIRM_EVERY_ACTION) {
    required = !isNonExecutableTool(toolCall.tool);
    reasons.push("confirm_every_action mode");
  } else if (settings.confirmationMode === CONFIRMATION_MODES.SMART_CONFIRMATION) {
    required = modelRequires || riskyModelCategory || deterministic.required;
    if (modelRequires) {
      reasons.push("model requested confirmation");
    }
    if (riskyModelCategory) {
      reasons.push(`model risk category: ${toolCall.riskCategory}`);
    }
  }

  if (settings.confirmationMode !== CONFIRMATION_MODES.ALLOW_ALL && deterministic.required) {
    required = true;
    reasons.push(deterministic.reason);
  }

  if (!required) {
    return {
      required: false,
      decision: "auto_approved",
      mode: settings.confirmationMode,
      reason: reasons.join("; ") || "Action did not require confirmation.",
      deterministic,
      modelRequires
    };
  }

  const userDecision = await requestUserConfirmation({
    toolCall,
    deterministic,
    modelRequires,
    mode: settings.confirmationMode
  });

  return {
    required: true,
    decision: userDecision.approved ? "approved" : "rejected",
    mode: settings.confirmationMode,
    reason: reasons.join("; ") || "Confirmation required.",
    deterministic,
    modelRequires,
    userDecision
  };
}

async function requestUserConfirmation({ toolCall, deterministic, modelRequires, mode }) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: UI_MESSAGE_TYPES.REQUEST_CONFIRMATION,
      payload: {
        mode,
        toolCall,
        deterministic,
        modelRequires
      }
    });
    return {
      approved: Boolean(response?.ok && response.data?.approved),
      source: "side_panel",
      error: response?.error || null
    };
  } catch (error) {
    return {
      approved: false,
      source: "side_panel",
      error: serializeError(error)
    };
  }
}

function getDeterministicConfirmationRequirement({ tab, snapshot, toolCall }) {
  if (isNonExecutableTool(toolCall.tool) || toolCall.tool === "scroll" || toolCall.tool === "read_page_text") {
    return {
      required: false,
      reason: ""
    };
  }

  const element = findSnapshotElement(snapshot, toolCall.elementId);
  const label = [
    element?.name,
    element?.label,
    element?.text,
    element?.placeholder,
    element?.attributes?.href
  ].filter(Boolean).join(" ").toLowerCase();
  const dangerPattern = /\b(send|submit|delete|remove|discard|purchase|pay|checkout|post|publish|upload|unsubscribe|reset|archive|confirm|finalize)\b/;

  if (toolCall.tool === "press_key" && toolCall.key === "Enter") {
    return {
      required: true,
      reason: "Enter can submit focused forms or dialogs."
    };
  }

  if (toolCall.tool === "submit_form") {
    return {
      required: true,
      reason: "Submitting a form can navigate or create external side effects."
    };
  }

  if (toolCall.tool === "click_element" && isFormSubmitSnapshotElement(element)) {
    return {
      required: true,
      reason: "Click target submits a form."
    };
  }

  if (toolCall.tool === "click_element" && dangerPattern.test(label)) {
    return {
      required: true,
      reason: "Click target appears to submit, send, delete, remove, or otherwise create side effects."
    };
  }

  if (toolCall.tool === "click_element" && !isExtensionPlaygroundTab(tab) && element?.tagName === "a") {
    return {
      required: false,
      reason: ""
    };
  }

  return {
    required: false,
    reason: ""
  };
}

function isNonExecutableTool(tool) {
  return ["finish", "abort", "respond_to_user"].includes(tool);
}

function findSnapshotElement(snapshot, elementId) {
  return (snapshot.elements || []).find((element) => element.id === elementId) || null;
}

function getSnapshotElementLabel(element) {
  return [
    element?.name,
    element?.label,
    element?.text,
    element?.placeholder,
    element?.attributes?.name,
    element?.attributes?.title,
    element?.attributes?.href
  ].filter(Boolean).join(" ");
}

function findVisibleEmptySearchField(snapshot, submitElement = null) {
  const candidates = (snapshot.elements || []).filter((element) => (
    element.enabled !== false &&
    isFillableSnapshotElement(element) &&
    !String(element.value || "").trim() &&
    isSearchSnapshotElement(element)
  ));
  if (!candidates.length) {
    return null;
  }

  if (submitElement?.form?.action || submitElement?.form?.intent) {
    const sameForm = candidates.find((candidate) => (
      Boolean(candidate.form) &&
      candidate.form.action === submitElement.form.action &&
      candidate.form.intent === submitElement.form.intent
    ));
    if (sameForm) {
      return sameForm;
    }
  }

  return candidates
    .slice()
    .sort((left, right) => distanceBetweenElements(left, submitElement) - distanceBetweenElements(right, submitElement))[0] || null;
}

function isEmptySearchSubmitClick(element) {
  if (!element || element.enabled === false || isFillableSnapshotElement(element)) {
    return false;
  }
  const label = getSnapshotElementLabel(element).toLowerCase();
  const hints = (element.semanticHints || []).join(" ").toLowerCase();
  return (
    /\bsearch\b|\bfind\b|\blookup\b|поиск|искать/.test(label) ||
    /\bsearch control\b|contains search form|form intent: search/.test(hints) ||
    element.form?.intent === "search"
  );
}

function isSearchSnapshotElement(element) {
  const label = [
    element.name,
    element.label,
    element.text,
    element.placeholder,
    element.attributes?.name,
    element.attributes?.title,
    ...(element.semanticHints || [])
  ].join(" ").toLowerCase();
  return /\bsearch\b|\bfind\b|\bquery\b|\blookup\b|поиск|искать/.test(label) ||
    element.form?.intent === "search";
}

function distanceBetweenElements(left, right) {
  if (!left?.bbox || !right?.bbox) {
    return Number.MAX_SAFE_INTEGER;
  }
  const leftCenterX = left.bbox.x + left.bbox.width / 2;
  const leftCenterY = left.bbox.y + left.bbox.height / 2;
  const rightCenterX = right.bbox.x + right.bbox.width / 2;
  const rightCenterY = right.bbox.y + right.bbox.height / 2;
  return Math.abs(leftCenterX - rightCenterX) + Math.abs(leftCenterY - rightCenterY);
}

function isFillableSnapshotElement(element) {
  const inputType = String(element.type || "text").toLowerCase();
  return (
    element.role === "textbox" ||
    element.tagName === "textarea" ||
    (element.tagName === "input" && !["checkbox", "radio", "button", "submit", "reset", "image", "file"].includes(inputType)) ||
    element.attributes?.contentEditable === "true"
  );
}

function isFormSubmitSnapshotElement(element) {
  if (!element?.form?.canSubmit) {
    return false;
  }
  const inputType = String(element.type || "").toLowerCase();
  if (element.tagName === "input") {
    return ["submit", "image"].includes(inputType);
  }
  if (element.tagName === "button") {
    return !["button", "reset"].includes(inputType || "submit");
  }
  return false;
}

function isAllowedKey(key) {
  return [
    "Enter",
    "Tab",
    "Escape",
    "ArrowDown",
    "ArrowUp",
    "ArrowLeft",
    "ArrowRight",
    "Backspace"
  ].includes(key);
}

async function appendAndEmitConversationMessage(conversationId, message) {
  const conversation = await appendConversationMessage(conversationId, message);
  await emitTaskEvent({
    conversationId,
    message,
    conversation
  });
  return conversation;
}

async function emitTaskEvent(event) {
  try {
    await chrome.runtime.sendMessage({
      type: UI_MESSAGE_TYPES.TASK_EVENT,
      payload: event
    });
  } catch (error) {
    // Side panel may be closed; persisted conversation state is the source of truth.
  }
}

function summarizeToolCall(toolCall) {
  if (toolCall.summary) {
    return toolCall.summary;
  }
  if (toolCall.tool === "fill_element") {
    return `Filled ${toolCall.elementId}`;
  }
  if (toolCall.tool === "click_element") {
    return `Clicked ${toolCall.elementId}`;
  }
  if (toolCall.tool === "select_option") {
    return `Selected ${toolCall.value || toolCall.text || "option"}`;
  }
  if (toolCall.tool === "submit_form") {
    return `Submitted form from ${toolCall.elementId}`;
  }
  if (toolCall.tool === "scroll") {
    return `Scrolled ${toolCall.direction || "down"}`;
  }
  if (toolCall.tool === "read_page_text") {
    return `Read visible page text from ${toolCall.cursor || "the beginning"}`;
  }
  return toolCall.tool;
}

function createConversationTitle(instruction) {
  const title = String(instruction || "New chat").replace(/\s+/g, " ").trim();
  return title.length > 42 ? `${title.slice(0, 41)}...` : title;
}

function serializeConversationTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url || "",
    title: tab.title || ""
  };
}

function latestSnapshotFromTrace(trace) {
  const steps = trace.steps || [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].snapshot) {
      return steps[index].snapshot;
    }
  }
  return null;
}

function valid() {
  return {
    ok: true,
    reason: ""
  };
}

function invalid(reason) {
  return {
    ok: false,
    reason
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
