import { BUILT_IN_MODELS, DEFAULT_MODEL } from "../shared/protocol.js";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export function getOpenRouterModelStatus() {
  return {
    provider: "openrouter",
    endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
    status: "ready",
    defaultModel: DEFAULT_MODEL,
    builtInModels: BUILT_IN_MODELS,
    note: "Model calls are made only from the extension service worker. API keys are not sent to content scripts or injected pages."
  };
}

export async function callOpenRouterChatCompletions({ apiKey, body }) {
  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured.");
  }

  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Poolside it for me"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `OpenRouter request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function listOpenRouterModels() {
  return BUILT_IN_MODELS;
}

export function extractResponseText(response) {
  const message = response?.choices?.[0]?.message || {};
  const toolCall = findDecisionToolCall(message.tool_calls || []);
  const toolArguments = toolCall?.function?.arguments;
  if (typeof toolArguments === "string") {
    return toolArguments.trim();
  }
  if (toolArguments && typeof toolArguments === "object") {
    return JSON.stringify(toolArguments);
  }

  if (typeof message.content === "string") {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item?.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function findDecisionToolCall(toolCalls) {
  return toolCalls.find((toolCall) => (
    toolCall?.type === "function" &&
    toolCall?.function?.name === "browser_agent_decision"
  )) || toolCalls[0] || null;
}
