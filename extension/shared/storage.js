import { DEFAULT_SETTINGS, STORAGE_KEYS, TRACE_LIMITS, normalizeConfirmationMode } from "./protocol.js";
import { createId } from "./trace.js";

export async function getSettings() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEYS.SETTINGS] || {})
  };
  return {
    ...settings,
    confirmationMode: normalizeConfirmationMode(settings.confirmationMode)
  };
}

export async function saveSettings(nextSettings) {
  const current = await getSettings();
  const merged = {
    ...current,
    ...nextSettings
  };
  const normalized = {
    ...merged,
    confirmationMode: normalizeConfirmationMode(merged.confirmationMode)
  };
  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: normalized
  });
  return normalized;
}

export async function getHistory() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.HISTORY]: []
  });
  return stored[STORAGE_KEYS.HISTORY] || [];
}

export async function getTaskTraces() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.TASK_TRACES]: []
  });
  return stored[STORAGE_KEYS.TASK_TRACES] || [];
}

export async function getLatestDebugState() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.LATEST_TRACE]: null,
    [STORAGE_KEYS.LATEST_SNAPSHOT]: null
  });
  return {
    latestTrace: stored[STORAGE_KEYS.LATEST_TRACE],
    latestSnapshot: stored[STORAGE_KEYS.LATEST_SNAPSHOT]
  };
}

export async function getConversations() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.CONVERSATIONS]: []
  });
  return stored[STORAGE_KEYS.CONVERSATIONS] || [];
}

export async function getActiveConversationId() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.ACTIVE_CONVERSATION_ID]: null
  });
  return stored[STORAGE_KEYS.ACTIVE_CONVERSATION_ID] || null;
}

export async function getActiveConversation() {
  const conversations = await getConversations();
  const activeConversationId = await getActiveConversationId();
  let activeConversation = conversations.find((conversation) => (
    conversation.conversationId === activeConversationId
  ));

  if (!activeConversation) {
    activeConversation = createConversation();
    await upsertConversation(activeConversation, { makeActive: true });
    return activeConversation;
  }

  return activeConversation;
}

export function createConversation({ title = "New chat", tab = null } = {}) {
  const now = new Date().toISOString();
  return {
    conversationId: createId("conv"),
    title,
    createdAt: now,
    updatedAt: now,
    status: "idle",
    tab,
    messages: [],
    traceIds: [],
    siteNotes: []
  };
}

export async function createNewConversation({ title = "New chat", tab = null } = {}) {
  const conversation = createConversation({ title, tab });
  await upsertConversation(conversation, { makeActive: true });
  return conversation;
}

export async function setActiveConversation(conversationId) {
  const conversations = await getConversations();
  const conversation = conversations.find((item) => item.conversationId === conversationId);
  if (!conversation) {
    throw new Error("Conversation not found.");
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.ACTIVE_CONVERSATION_ID]: conversationId
  });
  return conversation;
}

export async function getConversation(conversationId) {
  const conversations = await getConversations();
  return conversations.find((conversation) => conversation.conversationId === conversationId) || null;
}

export async function upsertConversation(conversation, { makeActive = false } = {}) {
  const conversations = await getConversations();
  const normalizedConversation = normalizeConversation(conversation);
  const nextConversations = [
    normalizedConversation,
    ...conversations.filter((item) => item.conversationId !== normalizedConversation.conversationId)
  ].slice(0, TRACE_LIMITS.CONVERSATIONS);

  const payload = {
    [STORAGE_KEYS.CONVERSATIONS]: nextConversations
  };
  if (makeActive) {
    payload[STORAGE_KEYS.ACTIVE_CONVERSATION_ID] = normalizedConversation.conversationId;
  }
  await chrome.storage.local.set(payload);
  return normalizedConversation;
}

export async function appendConversationMessage(conversationId, message) {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found.");
  }
  const nextConversation = addMessageToConversation(conversation, message);
  await upsertConversation(nextConversation);
  return nextConversation;
}

export async function updateConversation(conversationId, patch) {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found.");
  }
  const nextConversation = normalizeConversation({
    ...conversation,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  await upsertConversation(nextConversation);
  return nextConversation;
}

export async function getTrace(taskId) {
  const traces = await getTaskTraces();
  return traces.find((trace) => trace.taskId === taskId) || null;
}

export async function saveLatestSnapshot(snapshot) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.LATEST_SNAPSHOT]: snapshot
  });
}

export async function persistTaskTrace(trace) {
  const [history, traces] = await Promise.all([getHistory(), getTaskTraces()]);
  const record = toHistoryRecord(trace);
  const nextHistory = [
    record,
    ...history.filter((item) => item.taskId !== trace.taskId)
  ].slice(0, TRACE_LIMITS.HISTORY_RECORDS);
  const nextTraces = [
    trace,
    ...traces.filter((item) => item.taskId !== trace.taskId)
  ].slice(0, TRACE_LIMITS.TASK_TRACES);

  await chrome.storage.local.set({
    [STORAGE_KEYS.HISTORY]: nextHistory,
    [STORAGE_KEYS.TASK_TRACES]: nextTraces,
    [STORAGE_KEYS.LATEST_TRACE]: trace,
    [STORAGE_KEYS.LATEST_SNAPSHOT]: latestSnapshotFromTrace(trace)
  });

  return {
    history: nextHistory,
    traces: nextTraces
  };
}

export function createConversationMessage({
  role,
  content,
  kind = "message",
  status = "done",
  runId = null,
  traceId = null,
  tool = null,
  metadata = {}
}) {
  return {
    messageId: createId("msg"),
    role,
    kind,
    status,
    content,
    runId,
    traceId,
    tool,
    metadata,
    createdAt: new Date().toISOString()
  };
}

export function addMessageToConversation(conversation, message) {
  const messages = [
    ...(conversation.messages || []),
    {
      ...message,
      messageId: message.messageId || createId("msg"),
      createdAt: message.createdAt || new Date().toISOString()
    }
  ].slice(-TRACE_LIMITS.CONVERSATION_MESSAGES);

  return normalizeConversation({
    ...conversation,
    messages,
    updatedAt: new Date().toISOString()
  });
}

function toHistoryRecord(trace) {
  return {
    taskId: trace.taskId,
    status: trace.status,
    instruction: trace.instruction,
    source: trace.source,
    createdAt: trace.createdAt,
    completedAt: trace.completedAt || null,
    updatedAt: trace.updatedAt,
    url: trace.activeTab?.url || "",
    title: trace.activeTab?.title || "",
    confirmationMode: trace.confirmationMode,
    stepCount: trace.steps?.length || 0,
    summary: trace.summary || ""
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

function normalizeConversation(conversation) {
  return {
    conversationId: conversation.conversationId,
    title: conversation.title || "New chat",
    createdAt: conversation.createdAt || new Date().toISOString(),
    updatedAt: conversation.updatedAt || new Date().toISOString(),
    status: conversation.status || "idle",
    tab: conversation.tab || null,
    messages: conversation.messages || [],
    traceIds: conversation.traceIds || [],
    siteNotes: conversation.siteNotes || []
  };
}
