export const MESSAGE_TYPES = Object.freeze({
  GET_APP_STATE: "browserAgent.getAppState",
  SAVE_SETTINGS: "browserAgent.saveSettings",
  START_TASK: "browserAgent.startTask",
  STOP_TASK: "browserAgent.stopTask",
  OBSERVE_PAGE: "browserAgent.observePage",
  GET_HISTORY: "browserAgent.getHistory",
  GET_TRACE: "browserAgent.getTrace",
  NEW_CONVERSATION: "browserAgent.newConversation",
  SET_ACTIVE_CONVERSATION: "browserAgent.setActiveConversation",
  OPEN_PLAYGROUND: "browserAgent.openPlayground",
  LIST_OPENAI_MODELS: "browserAgent.listOpenAIModels",
  MODEL_STATUS: "browserAgent.modelStatus"
});

export const UI_MESSAGE_TYPES = Object.freeze({
  REQUEST_CONFIRMATION: "browserAgent.ui.requestConfirmation",
  TASK_EVENT: "browserAgent.ui.taskEvent"
});

export const CONTENT_MESSAGE_TYPES = Object.freeze({
  OBSERVE_PAGE: "browserAgent.content.observePage",
  PREVIEW_ACTION: "browserAgent.content.previewAction",
  CLEAR_ACTION_PREVIEW: "browserAgent.content.clearActionPreview",
  EXECUTE_ACTION: "browserAgent.content.executeAction"
});

export const PORT_NAMES = Object.freeze({
  PAGE_OBSERVER: "browserAgent.pageObserver"
});

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: "browserAgent.settings",
  HISTORY: "browserAgent.history",
  TASK_TRACES: "browserAgent.taskTraces",
  LATEST_TRACE: "browserAgent.latestTrace",
  LATEST_SNAPSHOT: "browserAgent.latestSnapshot",
  CONVERSATIONS: "browserAgent.conversations",
  ACTIVE_CONVERSATION_ID: "browserAgent.activeConversationId"
});

export const CONFIRMATION_MODES = Object.freeze({
  SMART_CONFIRMATION: "smart_confirmation",
  CONFIRM_EVERY_ACTION: "confirm_every_action",
  ALLOW_ALL: "allow_all_actions"
});

const LEGACY_CONFIRMATION_MODE_ALIASES = Object.freeze({
  auto_execute: CONFIRMATION_MODES.ALLOW_ALL
});

export const CONFIRMATION_MODE_LABELS = Object.freeze({
  [CONFIRMATION_MODES.SMART_CONFIRMATION]: "Smart",
  [CONFIRMATION_MODES.CONFIRM_EVERY_ACTION]: "Confirm all",
  [CONFIRMATION_MODES.ALLOW_ALL]: "Allow all"
});

export const CONFIRMATION_MODE_TITLES = Object.freeze({
  [CONFIRMATION_MODES.SMART_CONFIRMATION]: "Smart confirmation",
  [CONFIRMATION_MODES.CONFIRM_EVERY_ACTION]: "Confirm every action",
  [CONFIRMATION_MODES.ALLOW_ALL]: "Allow all actions"
});

export function normalizeConfirmationMode(mode, fallback = CONFIRMATION_MODES.SMART_CONFIRMATION) {
  const value = String(mode || "");
  const normalized = LEGACY_CONFIRMATION_MODE_ALIASES[value] || value;
  return Object.values(CONFIRMATION_MODES).includes(normalized) ? normalized : fallback;
}

export const DEFAULT_MODEL = "gpt-5.4";
export const MAX_AGENT_STEPS = 1000;

export const BUILT_IN_MODELS = Object.freeze([
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.5-pro",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano"
]);

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "",
  confirmationMode: CONFIRMATION_MODES.SMART_CONFIRMATION,
  model: DEFAULT_MODEL,
  maxSteps: 50,
  showActionPreview: true
});

export const TRACE_LIMITS = Object.freeze({
  HISTORY_RECORDS: 50,
  TASK_TRACES: 20,
  CONVERSATIONS: 30,
  CONVERSATION_MESSAGES: 200
});
